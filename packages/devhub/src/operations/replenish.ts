import { config } from '../config.js'
import { pool } from '../pool.js'
import { warmupSlot } from './warmup.js'
import { eventBus } from '../events.js'

export async function replenishPool(): Promise<void> {
	for (let i = 1; i <= config.poolSize; i++) {
		const slot = `pool-${i}`
		const status = pool.getStatus(slot)
		if (status === 'none' || status === 'error') {
			eventBus.log(`Replenishing ${slot}...`)
			try {
				await warmupSlot(slot)
			} catch (err: any) {
				eventBus.log(`Replenish failed: ${err.message}`, slot)
				pool.setSlot(slot, 'error')
			}
		}
	}
}
