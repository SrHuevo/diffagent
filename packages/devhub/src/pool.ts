import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname } from 'node:path'
import { config } from './config.js'
import { eventBus } from './events.js'
import type { PoolState, SlotInfo, SlotStatus } from './types.js'

class Pool {
	private filePath = config.poolStatusFile

	read(): PoolState {
		try {
			return JSON.parse(readFileSync(this.filePath, 'utf8'))
		} catch {
			return { slots: {} }
		}
	}

	private write(state: PoolState): void {
		mkdirSync(dirname(this.filePath), { recursive: true })
		writeFileSync(this.filePath, JSON.stringify(state, null, 2))
		eventBus.emit({ type: 'pool-update', data: state })
	}

	init(): void {
		if (!existsSync(this.filePath)) this.write({ slots: {} })
	}

	setSlot(slot: string, status: SlotStatus, task = '', baseBranch = ''): void {
		const state = this.read()
		const existing = state.slots[slot]
		state.slots[slot] = {
			status,
			task,
			updated: new Date().toISOString(),
			baseBranch: baseBranch || existing?.baseBranch || '',
			viteTeachers: status === 'active' ? (existing?.viteTeachers ?? false) : false,
			viteStudents: status === 'active' ? (existing?.viteStudents ?? false) : false,
		}
		this.write(state)
	}

	removeSlot(slot: string): void {
		const state = this.read()
		delete state.slots[slot]
		this.write(state)
	}

	getFree(): string | null {
		const entry = Object.entries(this.read().slots).find(([, v]) => v.status === 'free')
		return entry ? entry[0] : null
	}

	countFree(): number {
		return Object.values(this.read().slots).filter((v) => v.status === 'free').length
	}

	countTotal(): number {
		return Object.keys(this.read().slots).length
	}

	getStatus(slot: string): SlotStatus | 'none' {
		return this.read().slots[slot]?.status ?? 'none'
	}

	getSlot(slot: string): SlotInfo | undefined {
		return this.read().slots[slot]
	}

	findTask(task: string): string | null {
		const entry = Object.entries(this.read().slots).find(([, v]) => v.task === task)
		return entry ? entry[0] : null
	}

	listActive(): Array<{ slot: string; info: SlotInfo }> {
		return Object.entries(this.read().slots)
			.filter(([, v]) => v.status === 'active')
			.map(([slot, info]) => ({ slot, info }))
	}

	setViteStatus(slot: string, dashboard: 'teachers' | 'students', running: boolean): void {
		const state = this.read()
		const info = state.slots[slot]
		if (!info) return
		if (dashboard === 'teachers') info.viteTeachers = running
		else info.viteStudents = running
		info.updated = new Date().toISOString()
		this.write(state)
	}

	getWarmingCount(): number {
		return Object.values(this.read().slots).filter((v) => v.status === 'warming').length
	}
}

export const pool = new Pool()
