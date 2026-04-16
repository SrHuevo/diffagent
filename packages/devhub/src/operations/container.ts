import { resolve } from 'node:path'
import { config } from '../config.js'
import { dkr, sanitizeBranch, toUnixPath } from '../docker.js'

/**
 * Starts the unified app container for a task.
 * Runs lessons-links backend + DiffAgent HTTP server + (on-demand) Vite dashboards in a single container.
 * Logs are written to /app/.logs/* so Claude Code (spawned by DiffAgent) can tail them.
 */
export async function runUnifiedContainer(
	slot: string,
	task: string,
	baseBranch: string,
): Promise<void> {
	const safe = sanitizeBranch(task)
	const worktreePath = resolve(config.worktreesDir, slot)
	const worktreeGitDir = resolve(config.mainGitDir, 'worktrees', slot)
	const home = process.env.HOME || process.env.USERPROFILE || ''

	const wp = toUnixPath(worktreePath)
	const wgd = toUnixPath(worktreeGitDir)
	const mgd = toUnixPath(config.mainGitDir)
	const credentials = toUnixPath(resolve(home, '.claude/.credentials.json'))

	// Entrypoint:
	//  - git worktree bootstrap (same as before)
	//  - install deps only if node_modules is empty (volume may be pre-warmed)
	//  - start backend in background with auto-restart; logs to /app/.logs/backend.log
	//  - exec DiffAgent in foreground so container lives as long as it does
	const entrypoint = `
mkdir -p /tmp/git-worktree
cp -a /app/.worktree-git/* /tmp/git-worktree/ 2>/dev/null || true
echo '/main-git' > /tmp/git-worktree/commondir
echo '/app' > /tmp/git-worktree/gitdir
git config --global core.autocrlf true
git config --global --add safe.directory '*'

mkdir -p /app/.logs
chown -R dev:dev /app 2>/dev/null || true

# Install restart helpers so Claude Code inside the container can bounce services
cat > /usr/local/bin/restart-backend <<'EOF'
#!/bin/bash
pkill -f "tsx watch" 2>/dev/null || true
echo "backend killed; the entrypoint's auto-restart loop will spawn a fresh one in ~2s"
echo "tail -f /app/.logs/backend.log to follow startup"
EOF
chmod +x /usr/local/bin/restart-backend

cat > /usr/local/bin/restart-teachers <<EOF
#!/bin/bash
pkill -f "vite.*--port 5173" 2>/dev/null || true
(cd /app/packages/teachers-dashboard && nohup npx vite --host 0.0.0.0 --port 5173 --base /${safe}/teachers/ >> /app/.logs/teachers-vite.log 2>&1 &)
echo "teachers vite restarted; tail -f /app/.logs/teachers-vite.log"
EOF
chmod +x /usr/local/bin/restart-teachers

cat > /usr/local/bin/restart-students <<EOF
#!/bin/bash
pkill -f "vite.*--port 5174" 2>/dev/null || true
(cd /app/packages/students-dashboard && nohup npx vite --host 0.0.0.0 --port 5174 --base /${safe}/students/ >> /app/.logs/students-vite.log 2>&1 &)
echo "students vite restarted; tail -f /app/.logs/students-vite.log"
EOF
chmod +x /usr/local/bin/restart-students

if [ ! -f /app/node_modules/.package-lock.json ]; then
	echo "=== bun install ===" >> /app/.logs/install.log
	bun install >> /app/.logs/install.log 2>&1 || true
fi
(cd /app/packages/diluu-shared && npx tsc) >> /app/.logs/install.log 2>&1 || true

# File-watching on Windows→Linux bind-mounts needs polling: inotify events
# don't traverse the filesystem boundary, so native watchers never fire.
export CHOKIDAR_USEPOLLING=1
export CHOKIDAR_INTERVAL=1000

# Backend with auto-restart on crash
(while true; do
	echo "[$(date -Is)] starting backend" >> /app/.logs/backend.log
	(cd /app/packages/lessons-links && CHOKIDAR_USEPOLLING=1 CHOKIDAR_INTERVAL=1000 npx tsx watch src/bootstrap.ts) >> /app/.logs/backend.log 2>&1
	echo "[$(date -Is)] backend exited, restarting in 2s" >> /app/.logs/backend.log
	sleep 2
done) &

# tmux session hosting an interactive Claude Code. ttyd attaches to this
# session so the UI iframe shows the real TUI. The session is named 'claude'
# (fixed) so tmux send-keys -t claude from inject endpoints always hits it.
# Runs as 'dev' because claude refuses --dangerously-skip-permissions as root.
chown -R dev:dev /home/dev 2>/dev/null || true
# UTF-8 locale is required for Spanish accents / emojis to render correctly.
# C.UTF-8 is built into glibc — no need to install the 'locales' apt package.
UTF8_ENV="LANG=C.UTF-8 LC_ALL=C.UTF-8 LC_CTYPE=C.UTF-8"

# tmux defaults swallow the mouse wheel; enable mouse + a bigger scrollback
# buffer so the iframe lets the user scroll back through Claude's output.
cat > /home/dev/.tmux.conf <<'EOF'
set -g mouse on
set -g history-limit 50000
set -g default-terminal "xterm-256color"
EOF
chown dev:dev /home/dev/.tmux.conf

# Helper: resume the most-recent Claude session for /app if one exists, else
# start fresh. Invoked from tmux so the user sees their prior conversation.
cat > /usr/local/bin/claude-resume-or-fresh <<'EOF'
#!/bin/bash
PROJ="$HOME/.claude/projects/-app"
LATEST=$(ls -t "$PROJ"/*.jsonl 2>/dev/null | head -1)
if [ -n "$LATEST" ]; then
	SESSION_ID=$(basename "$LATEST" .jsonl)
	exec claude --resume "$SESSION_ID" --dangerously-skip-permissions
fi
exec claude --dangerously-skip-permissions
EOF
chmod +x /usr/local/bin/claude-resume-or-fresh

(while true; do
	su dev -c "$UTF8_ENV tmux kill-session -t claude 2>/dev/null || true; $UTF8_ENV tmux -u new-session -d -s claude -c /app 'env $UTF8_ENV /usr/local/bin/claude-resume-or-fresh'"
	echo "[$(date -Is)] tmux claude session started" >> /app/.logs/claude-tmux.log
	# Wait for the session to end, then recreate it
	while su dev -c "$UTF8_ENV tmux has-session -t claude 2>/dev/null"; do sleep 5; done
	echo "[$(date -Is)] tmux claude session exited, restarting in 2s" >> /app/.logs/claude-tmux.log
	sleep 2
done) &

# ttyd: WebSocket terminal on port 7681, read-write, auto-reconnecting client.
# -W enables write, -t disableLeaveAlert hides the "Are you sure" prompt on close.
# Runs as dev so 'tmux attach' hits the same tmux server as the session-creating loop.
(while true; do
	su dev -c "$UTF8_ENV ttyd -p 7681 -W -t disableLeaveAlert=true -t 'titleFixed=Claude' -t 'theme={\"background\":\"#0d1117\",\"foreground\":\"#e6edf3\"}' tmux -u attach -t claude" >> /app/.logs/ttyd.log 2>&1
	echo "[$(date -Is)] ttyd exited, restarting in 2s" >> /app/.logs/ttyd.log
	sleep 2
done) &

# Foreground: DiffAgent (keeps container alive)
exec node /opt/diffagent-linux/packages/cli/dist/index.js --port 4001 --no-open --base ${baseBranch} 2>&1 | tee /app/.logs/diffagent.log
`.trim()

	await dkr(
		'run', '-d',
		'--name', `app-${slot}`,
		'--network', config.networkName,
		'--label', 'diluu-dev=true',
		'--label', `diluu-task=${task}`,
		'--label', 'traefik.enable=true',
		// Host-based: backend (port 3001)
		'--label', `traefik.http.routers.app-${slot}.rule=Host(\`${safe}.localhost\`)`,
		'--label', `traefik.http.routers.app-${slot}.entrypoints=web`,
		'--label', `traefik.http.routers.app-${slot}.service=svc-app-${slot}`,
		'--label', `traefik.http.services.svc-app-${slot}.loadbalancer.server.port=3001`,
		// Path-based (tunnel): app
		'--label', `traefik.http.routers.app-${slot}-ngrok.rule=PathPrefix(\`/${safe}\`)`,
		'--label', `traefik.http.routers.app-${slot}-ngrok.entrypoints=web`,
		'--label', `traefik.http.routers.app-${slot}-ngrok.service=svc-app-${slot}`,
		'--label', `traefik.http.routers.app-${slot}-ngrok.middlewares=strip-app-${slot}`,
		'--label', `traefik.http.middlewares.strip-app-${slot}.stripprefix.prefixes=/${safe}`,
		// Host-based: teachers (port 5173)
		'--label', `traefik.http.routers.teachers-${slot}.rule=Host(\`teachers.${safe}.localhost\`)`,
		'--label', `traefik.http.routers.teachers-${slot}.entrypoints=web`,
		'--label', `traefik.http.routers.teachers-${slot}.service=svc-teachers-${slot}`,
		'--label', `traefik.http.services.svc-teachers-${slot}.loadbalancer.server.port=5173`,
		// Path-based: teachers
		'--label', `traefik.http.routers.teachers-${slot}-ngrok.rule=PathPrefix(\`/${safe}/teachers\`)`,
		'--label', `traefik.http.routers.teachers-${slot}-ngrok.entrypoints=web`,
		'--label', `traefik.http.routers.teachers-${slot}-ngrok.service=svc-teachers-${slot}`,
		'--label', `traefik.http.routers.teachers-${slot}-ngrok.middlewares=strip-teachers-${slot}`,
		'--label', `traefik.http.middlewares.strip-teachers-${slot}.stripprefix.prefixes=/${safe}/teachers`,
		// Host-based: students (port 5174)
		'--label', `traefik.http.routers.students-${slot}.rule=Host(\`students.${safe}.localhost\`)`,
		'--label', `traefik.http.routers.students-${slot}.entrypoints=web`,
		'--label', `traefik.http.routers.students-${slot}.service=svc-students-${slot}`,
		'--label', `traefik.http.services.svc-students-${slot}.loadbalancer.server.port=5174`,
		// Path-based: students
		'--label', `traefik.http.routers.students-${slot}-ngrok.rule=PathPrefix(\`/${safe}/students\`)`,
		'--label', `traefik.http.routers.students-${slot}-ngrok.entrypoints=web`,
		'--label', `traefik.http.routers.students-${slot}-ngrok.service=svc-students-${slot}`,
		'--label', `traefik.http.routers.students-${slot}-ngrok.middlewares=strip-students-${slot}`,
		'--label', `traefik.http.middlewares.strip-students-${slot}.stripprefix.prefixes=/${safe}/students`,
		// Host-based: diffagent (port 4001) — now in the same container
		'--label', `traefik.http.routers.diffagent-${slot}.rule=Host(\`diffagent.${safe}.localhost\`)`,
		'--label', `traefik.http.routers.diffagent-${slot}.entrypoints=web`,
		'--label', `traefik.http.routers.diffagent-${slot}.service=svc-diffagent-${slot}`,
		'--label', `traefik.http.services.svc-diffagent-${slot}.loadbalancer.server.port=4001`,
		// Path-based: diffagent
		'--label', `traefik.http.routers.diffagent-${slot}-ngrok.rule=PathPrefix(\`/${safe}/diffagent\`)`,
		'--label', `traefik.http.routers.diffagent-${slot}-ngrok.entrypoints=web`,
		'--label', `traefik.http.routers.diffagent-${slot}-ngrok.service=svc-diffagent-${slot}`,
		'--label', `traefik.http.routers.diffagent-${slot}-ngrok.middlewares=strip-diffagent-${slot}`,
		'--label', `traefik.http.middlewares.strip-diffagent-${slot}.stripprefix.prefixes=/${safe}/diffagent`,
		// Host-based: claude terminal via ttyd (port 7681)
		'--label', `traefik.http.routers.claude-${slot}.rule=Host(\`claude.${safe}.localhost\`)`,
		'--label', `traefik.http.routers.claude-${slot}.entrypoints=web`,
		'--label', `traefik.http.routers.claude-${slot}.service=svc-claude-${slot}`,
		'--label', `traefik.http.services.svc-claude-${slot}.loadbalancer.server.port=7681`,
		// Path-based: claude terminal
		'--label', `traefik.http.routers.claude-${slot}-ngrok.rule=PathPrefix(\`/${safe}/claude\`)`,
		'--label', `traefik.http.routers.claude-${slot}-ngrok.entrypoints=web`,
		'--label', `traefik.http.routers.claude-${slot}-ngrok.service=svc-claude-${slot}`,
		'--label', `traefik.http.routers.claude-${slot}-ngrok.middlewares=strip-claude-${slot}`,
		'--label', `traefik.http.middlewares.strip-claude-${slot}.stripprefix.prefixes=/${safe}/claude`,
		'--cpu-shares', String(config.cpuShares),
		'--memory', '3g',
		// Backend env
		'-e', `DB_URI=mongodb://mongo-${slot}:27017`,
		'-e', `DB_LOG_URI=mongodb://mongo-${slot}:27017`,
		'-e', 'DB_NAME=diluu',
		'-e', 'NODE_ENV=development',
		'-e', 'PORT=3001',
		// Mounts
		'-v', `${wp}:/app`,
		'-v', `${wp}/.gitfile-docker:/app/.git`,
		'-v', `diluu-nm-${slot}:/app/node_modules`,
		'-v', 'diluu-bun-cache:/root/.bun/install/cache',
		'-v', `${wgd}:/app/.worktree-git:ro`,
		'-v', `${mgd}:/main-git:ro`,
		// Claude Code session (needed for DiffAgent to spawn claude)
		'-v', `${wp}/.claude-session:/root/.claude`,
		'-v', `${credentials}:/root/.claude/.credentials.json`,
		'-v', `${wp}/.claude-session/.claude.json:/root/.claude.json`,
		'-v', `${wp}/.claude-session:/home/dev/.claude`,
		'-v', `${credentials}:/home/dev/.claude/.credentials.json`,
		'-v', `${wp}/.claude-session/.claude.json:/home/dev/.claude.json`,
		// DiffAgent: the image preinstalls Linux-native deps (better-sqlite3 +
		// CLI externals) at /opt/diffagent-linux. Only the built CLI `dist/` and
		// its package.json (read by the bundle via require('../package.json'))
		// are bind-mounted from the host so rebuilds take effect instantly.
		// The bundle resolves externals by walking up from dist/ → finds
		// /opt/diffagent-linux/node_modules/... (Linux ELF for native ones).
		'-v', `${toUnixPath(resolve(config.diffagentRoot, 'packages/cli/dist'))}:/opt/diffagent-linux/packages/cli/dist:ro`,
		'-v', `${toUnixPath(resolve(config.diffagentRoot, 'packages/cli/package.json'))}:/opt/diffagent-linux/packages/cli/package.json:ro`,
		'-w', '/app',
		'diluu-dev:latest',
		'bash', '-c', entrypoint,
	)
}
