import { createServer, IncomingMessage, ServerResponse } from 'node:http'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { pool } from './pool.js'
import { config } from './config.js'
import { dkr, sanitizeBranch } from './docker.js'
import { eventBus } from './events.js'
import { listBranches, getWorktreeChanges } from './git.js'
import { getBackupsCached, refreshBackups, getTeachersCached, refreshTeachers } from './warmer.js'
import { getTunnelUrl, ensureTunnel } from './tunnel.js'
import { warmupPool } from './operations/warmup.js'
import { activateTask } from './operations/activate.js'
import { stopTask } from './operations/stop.js'
import { destroyTask, destroyBySlot } from './operations/destroy.js'
import { resumeTask } from './operations/resume.js'
import { finishTask } from './operations/finish.js'
import { startVite, isViteRunning } from './operations/dashboards.js'
import { tryProxy, attachUpgradeProxy } from './proxy.js'
import type { TaskCreateRequest, TaskFinishRequest, TaskView } from './types.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

// ─── Helpers ───

function sendJson(res: ServerResponse, status: number, data: unknown): void {
	res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
	res.end(JSON.stringify(data))
}

function sendError(res: ServerResponse, status: number, message: string): void {
	sendJson(res, status, { error: message })
}

async function parseBody<T>(req: IncomingMessage): Promise<T> {
	return new Promise((resolve, reject) => {
		let data = ''
		req.on('data', (c) => (data += c))
		req.on('end', () => {
			try { resolve(JSON.parse(data)) } catch { reject(new Error('Invalid JSON')) }
		})
	})
}

function buildTaskView(slot: string, tunnelUrl: string | null): TaskView | null {
	const info = pool.getSlot(slot)
	if (!info || info.status !== 'active') return null
	const safe = sanitizeBranch(info.task)
	return {
		slot,
		task: info.task,
		safeName: safe,
		status: info.status,
		baseBranch: info.baseBranch || '',
		urls: {
			app: `http://${safe}.localhost`,
			diffagent: `http://diffagent.${safe}.localhost`,
			teachers: `http://teachers.${safe}.localhost`,
			students: `http://students.${safe}.localhost`,
			claude: `http://claude.${safe}.localhost`,
			...(tunnelUrl && {
				tunnelApp: `${tunnelUrl}/${safe}/`,
				tunnelDiffagent: `${tunnelUrl}/${safe}/diffagent/`,
				tunnelTeachers: `${tunnelUrl}/${safe}/teachers/`,
				tunnelStudents: `${tunnelUrl}/${safe}/students/`,
				tunnelClaude: `${tunnelUrl}/${safe}/claude/`,
			}),
		},
		viteTeachers: info.viteTeachers ?? false,
		viteStudents: info.viteStudents ?? false,
	}
}

// ─── Route Definitions ───

type Handler = (req: IncomingMessage, res: ServerResponse, params: Record<string, string>) => Promise<void>

interface Route {
	method: string
	pattern: RegExp
	keys: string[]
	handler: Handler
}

function route(method: string, path: string, handler: Handler): Route {
	const keys: string[] = []
	const pattern = new RegExp(
		'^' + path.replace(/:(\w+)/g, (_, key) => { keys.push(key); return '([^/]+)' }) + '$',
	)
	return { method, pattern, keys, handler }
}

