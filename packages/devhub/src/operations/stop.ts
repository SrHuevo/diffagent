import { pool } from '../pool.js'
import { dkr, sanitizeBranch } from '../docker.js'
import { eventBus } from '../events.js'
import { setTaskStatus } from '../task-store.js'

export async function stopTask(task: string): Promise<void> {
	const slot = pool.findTask(task)
	if (!slot) throw new Error(`Task not found: ${task}`)

	eventBus.log(`Stopping...`, task)

	try { await dkr('stop', `app-${slot}`, `mongo-${slot}`) } catch {}
	try { await dkr('rm', `app-${slot}`) } catch {}

	const info = pool.getSlot(slot)
	pool.setSlot(slot, 'stopped', task, info?.baseBranch)
	setTaskStatus(task, 'stopped')
	eventBus.emit({ type: 'task-update', data: pool.listActive() })
	eventBus.log(`Stopped (can be resumed)`, task)
}
