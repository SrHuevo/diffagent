import type { ServerResponse } from 'node:http'
import type { SSEEvent } from './types.js'

class EventBus {
	private clients = new Set<ServerResponse>()

	addClient(res: ServerResponse): void {
		res.writeHead(200, {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache',
			Connection: 'keep-alive',
			'Access-Control-Allow-Origin': '*',
		})
		res.write('\n')
		this.clients.add(res)
		res.on('close', () => this.clients.delete(res))
	}

	emit(event: SSEEvent): void {
		const msg = `data: ${JSON.stringify(event)}\n\n`
		for (const client of this.clients) {
			client.write(msg)
		}
	}

	log(message: string, slot?: string): void {
		this.emit({ type: 'log', data: { ts: new Date().toISOString(), message, slot } })
		const prefix = slot ? `[${slot}] ` : ''
		console.log(`${prefix}${message}`)
	}
}

export const eventBus = new EventBus()
