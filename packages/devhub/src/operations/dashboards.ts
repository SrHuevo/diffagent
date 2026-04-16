import { pool } from '../pool.js'
import { dkr, sanitizeBranch, sleep } from '../docker.js'
import { eventBus } from '../events.js'

const DASHBOARD_CONFIG = {
	teachers: { port: 5173, package: 'teachers-dashboard' },
	students: { port: 5174, package: 'students-dashboard' },
} as const

type DashboardType = keyof typeof DASHBOARD_CONFIG

export async function isViteRunning(slot: string, dashboard: DashboardType): Promise<boolean> {
	const { port } = DASHBOARD_CONFIG[dashboard]
	try {
		await dkr('exec', `app-${slot}`, 'curl', '-s', '-o', '/dev/null', '-w', '%{http_code}', `http://localhost:${port}`)
		return true
	} catch {
		return false
	}
}

function getDashboardUrl(task: string, dashboard: DashboardType): string {
	const safe = sanitizeBranch(task)
	// Teachers: use main app URL — Express proxies non-API requests to Vite on 5173
	// Students: needs dedicated subdomain (no Express proxy for it)
	return dashboard === 'teachers'
		? `http://${safe}.localhost`
		: `http://students.${safe}.localhost`
}

export async function startVite(task: string, dashboard: DashboardType): Promise<{ url: string; started: boolean }> {
	const slot = pool.findTask(task)
	if (!slot) throw new Error(`Task not found: ${task}`)

	const { port, package: pkg } = DASHBOARD_CONFIG[dashboard]
	const info = pool.getSlot(slot)
	if (!info) throw new Error(`Slot not found: ${slot}`)

	const url = getDashboardUrl(info.task, dashboard)

	// Check if already running
	if (await isViteRunning(slot, dashboard)) {
		return { url, started: false }
	}

	eventBus.log(`Starting ${dashboard}-dashboard Vite...`, task)

	// Start Vite with --base matching the proxy path so all module imports use the correct prefix.
	// CHOKIDAR_USEPOLLING is required because Windows→Linux bind-mounts don't deliver inotify events.
	const safe = sanitizeBranch(info.task)
	const viteBase = `/${safe}/${dashboard}/`
	await dkr(
		'exec', '-d', `app-${slot}`,
		'bash', '-c',
		`cd /app/packages/${pkg} && CHOKIDAR_USEPOLLING=1 CHOKIDAR_INTERVAL=1000 npx vite --host 0.0.0.0 --port ${port} --base ${viteBase} >> /app/.logs/${dashboard}-vite.log 2>&1`,
	)

	// Wait for Vite to be ready
	for (let i = 0; i < 30; i++) {
		await sleep(1000)
		if (await isViteRunning(slot, dashboard)) {
			pool.setViteStatus(slot, dashboard, true)
			eventBus.log(`${dashboard}-dashboard ready`, task)
			return { url, started: true }
		}
	}

	throw new Error(`Vite ${dashboard} failed to start within 30s`)
}
