import { resolve } from 'node:path'
import { existsSync, writeFileSync, rmSync } from 'node:fs'
import { execFile as execFileCb } from 'node:child_process'
import { promisify } from 'node:util'
import { config } from '../config.js'
import { removeTask } from '../task-store.js'
import { pool } from '../pool.js'
import { dkr } from '../docker.js'
import { eventBus } from '../events.js'
import { replenishPool } from './replenish.js'
import { clearTeachers } from '../warmer.js'

const execFile = promisify(execFileCb)

export async function destroyTask(task: string): Promise<void> {
	const slot = pool.findTask(task)
	if (!slot) throw new Error(`Task not found: ${task}`)
	await destroyBySlot(slot, task)
}

export async function destroyBySlot(slot: string, taskName?: string): Promise<void> {
	const info = pool.getSlot(slot)
	const task = taskName ?? info?.task ?? slot
	const logLabel = task || slot

	eventBus.log('Destroying...', logLabel)

	// Stop containers
	try { await dkr('stop', `app-${slot}`, `mongo-${slot}`) } catch {}
	try { await dkr('rm', `app-${slot}`, `mongo-${slot}`) } catch {}

	// Remove worktree
	const worktreePath = resolve(config.worktreesDir, slot)
	if (existsSync(worktreePath)) {
		const worktreeGitDir = resolve(config.mainGitDir, 'worktrees', slot)
		try {
			writeFileSync(resolve(worktreePath, '.git'), `gitdir: ${worktreeGitDir}\n`)
		} catch {}
		try {
			await execFile('git', ['-C', config.gitRoot, 'worktree', 'remove', worktreePath, '--force'], {
				maxBuffer: 10 * 1024 * 1024,
			})
		} catch {}
		try { rmSync(worktreePath, { recursive: true, force: true }) } catch {}
		try { rmSync(worktreeGitDir, { recursive: true, force: true }) } catch {}
		try {
			await execFile('git', ['-C', config.gitRoot, 'worktree', 'prune'], {
				maxBuffer: 10 * 1024 * 1024,
			})
		} catch {}
	}

	// Remove volumes
	try { await dkr('volume', 'rm', `diluu-mongo-${slot}`, `diluu-nm-${slot}`) } catch {}

	pool.removeSlot(slot)
	eventBus.emit({ type: 'task-update', data: pool.listActive() })
	if (task) {
		removeTask(task)
		clearTeachers(task)
	}
	eventBus.log('Destroyed', logLabel)

	// Replenish in background
	replenishPool().catch(() => {})
}
