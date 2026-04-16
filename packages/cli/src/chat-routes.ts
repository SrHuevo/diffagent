import type { IncomingMessage, ServerResponse } from 'node:http'
import { spawn } from 'node:child_process'
import { sendJson, sendError, readBody } from './http-utils.js'

const TMUX_SESSION = 'claude'

/**
 * Paste `text` into the running tmux session's Claude Code prompt and press
 * Enter. `tmux load-buffer -` accepts the payload on stdin so arbitrary
 * multi-line content (including special shell characters) is safe.
 *
 * DiffAgent runs as root; the tmux server lives under user 'dev' (claude
 * refuses --dangerously-skip-permissions as root) — so every tmux call is
 * wrapped in `su dev -c`.
 */
function tmuxAsDev(args: string[], stdin?: string): Promise<void> {
	return new Promise((resolve, reject) => {
		const cmd = ['tmux', ...args.map((a) => `'${a.replace(/'/g, `'\\''`)}'`)].join(' ')
		const p = spawn('su', ['dev', '-c', cmd])
		if (stdin != null) p.stdin.end(stdin)
		p.on('error', reject)
		p.on('exit', (code) => {
			if (code === 0) resolve()
			else reject(new Error(`su dev -c "${cmd}" exited ${code}`))
		})
	})
}

async function injectIntoClaudeSession(text: string): Promise<void> {
	await tmuxAsDev(['load-buffer', '-b', 'inject', '-'], text)
	await tmuxAsDev(['paste-buffer', '-b', 'inject', '-d', '-t', TMUX_SESSION])
	await tmuxAsDev(['send-keys', '-t', TMUX_SESSION, 'Enter'])
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
				await injectIntoClaudeSession(message)
				sendJson(res, { ok: true })
			})
			.catch((err) => sendError(res, 500, err.message))
		return true
	}

	return false
}
