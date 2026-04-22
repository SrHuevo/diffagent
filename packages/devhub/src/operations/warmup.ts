import { resolve } from 'node:path'
import { existsSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, unlinkSync } from 'node:fs'
import { config } from '../config.js'
import { pool } from '../pool.js'
import { dkr, ensureNetwork, ensureTraefik, ensureImage, toUnixPath, sleep } from '../docker.js'
import { worktreeAdd } from '../git.js'
import { eventBus } from '../events.js'
import { getLatestBackup } from '../backups.js'

function copyIfExists(src: string, dst: string): void {
	try {
		if (existsSync(src)) copyFileSync(src, dst)
	} catch {}
}

// Hosts writes fail with EACCES when a previous container run (as root) left
// root-owned files behind. Probe-write to detect that case before we rely on
// the worktree being writable.
function isWritable(dir: string): boolean {
	const probe = resolve(dir, '.diluu-write-probe')
	try {
		writeFileSync(probe, '')
		unlinkSync(probe)
		return true
	} catch {
		return false
	}
}

export async function warmupSlot(slot: string): Promise<void> {
	const worktreePath = resolve(config.worktreesDir, slot)
	const baseBranch = 'feature/version-3'

	pool.setSlot(slot, 'warming')
	eventBus.log('Warming up...', slot)

	// 1. Create worktree. Also recreate if prior destroy left half-cleaned state
	// (gitdir wiped but worktree files remain, or vice versa), or if the
	// worktree has root-owned leftovers from a container run that block our
	// host-side writes — otherwise later writeFileSync calls (.gitfile-docker
	// etc.) trap the slot in `error` forever.
	const worktreeGitDir = resolve(config.mainGitDir, 'worktrees', slot)
	const gitdirValid = existsSync(resolve(worktreeGitDir, 'HEAD'))
	const worktreeWritable = existsSync(worktreePath) ? isWritable(worktreePath) : true
	if (!existsSync(worktreePath) || !gitdirValid || !worktreeWritable) {
		eventBus.log('Creating worktree...', slot)
		if (existsSync(worktreePath) || existsSync(worktreeGitDir)) {
			// Remnants may be root-owned (written from container) — wipe via
			// a throwaway container so root can delete them.
			await dkr(
				'run', '--rm',
				'-v', `${toUnixPath(config.worktreesDir)}:/wt`,
				'-v', `${toUnixPath(config.mainGitDir)}:/git`,
				'diluu-dev:latest',
				'rm', '-rf', `/wt/${slot}`, `/git/worktrees/${slot}`,
			)
		}
		await worktreeAdd(worktreePath, slot, baseBranch)
	}

	// 2. Copy essential files
	for (const f of [
		'package.json',
		'package-lock.json',
		'packages/lessons-links/package.json',
		'packages/lessons-links/src/bootstrap.ts',
		'packages/lessons-links/src/server.ts',
	]) {
		copyIfExists(resolve(config.projectRoot, f), resolve(worktreePath, f))
	}

	// 3. Copy env files
	copyIfExists(
		resolve(config.projectRoot, 'packages/lessons-links/.env'),
		resolve(worktreePath, 'packages/lessons-links/.env'),
	)
	copyIfExists(
		resolve(config.projectRoot, 'packages/lessons-links/.env.development'),
		resolve(worktreePath, 'packages/lessons-links/.env.development'),
	)
	copyIfExists(resolve(config.projectRoot, '.env'), resolve(worktreePath, '.env'))

	// 4. Claude Code session — credentials are COPIED (not bind-mounted as a
	// separate file) so atomic-replace writes propagate through the dir mount.
	const claudeDst = resolve(worktreePath, '.claude-session')
	if (!existsSync(claudeDst)) {
		mkdirSync(claudeDst, { recursive: true })
		const home = process.env.HOME || process.env.USERPROFILE || ''
		copyIfExists(resolve(home, '.claude/settings.json'), resolve(claudeDst, 'settings.json'))
		copyIfExists(resolve(home, '.claude/stats-cache.json'), resolve(claudeDst, 'stats-cache.json'))
		copyIfExists(resolve(home, '.claude/.credentials.json'), resolve(claudeDst, '.credentials.json'))
		copyIfExists(resolve(home, '.claude.json'), resolve(claudeDst, '.claude.json'))

		// Rewrite mcpServers.*.command so Windows-only paths (e.g. C:\...\uvx.exe)
		// get mapped to the equivalent binary name in the Linux container PATH.
		const claudeJsonPath = resolve(claudeDst, '.claude.json')
		if (existsSync(claudeJsonPath)) {
			try {
				const raw = readFileSync(claudeJsonPath, 'utf8')
				const j = JSON.parse(raw)
				const rewriteCommand = (cmd: string): string => {
					if (typeof cmd !== 'string') return cmd
					// Windows path → take basename, strip .exe/.cmd/.bat
					if (/^[A-Za-z]:[\\/]/.test(cmd) || cmd.includes('\\')) {
						const base = cmd.split(/[\\/]/).pop() || cmd
						return base.replace(/\.(exe|cmd|bat)$/i, '')
					}
					return cmd
				}
				const walk = (obj: any) => {
					if (!obj || typeof obj !== 'object') return
					if (obj.mcpServers && typeof obj.mcpServers === 'object') {
						for (const srv of Object.values<any>(obj.mcpServers)) {
							if (srv && typeof srv.command === 'string') {
								srv.command = rewriteCommand(srv.command)
							}
						}
					}
					for (const v of Object.values(obj)) walk(v)
				}
				walk(j)
				writeFileSync(claudeJsonPath, JSON.stringify(j, null, 2))
			} catch {}
		}

		// Clean Windows-specific permission paths
		const settingsPath = resolve(claudeDst, 'settings.json')
		if (existsSync(settingsPath)) {
			try {
				const s = JSON.parse(readFileSync(settingsPath, 'utf8'))
				if (s.permissions) {
					s.permissions.allow = (s.permissions.allow || []).filter((p: string) => !p.includes('\\\\'))
					s.permissions.deny = (s.permissions.deny || []).filter((p: string) => !p.includes('\\\\'))
				}
				writeFileSync(settingsPath, JSON.stringify(s, null, 2))
			} catch {}
		}
	}

	// 5. Docker gitfile
	writeFileSync(resolve(worktreePath, '.gitfile-docker'), 'gitdir: /tmp/git-worktree\n')

	// 6. Start MongoDB + restore
	eventBus.log('Starting MongoDB...', slot)
	try {
		await dkr(
			'run', '-d',
			'--name', `mongo-${slot}`,
			'--network', config.networkName,
			'--label', 'diluu-dev=true',
			'--label', `diluu-pool=${slot}`,
			'--cpu-shares', String(config.cpuShares),
			'--memory', '512m',
			'-v', `diluu-mongo-${slot}:/data/db`,
			'mongo:8',
		)
	} catch {
		try { await dkr('start', `mongo-${slot}`) } catch {}
	}

	for (let i = 0; i < 30; i++) {
		try {
			await dkr('exec', `mongo-${slot}`, 'mongosh', '--eval', 'db.runCommand({ping:1})')
			break
		} catch {
			await sleep(1000)
		}
	}

	// Restore backup
	const latestBackup = getLatestBackup()
	if (latestBackup) {
		try {
			const countOut = await dkr(
				'exec', `mongo-${slot}`, 'mongosh', '--quiet', '--eval',
				"db.getSiblingDB('diluu').getCollectionNames().length",
			)
			if (parseInt(countOut) < 5) {
				eventBus.log('Restoring MongoDB backup...', slot)
				await dkr('cp', latestBackup, `mongo-${slot}:/tmp/backup`)
				await dkr('exec', `mongo-${slot}`, 'mongorestore', '--db', 'diluu', '--drop', '/tmp/backup/diluu/')
				await dkr('exec', `mongo-${slot}`, 'rm', '-rf', '/tmp/backup')
			}
		} catch {}
	}

	// 7. Pre-install node_modules
	eventBus.log('Installing node_modules...', slot)
	const wp = toUnixPath(worktreePath)
	const wgd = toUnixPath(resolve(config.mainGitDir, 'worktrees', slot))
	const mgd = toUnixPath(config.mainGitDir)
	try {
		await dkr(
			'run', '--rm',
			'--network', config.networkName,
			'--cpu-shares', String(config.cpuShares),
			'--memory', '2g',
			'-e', `DB_URI=mongodb://mongo-${slot}:27017`,
			'-e', `DB_LOG_URI=mongodb://mongo-${slot}:27017`,
			'-e', 'DB_NAME=diluu',
			'-e', 'NODE_ENV=development',
			'-v', `${wp}:/app`,
			'-v', `${wp}/.gitfile-docker:/app/.git`,
			'-v', `diluu-nm-${slot}:/app/node_modules`,
			'-v', 'diluu-bun-cache:/root/.bun/install/cache',
			'-v', `${wgd}:/app/.worktree-git:ro`,
			'-v', `${mgd}:/main-git:ro`,
			'-w', '/app',
			'diluu-dev:latest',
			'bash', '-c', 'bun install 2>&1 | tail -3; cd /app/packages/diluu-shared && npx tsc 2>&1 | tail -1 || true',
		)
	} catch (err: any) {
		eventBus.log(`node_modules warning: ${err.message?.slice(0, 100)}`, slot)
	}

	// Stop MongoDB (restarted during activation)
	try { await dkr('stop', `mongo-${slot}`) } catch {}

	pool.setSlot(slot, 'free')
	eventBus.log('Ready', slot)
}

