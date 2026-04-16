import { resolve, dirname } from 'node:path'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// PROJECT_ROOT = the target project the devhub operates on. Defaults to cwd,
// which is the Diluu repo when invoked via `npm run dev-env:service` there.
// Override with DEVHUB_PROJECT_ROOT if you need to run from somewhere else.
const PROJECT_ROOT = resolve(process.env.DEVHUB_PROJECT_ROOT || process.cwd())

// DEVHUB_ROOT = the devhub package itself (this file lives in src/).
const DEVHUB_ROOT = resolve(__dirname, '..')

function getMainGitDir(): string {
	const raw = execSync('git rev-parse --git-common-dir', { cwd: PROJECT_ROOT, encoding: 'utf8' }).trim()
	if (/^[A-Z]:/.test(raw) || raw.startsWith('/')) return raw
	return resolve(PROJECT_ROOT, raw)
}

const mainGitDir = getMainGitDir()

// DiffAgent repo root = the diffity monorepo this devhub lives in.
// devhub/src/../../.. → diffity/
const diffagentRoot = resolve(DEVHUB_ROOT, '..', '..')

export const config = {
	poolSize: 5,
	networkName: 'diluu-dev',
	cpuShares: 256,
	port: 3100,
	projectRoot: PROJECT_ROOT,
	worktreesDir: resolve(PROJECT_ROOT, '.worktrees'),
	dockerDir: resolve(DEVHUB_ROOT, 'docker'),
	backupDir: resolve(PROJECT_ROOT, '..', 'diluu-mongo-backups'),
	mainGitDir,
	gitRoot: resolve(mainGitDir, '..'),
	pinnedBranches: ['feature/version-3', 'master'],
	poolStatusFile: resolve(PROJECT_ROOT, '.worktrees', '.pool-status.json'),
	diffagentRoot,
	publicDir: resolve(DEVHUB_ROOT, 'src', 'public'),
}