const routes: Route[] = [
	// Dashboard HTML
	route('GET', '/', async (_req, res) => {
		const html = readFileSync(resolve(__dirname, 'public/index.html'), 'utf8')
		res.writeHead(200, { 'Content-Type': 'text/html' })
		res.end(html)
	}),

	// Pool status
	route('GET', '/api/pool', async (_req, res) => {
		sendJson(res, 200, pool.read())
	}),

	// Branches
	route('GET', '/api/branches', async (_req, res) => {
		const branches = await listBranches()
		sendJson(res, 200, branches)
	}),

	// Backups — SWR: serve cached, refresh in background for next request.
	route('GET', '/api/backups', async (_req, res) => {
		if (getBackupsCached() === null) refreshBackups()
		sendJson(res, 200, getBackupsCached() ?? [])
		setImmediate(() => refreshBackups())
	}),

	// Tasks list
	route('GET', '/api/tasks', async (_req, res) => {
		const tunnelUrl = await getTunnelUrl()
		const active = pool.listActive()
		const tasks = active.map(({ slot }) => buildTaskView(slot, tunnelUrl)).filter(Boolean)
		sendJson(res, 200, tasks)
	}),

	// Create task
	route('POST', '/api/tasks', async (req, res) => {
		const body = await parseBody<TaskCreateRequest>(req)
		if (!body.name?.trim()) return sendError(res, 400, 'Task name required')
		if (!body.baseBranch?.trim()) return sendError(res, 400, 'Base branch required')

		const freeSlot = pool.getFree()
		if (!freeSlot) return sendError(res, 503, 'No free slots available')

		// Return immediately, activate in background
		sendJson(res, 202, { slot: freeSlot, message: 'Activating...' })

		const backup = body.backup?.trim() || undefined
		activateTask(freeSlot, body.name.trim(), body.baseBranch.trim(), backup).catch((err) => {
			console.error(`[ACTIVATE ERROR] ${body.name}:`, err)
			eventBus.log(`Activation failed: ${err.message}`, body.name)
			eventBus.emit({ type: 'error', data: { task: body.name, error: err.message } })
		})
	}),

	// Stop task
	route('POST', '/api/tasks/:task/stop', async (_req, res, { task }) => {
		try {
			await stopTask(task)
			sendJson(res, 200, { ok: true })
		} catch (err: any) {
			sendError(res, 404, err.message)
		}
	}),

	// Restart task (stop + resume in one click)
	route('POST', '/api/tasks/:task/restart', async (_req, res, { task }) => {
		sendJson(res, 202, { message: 'Restarting...' })
		try {
			await stopTask(task)
			await resumeTask(task)
		} catch (err: any) {
			console.error(`[RESTART ERROR] ${task}:`, err)
			eventBus.log(`Restart failed: ${err.message}`, task)
		}
	}),

	// Destroy task
	route('POST', '/api/tasks/:task/destroy', async (_req, res, { task }) => {
		sendJson(res, 202, { message: 'Destroying...' })
		destroyTask(task).catch((err) => {
			eventBus.emit({ type: 'error', data: { task, error: err.message } })
		})
	}),

	// Destroy by slot (recovers orphan slots whose task name is empty/lost)
	route('POST', '/api/slots/:slot/destroy', async (_req, res, { slot }) => {
		sendJson(res, 202, { message: 'Destroying...' })
		destroyBySlot(slot).catch((err) => {
			eventBus.emit({ type: 'error', data: { task: slot, error: err.message } })
		})
	}),

	// Resume stopped task
	route('POST', '/api/tasks/:task/resume', async (_req, res, { task }) => {
		sendJson(res, 202, { message: 'Resuming...' })
		resumeTask(task).catch((err) => {
			console.error(`[RESUME ERROR] ${task}:`, err)
			eventBus.log(`Resume failed: ${err.message}`, task)
			eventBus.emit({ type: 'error', data: { task, error: err.message } })
		})
	}),

	// List stopped tasks
	route('GET', '/api/tasks/stopped', async (_req, res) => {
		const { getStoppedTasks } = await import('./task-store.js')
		sendJson(res, 200, getStoppedTasks())
	}),

	// Get changes for finish modal
	route('GET', '/api/tasks/:task/changes', async (_req, res, { task }) => {
		const slot = pool.findTask(task)
		if (!slot) return sendError(res, 404, 'Task not found')
		const changes = await getWorktreeChanges(slot)
		sendJson(res, 200, changes)
	}),

	// Finish task
	route('POST', '/api/tasks/:task/finish', async (req, res, { task }) => {
		const body = await parseBody<TaskFinishRequest>(req)
		sendJson(res, 202, { message: 'Finishing...' })
		finishTask(task, body).then((result) => {
			eventBus.emit({ type: 'log', data: { ts: new Date().toISOString(), message: `PR: ${result.prUrl}`, slot: task } })
		}).catch((err) => {
			eventBus.emit({ type: 'error', data: { task, error: err.message } })
		})
	}),

	// Start Vite on-demand
	route('POST', '/api/tasks/:task/vite/:dashboard', async (_req, res, { task, dashboard }) => {
		if (dashboard !== 'teachers' && dashboard !== 'students') {
			return sendError(res, 400, 'Invalid dashboard type')
		}
		try {
			const result = await startVite(task, dashboard)
			sendJson(res, 200, result)
		} catch (err: any) {
			sendError(res, 500, err.message)
		}
	}),

	// Check Vite status
	route('GET', '/api/tasks/:task/vite/:dashboard/status', async (_req, res, { task, dashboard }) => {
		if (dashboard !== 'teachers' && dashboard !== 'students') {
			return sendError(res, 400, 'Invalid dashboard type')
		}
		const slot = pool.findTask(task)
		if (!slot) return sendError(res, 404, 'Task not found')
		const running = await isViteRunning(slot, dashboard as 'teachers' | 'students')
		sendJson(res, 200, { running })
	}),

	// Teachers — SWR: serve cached, refresh in background for next request.
	// First hit (no cache) blocks on the mongo query since there's nothing to
	// serve yet; subsequent hits are instant and pick up fresh data next time.
	route('GET', '/api/tasks/:task/teachers', async (_req, res, { task }) => {
		const slot = pool.findTask(task)
		if (!slot) return sendError(res, 404, 'Task not found')
		if (!getTeachersCached(task)) await refreshTeachers(task)
		sendJson(res, 200, getTeachersCached(task) ?? [])
		setImmediate(() => refreshTeachers(task).catch(() => {}))
	}),

	// Host-computed repo info (avoids slow git in Docker)
	route('GET', '/api/host/info/:task', async (_req, res, { task }) => {
		const slot = pool.findTask(task)
		if (!slot) return sendError(res, 404, 'Task not found')
		const worktreePath = resolve(config.worktreesDir, slot)
		const info = pool.getSlot(slot)
		try {
			const { execSync } = await import('node:child_process')
			const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: worktreePath, encoding: 'utf8', timeout: 5000 }).trim()
			const name = worktreePath.split(/[\\/]/).pop() || 'app'
			sendJson(res, 200, { name, branch, root: worktreePath, description: `Changes from ${info?.baseBranch || 'HEAD'}` })
		} catch (err: any) {
			sendError(res, 500, err.message)
		}
	}),

	// Start Vite on-demand from DiffAgent
	route('POST', '/api/host/vite/:task/:dashboard', async (_req, res, { task, dashboard }) => {
		if (dashboard !== 'teachers' && dashboard !== 'students') return sendError(res, 400, 'Invalid dashboard')
		try {
			const { startVite } = await import('./operations/dashboards.js')
			const result = await startVite(task, dashboard as 'teachers' | 'students')
			sendJson(res, 200, result)
		} catch (err: any) {
			sendError(res, 500, err.message)
		}
	}),

	// Teachers list for DiffAgent teacher picker
	route('GET', '/api/host/teachers/:task', async (_req, res, { task }) => {
		const slot = pool.findTask(task)
		if (!slot) return sendError(res, 404, 'Task not found')
		try {
			const json = await dkr(
				'exec', `mongo-${slot}`, 'mongosh', '--quiet', '--eval',
				`var ts=db.getSiblingDB('diluu').teachers.find({},{id:1,name:1}).sort({name:1}).toArray().map(t=>({id:t.id,name:t.name,god:t.name==='GOD'}));ts.sort((a,b)=>(b.god?1:0)-(a.god?1:0));JSON.stringify(ts)`,
			)
			sendJson(res, 200, JSON.parse(json))
		} catch (err: any) {
			sendError(res, 500, err.message)
		}
	}),

	// Pull latest changes from base branch into worktree
	route('POST', '/api/host/pull/:task', async (_req, res, { task }) => {
		const slot = pool.findTask(task)
		if (!slot) return sendError(res, 404, 'Task not found')
		const worktreePath = resolve(config.worktreesDir, slot)
		const info = pool.getSlot(slot)
		const baseBranch = info?.baseBranch || 'feature/version-3'
		try {
			const { execSync } = await import('node:child_process')
			// Fetch latest and merge base branch
			execSync('git fetch origin', { cwd: worktreePath, encoding: 'utf8', timeout: 30000 })
			const result = execSync(`git merge origin/${baseBranch} --no-edit`, { cwd: worktreePath, encoding: 'utf8', timeout: 30000 })
			sendJson(res, 200, { ok: true, message: result.trim() || 'Up to date' })
		} catch (err: any) {
			sendError(res, 500, err.stderr || err.message)
		}
	}),

	// Update DiffAgent server in running container (git pull + rebuild, no image rebuild needed)
	route('POST', '/api/host/sync-diffagent/:task', async (_req, res, { task }) => {
		const slot = pool.findTask(task)
		if (!slot) return sendError(res, 404, 'Task not found')
		try {
			eventBus.log('Syncing DiffAgent...', task)
			const { execSync } = await import('node:child_process')
			// Pull latest code and rebuild inside the container
			const output = execSync(
				`docker exec app-${slot} bash -c "cd /opt/diffagent && git pull origin main 2>&1 && npm run build 2>&1"`,
				{ encoding: 'utf8', timeout: 120000 },
			)
			// Restart the container to pick up changes
			execSync(`docker restart app-${slot}`, { encoding: 'utf8', timeout: 30000 })
			eventBus.log('DiffAgent synced and restarted', task)
			sendJson(res, 200, { ok: true, output: output.substring(0, 500) })
		} catch (err: any) {
			eventBus.log(`DiffAgent sync failed: ${err.message?.substring(0, 200)}`, task)
			sendError(res, 500, err.stderr || err.message)
		}
	}),

	// Host-computed git diff (shortcut used by Diffity)
	route('GET', '/api/host/diff/:task', async (_req, res, { task }) => {
		const slot = pool.findTask(task)
		if (!slot) return sendError(res, 404, 'Task not found')
		const worktreePath = resolve(config.worktreesDir, slot)
		try {
			const { execSync } = await import('node:child_process')
			const diff = execSync('git diff HEAD', {
				cwd: worktreePath,
				encoding: 'utf8',
				maxBuffer: 50 * 1024 * 1024,
				timeout: 10000,
			})
			res.writeHead(200, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' })
			res.end(diff)
		} catch (err: any) {
			sendError(res, 500, err.message)
		}
	}),

	// Host-computed git command (20x faster than Docker bind mount)
	// Used by Diffity in Docker to avoid slow filesystem operations
	route('GET', '/api/host/git/:task', async (req, res, { task }) => {
		const slot = pool.findTask(task)
		if (!slot) return sendError(res, 404, 'Task not found')
		const worktreePath = resolve(config.worktreesDir, slot)
		const url = new URL(req.url || '/', `http://${req.headers.host}`)
		const cmd = url.searchParams.get('cmd')
		if (!cmd) return sendError(res, 400, 'cmd parameter required')
		try {
			const { execSync } = await import('node:child_process')
			const result = execSync(`git ${cmd}`, {
				cwd: worktreePath,
				encoding: 'utf8',
				maxBuffer: 50 * 1024 * 1024,
				timeout: 10000,
			})
			res.writeHead(200, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' })
			res.end(result)
		} catch (err: any) {
			sendError(res, 500, err.message)
		}
	}),

	// Warmup pool
	route('POST', '/api/warmup', async (_req, res) => {
		sendJson(res, 202, { message: 'Warming up...' })
		warmupPool().catch((err) => {
			eventBus.emit({ type: 'error', data: { error: err.message } })
		})
	}),

	// Ngrok
	route('GET', '/api/tunnel', async (_req, res) => {
		const url = await ensureTunnel()
		sendJson(res, 200, { url })
	}),

	// SSE events
	route('GET', '/api/events', async (_req, res) => {
		eventBus.addClient(res)
	}),
]

// ─── Server ───

const AUTH_USER = process.env.DEVHUB_USER || 'dgaroz'
const AUTH_PASS = process.env.DEVHUB_PASS || 'me87Qp8OtDyzgr'

function checkBasicAuth(req: IncomingMessage, res: ServerResponse): boolean {
	// Skip auth for localhost (local access doesn't need it)
	const host = req.headers.host || ''
	if (host.includes('localhost') || host.startsWith('127.0.0.1')) return true

	const auth = req.headers.authorization
	if (auth?.startsWith('Basic ')) {
		const decoded = Buffer.from(auth.slice(6), 'base64').toString()
		const [user, pass] = decoded.split(':')
		if (user === AUTH_USER && pass === AUTH_PASS) return true
	}

	res.writeHead(401, {
		'WWW-Authenticate': 'Basic realm="Diluu Dev Hub"',
		'Content-Type': 'text/plain',
	})
	res.end('Unauthorized')
	return false
}

export function createHttpServer() {
	const server = createServer(async (req, res) => {
		// Basic Auth for tunnel access (skip for localhost)
		if (!checkBasicAuth(req, res)) return

		// CORS preflight
		if (req.method === 'OPTIONS') {
			res.writeHead(204, {
				'Access-Control-Allow-Origin': '*',
				'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
				'Access-Control-Allow-Headers': 'Content-Type, Authorization',
			})
			return res.end()
		}

		const url = new URL(req.url || '/', `http://${req.headers.host}`)
		const path = url.pathname

		for (const r of routes) {
			if (r.method !== req.method) continue
			const match = path.match(r.pattern)
			if (!match) continue

			const params: Record<string, string> = {}
			r.keys.forEach((key, i) => { params[key] = decodeURIComponent(match[i + 1]) })

			try {
				await r.handler(req, res, params)
			} catch (err: any) {
				console.error(`Error in ${req.method} ${path}:`, err)
				if (!res.headersSent) sendError(res, 500, err.message)
			}
			return
		}

		// Fallback: proxy path-based requests to containers (for tunnel)
		// e.g. /remote/diffagent/* → diffagent container with HTML basename rewrite
		if (await tryProxy(req, res)) return

		sendError(res, 404, 'Not found')
	})

	attachUpgradeProxy(server)
	return server
}
