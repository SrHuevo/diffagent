import { pool } from './pool.js'
import { dkr } from './docker.js'
import { listBackups } from './backups.js'
import { eventBus } from './events.js'
import type { BackupInfo } from './types.js'

interface Teacher { id: string; name: string; god: boolean }

let backupsCache: BackupInfo[] = []
const teachersCache = new Map<string, Teacher[]>()

export function getBackupsCached(): BackupInfo[] {
	return backupsCache
}

export function refreshBackups(): void {
	try {
		backupsCache = listBackups()
	} catch (err: any) {
		eventBus.log(`Backups refresh failed: ${err.message}`)
	}
}

export function getTeachersCached(task: string): Teacher[] | null {
	return teachersCache.get(task) ?? null
}

export async function refreshTeachers(task: string): Promise<void> {
	const slot = pool.findTask(task)
	if (!slot) return
	try {
		const json = await dkr(
			'exec', `mongo-${slot}`, 'mongosh', '--quiet', '--eval',
			`var ts=db.getSiblingDB('diluu').teachers.find({},{id:1,name:1}).sort({name:1}).toArray().map(t=>({id:t.id,name:t.name,god:t.name==='GOD'}));ts.sort((a,b)=>(b.god?1:0)-(a.god?1:0));JSON.stringify(ts)`,
		)
		teachersCache.set(task, JSON.parse(json))
	} catch (err: any) {
		eventBus.log(`Teachers refresh failed: ${err.message?.slice(0, 120)}`, task)
	}
}

export function clearTeachers(task: string): void {
	teachersCache.delete(task)
}
