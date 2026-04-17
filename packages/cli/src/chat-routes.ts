import type { IncomingMessage, ServerResponse } from 'node:http'
import { spawn } from 'node:child_process'
import { sendJson, sendError, readBody } from './http-utils.js'

const TMUX_SESSION = 'claude'

/**
 * Send literal text to the Claude tmux session via `send-keys -l`, then Enter.
 * Multi-line prompts are joined into a single line (Claude's Ink TUI treats
 * newlines in the input field as submit, so we flatten to spaces).
 *
 * DiffAgent runs as root; the tmux server lives under user 'dev' — so every
 * tmux call runs via `su dev -c`.
 */
function tmuxSendKeys(text: string): Promise<void> {
	const flat = text.replace(/\n/g, ' ').replace(/'/g, "'\\''")
	const cmd = `tmux send-keys -t ${TMUX_SESSION} -l '${flat}' \\; send-keys -t ${TMUX_SESSION} Enter`
	return new Promise((resolve, reject) => {
		const p = spawn('su', ['dev', '-c', cmd])
		p.on('error', reject)
		p.on('exit', (code) => {
			if (code === 0) resolve()
			else reject(new Error(`tmux send-keys exited ${code}`))
		})
	})
}

export function handleChatRoutes(
	req: IncomingMessage,
	res: ServerResponse,
	pathname: string,
): boolean {
	// POST /api/chat/inject — paste a prompt into the running Claude tmux session
	if (pathname === '/api/chat/inject' && req.method === 'POST') {
		readBody(req)
			.then(async (body) => {
				const { message } = JSON.parse(body)
				if (typeof message !== 'string' || !message) {
					return sendError(res, 400, 'message (string) required')
				}
				await tmuxSendKeys(message)
				sendJson(res, { ok: true })
			})
			.catch((err) => sendError(res, 500, err.message))
		return true
	}

	return false
}