export async function warmupPool(): Promise<void> {
	eventBus.log('Starting pool warmup...')
	await ensureNetwork()
	await ensureTraefik()
	await ensureImage()
	pool.init()

	const promises: Promise<void>[] = []

	for (let i = 1; i <= config.poolSize; i++) {
		const slot = `pool-${i}`
		const status = pool.getStatus(slot)

		if (status === 'free') {
			const worktreeExists = existsSync(resolve(config.worktreesDir, slot))
			const gitdirValid = existsSync(resolve(config.mainGitDir, 'worktrees', slot, 'HEAD'))
			let mongoExists = false
			try {
				await dkr('inspect', `mongo-${slot}`)
				mongoExists = true
			} catch {}
			if (worktreeExists && gitdirValid && mongoExists) {
				eventBus.log('Already ready', slot)
				continue
			}
			pool.removeSlot(slot)
		}

		if (status === 'active') {
			eventBus.log('In use, skipping', slot)
			continue
		}

		// Preserve stopped task→slot mapping across devhub restarts so the user
		// can POST /resume and reattach to their prior worktree + volumes.
		if (status === 'stopped') {
			eventBus.log('Stopped, preserving', slot)
			continue
		}

		promises.push(
			warmupSlot(slot).catch((err) => {
				eventBus.log(`Failed: ${err.message}`, slot)
				pool.setSlot(slot, 'error')
			}),
		)
	}

	await Promise.allSettled(promises)
	eventBus.log(`Pool ready: ${pool.countFree()}/${pool.countTotal()} slots available`)
}
