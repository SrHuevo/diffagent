import { config } from './config.js'
import { createHttpServer } from './server.js'
import { warmupPool } from './operations/warmup.js'
import { resumeTask } from './operations/resume.js'
import { eventBus } from './events.js'
import { getActiveTasks, ensureGitignore } from './task-store.js'
import { ensureTunnel } from './tunnel.js'
import { pool } from './pool.js'
import { dkr } from './docker.js'
import { refreshBackups, refreshTeachers } from './warmer.js'

async function warmTeachersForActive(): Promise<void> {
	// Precompute teachers for every currently-active task so the dropdown
	// is instant the first time, even for tasks that predated the warmer.
	for (const { info } of pool.listActive()) {
		refreshTeachers(info.task).catch(() => {})
	}
}

async function autoResumeTasks() {
	const activeTasks = getActiveTasks()
	if (activeTasks.length === 0) return

	eventBus.log(`Auto-resuming ${activeTasks.length} task(s)...`)

	for (const task of activeTasks) {
		try {
			eventBus.log(`Resuming ${task.name}...`)
			await resumeTask(task.name)
		} catch (err: any) {
			eventBus.log(`Failed to resume ${task.name}: ${err.message}`)
		}
	}
}

/**
 * For each slot marked `active` in pool-status, ensure the app-${slot}
 * container is actually running. Containers occasionally exit on dev-hub
 * restart (pipe termination during `docker restart`, etc.) and Traefik
 * can't route to them — dashboard routes return 404 until the container
 * is started again. Run this before auto-resume so reachable tasks are
 * reachable before anything else happens.
 */
async function reviveStaleContainers() {
	const state = pool.read()
	for (const [slot, info] of Object.entries(state.slots)) {
		if (info.status !== 'active') continue
		try {
			const status = await dkr('inspect', `app-${slot}`, '--format', '{{.State.Status}}')
			if (status.trim() === 'running') continue
			eventBus.log(`Reviving stopped container app-${slot} (${info.task})`)
			await dkr('start', `app-${slot}`)
			try {
				const mongoStatus = await dkr('inspect', `mongo-${slot}`, '--format', '{{.State.Status}}')
				if (mongoStatus.trim() !== 'running') await dkr('start', `mongo-${slot}`)
			} catch {}
		} catch {
			// Container doesn't exist at all — leave alone, it's an orphan slot
		}
	}
}

async function main() {
	ensureGitignore()
	refreshBackups()

	console.log('Diluu Dev Hub')
	console.log('='.repeat(40))
	console.log(`  Project: ${config.projectRoot}`)
	console.log(`  Pool size: ${config.poolSize}`)
	console.log(`  Git root: ${config.gitRoot}`)
	console.log()

	const server = createHttpServer()

	await new Promise<void>((resolve) => server.listen(config.port, resolve))

	console.log('Starting Cloudflare tunnel...')
	const tunnelUrl = await ensureTunnel()
	if (!tunnelUrl) {
		console.error()
		console.error('ERROR: Cloudflare tunnel is required but failed to start.')
		console.error('Make sure `cloudflared` is installed and reachable in PATH.')
		console.error('The Dev Hub only runs in tunnel mode.')
		process.exit(1)
	}

	console.log(`  Dashboard: ${tunnelUrl}`)
	console.log('='.repeat(40))
	console.log()

	// Warmup pool first, revive any stale containers, then auto-resume saved tasks
	warmupPool()
		.then(() => reviveStaleContainers())
		.then(() => autoResumeTasks())
		.then(() => warmTeachersForActive())
		.catch((err) => {
			eventBus.log(`Startup error: ${err.message}`)
		})

	// Watchdog: every 30s, re-check that every active task's container is still
	// running. Docker sometimes exits containers on `restart` or when pipes
	// break, and Traefik can't route until the container is up again.
	setInterval(() => {
		reviveStaleContainers().catch(() => {})
	}, 30000)
}

main().catch((err) => {
	console.error('Fatal:', err)
	process.exit(1)
})
