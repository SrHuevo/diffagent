import { resolve } from 'node:path'
import { copyFileSync } from 'node:fs'
import { config } from '../config.js'
import { pool } from '../pool.js'
import { dkr, sanitizeBranch, sleep } from '../docker.js'
import { eventBus } from '../events.js'
import { getTunnelUrl } from '../tunnel.js'
import { setTaskStatus } from '../task-store.js'
import { runUnifiedContainer } from './container.js'
import { refreshTeachers } from '../warmer.js'
import type { TaskView } from '../types.js'

export async function resumeTask(task: string): Promise<TaskView> {
	// Find the stopped slot for this task
	const state = pool.read()
	const entry = Object.entries(state.slots).find(([, v]) => v.task === task && v.status === 'stopped')
	if (!entry) throw new Error(`No stopped task found: ${task}`)

	const [slot, info] = entry
	const safe = sanitizeBranch(task)
	const baseBranch = info.baseBranch || 'feature/version-3'

	eventBus.log(`Resuming from ${slot}...`, task)
	pool.setSlot(slot, 'active', task, baseBranch)

	// Refresh credentials before recreating the container
	const home = process.env.HOME || process.env.USERPROFILE || ''
	const worktreePath = resolve(config.worktreesDir, slot)
	try {
		copyFileSync(resolve(home, '.claude/.credentials.json'), resolve(worktreePath, '.claude-session/.credentials.json'))
		copyFileSync(resolve(home, '.claude.json'), resolve(worktreePath, '.claude-session/.claude.json'))
	} catch {}

	// Start MongoDB
	eventBus.log('Starting MongoDB...', task)
	try { await dkr('start', `mongo-${slot}`) } catch {}
	try {
		const inspect = await dkr('inspect', `mongo-${slot}`, '--format',
			'{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}')
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

	// Start the unified container (same as activate but without the checkout)
	eventBus.log('Starting services...', task)
	try { await dkr('rm', '-f', `app-${slot}`) } catch {}
	await runUnifiedContainer(slot, task, baseBranch)

	// Wait for app
	eventBus.log('Waiting for backend...', task)
	for (let i = 0; i < 60; i++) {
		try {
			await dkr('exec', `app-${slot}`, 'curl', '-s', 'http://localhost:3001/health')
			break
		} catch { await sleep(2000) }
	}

	eventBus.log('Ready!', task)
	setTaskStatus(task, 'active')
	refreshTeachers(task).catch(() => {})

	// DiffAgent self-heals: if the previous session was interrupted mid-response
	// (last chat entry is a user msg without an assistant reply), it will send
	// "continúa" to Claude right after its HTTP server starts listening.

	const tunnelUrl = await getTunnelUrl()
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
				tunnelApp: `${tunnelUrl}/${safe}/`,
				tunnelDiffagent: `${tunnelUrl}/${safe}/diffagent/`,
				tunnelTeachers: `${tunnelUrl}/${safe}/teachers/`,
				tunnelStudents: `${tunnelUrl}/${safe}/students/`,
				tunnelClaude: `${tunnelUrl}/${safe}/claude/`,
			}),
		},
		viteTeachers: false,
		viteStudents: false,
	}

	eventBus.emit({ type: 'task-update', data: pool.listActive() })
	return view
}
