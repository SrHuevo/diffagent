import { resolve } from 'node:path'
import { copyFileSync } from 'node:fs'
import { config } from '../config.js'
import { pool } from '../pool.js'
import { dkr, sanitizeBranch, sleep } from '../docker.js'
import { checkoutBranch } from '../git.js'
import { eventBus } from '../events.js'
import { replenishPool } from './replenish.js'
import { saveTask } from '../task-store.js'
import { getTunnelUrl } from '../tunnel.js'
import { getBackupPath } from '../backups.js'
import { runUnifiedContainer } from './container.js'
import { refreshTeachers } from '../warmer.js'
import type { TaskView } from '../types.js'

export async function activateTask(
	slot: string,
	task: string,
	baseBranch: string,
	backup?: string,
): Promise<TaskView> {
	const safe = sanitizeBranch(task)
	const worktreePath = resolve(config.worktreesDir, slot)
	const home = process.env.HOME || process.env.USERPROFILE || ''

	eventBus.log(`Activating from ${slot}...`, task)

	// 1. Mark active + refresh session files
	pool.setSlot(slot, 'active', task, baseBranch)
	try {
		copyFileSync(resolve(home, '.claude.json'), resolve(worktreePath, '.claude-session/.claude.json'))
	} catch {}

	// 2. Create branch (.git already has correct gitdir from warmup)
	eventBus.log('Creating branch...', task)
	await checkoutBranch(worktreePath, task, baseBranch)
	eventBus.log('Branch created', task)

	// 3. Start MongoDB
	eventBus.log('Starting MongoDB...', task)
	try { await dkr('start', `mongo-${slot}`) } catch {}
	try {
		const inspect = await dkr(
			'inspect', `mongo-${slot}`, '--format',
			'{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}',
		)
		for (const net of inspect.split(' ').filter(Boolean)) {
			try { await dkr('network', 'disconnect', net, `mongo-${slot}`) } catch {}
		}
	} catch {}
	try { await dkr('network', 'connect', config.networkName, `mongo-${slot}`) } catch {}
	try { await dkr('restart', `mongo-${slot}`) } catch {}
	for (let i = 0; i < 15; i++) {
		try {
			await dkr('exec', `mongo-${slot}`, 'mongosh', '--eval', 'db.runCommand({ping:1})')
			break
		} catch { await sleep(1000) }
	}

	// 3b. Re-restore from chosen backup if the user picked a non-default one
	if (backup) {
		const backupPath = getBackupPath(backup)
		if (backupPath) {
			eventBus.log(`Restoring ${backup}...`, task)
			try {
				await dkr('exec', `mongo-${slot}`, 'rm', '-rf', '/tmp/backup')
				await dkr('cp', backupPath, `mongo-${slot}:/tmp/backup`)
				await dkr('exec', `mongo-${slot}`, 'mongorestore', '--db', 'diluu', '--drop', '/tmp/backup/diluu/')
				await dkr('exec', `mongo-${slot}`, 'rm', '-rf', '/tmp/backup')
			} catch (err: any) {
				eventBus.log(`Restore warning: ${err.message?.slice(0, 120)}`, task)
			}
		} else {
			eventBus.log(`Backup '${backup}' not found — using warmed data`, task)
		}
	}

	// 4. Start the unified container (backend + DiffAgent + Vite on-demand)
	eventBus.log('Starting services...', task)
	try { await dkr('rm', '-f', `app-${slot}`) } catch {}
	await runUnifiedContainer(slot, task, baseBranch)

	// 5. Wait for app
	eventBus.log('Waiting for backend...', task)
	for (let i = 0; i < 60; i++) {
		try {
			await dkr('exec', `app-${slot}`, 'curl', '-s', 'http://localhost:3001/health')
			break
		} catch { await sleep(2000) }
	}

	eventBus.log('Ready!', task)

	// Persist task state
	saveTask({ name: task, slot, baseBranch, status: 'active' })

	// Precompute teacher list so the dropdown is instant the first time
	refreshTeachers(task).catch(() => {})

	const tunnelUrl = await getTunnelUrl()

	// Replenish in background
	replenishPool().catch(() => {})

	const view: TaskView = {
		slot,
		task,
		safeName: safe,
		status: 'active',
		baseBranch,
		urls: {
			app: `http://${safe}.localhost`,
			diffagent: `http://diffagent.${safe}.localhost`,
			teachers: `http://teachers.${safe}.localhost`,
			students: `http://students.${safe}.localhost`,
			claude: `http://claude.${safe}.localhost`,
			...(tunnelUrl && {
				tunnelApp: `${tunnelUrl}/${safe}`,
				tunnelDiffagent: `${tunnelUrl}/${safe}/diffagent`,
				tunnelTeachers: `${tunnelUrl}/${safe}/teachers`,
				tunnelStudents: `${tunnelUrl}/${safe}/students`,
				tunnelClaude: `${tunnelUrl}/${safe}/claude`,
			}),
		},
		viteTeachers: false,
		viteStudents: false,
	}

	eventBus.emit({ type: 'task-update', data: pool.listActive() })
	return view
}

