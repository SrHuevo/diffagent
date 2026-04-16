import { readdirSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { config } from './config.js'
import type { BackupInfo } from './types.js'

export function listBackups(): BackupInfo[] {
	try {
		return readdirSync(config.backupDir)
			.filter((e) => e.startsWith('diluu__'))
			.map((e) => ({ name: e, mtime: statSync(resolve(config.backupDir, e)).mtime.toISOString() }))
			// Names include an ISO date suffix, so descending alphabetical = newest first.
			.sort((a, b) => b.name.localeCompare(a.name))
	} catch {
		return []
	}
}

export function getLatestBackup(): string | null {
	const all = listBackups()
	return all[0] ? resolve(config.backupDir, all[0].name) : null
}

export function getBackupPath(name: string): string | null {
	if (!name.startsWith('diluu__')) return null
	const all = listBackups()
	const match = all.find((b) => b.name === name)
	return match ? resolve(config.backupDir, match.name) : null
}
