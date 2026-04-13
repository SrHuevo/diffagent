import type { IncomingMessage, ServerResponse } from 'node:http'
import { getClaudeProcess, type ClaudeMessage } from './claude.js'
import { readChat, appendMessage, setSessionId, clearChat, ensureGitignore } from './chat-store.js'
import { sendJson, sendError, readBody } from './http-utils.js'

export function handleChatRoutes(
	req: IncomingMessage,
	res: ServerResponse,
	pathname: string,
	cwd: string,
): boolean {
	const claude = getClaudeProcess()
	claude.setCwd(cwd)

	// GET /api/chat/history
	if (pathname === '/api/chat/history' && req.method === 'GET') {
		const state = readChat()
		sendJson(res, { messages: state.messages })
		return true
	}

	// POST /api/chat/message — send message and stream response, persist both
	if (pathname === '/api/chat/message' && req.method === 'POST') {
		readBody(req)
			.then((body) => {
				const { message } = JSON.parse(body)

				if (claude.isRunning) {
					return sendError(res, 409, 'Claude is already processing a message')
				}

				// Persist user message
				appendMessage({ role: 'user', content: message, ts: new Date().toISOString() })

				// Restore session ID from chat state
				const state = readChat()
				if (state.sessionId) {
					// The ClaudeProcess singleton may have lost the sessionId (e.g. after restart)
					// We force resume by setting it via the chat state
				}

				// SSE response
				res.writeHead(200, {
					'Content-Type': 'text/event-stream',
					'Cache-Control': 'no-cache',
					Connection: 'keep-alive',
					'Access-Control-Allow-Origin': '*',
				})

				let fullText = ''

				const onText = (text: string) => {
					fullText += text
					res.write(`event: text\ndata: ${JSON.stringify({ text })}\n\n`)
				}
				const onMessage = (msg: ClaudeMessage) => {
					// Capture session ID for persistence
					if (msg.type === 'system' && msg.subtype === 'init' && msg.session_id) {
						setSessionId(msg.session_id as string)
					}
				}
				const onResult = (msg: ClaudeMessage) => {
					const result = msg.result || fullText
					appendMessage({ role: 'assistant', content: result, ts: new Date().toISOString() })
					res.write(`event: result\ndata: ${JSON.stringify({ result })}\n\n`)
					cleanup()
					res.end()
				}
				const onDone = () => {
					if (fullText) {
						appendMessage({ role: 'assistant', content: fullText, ts: new Date().toISOString() })
					}
					cleanup()
					res.end()
				}
				const onError = (err: Error) => {
					appendMessage({ role: 'system', content: `Error: ${err.message}`, ts: new Date().toISOString() })
					res.write(`event: error\ndata: ${JSON.stringify({ error: err.message })}\n\n`)
					cleanup()
					res.end()
				}

				function cleanup() {
					claude.off('text', onText)
					claude.off('message', onMessage)
					claude.off('result', onResult)
					claude.off('done', onDone)
					claude.off('error', onError)
				}

				claude.on('text', onText)
				claude.on('message', onMessage)
				claude.on('result', onResult)
				claude.on('done', onDone)
				claude.on('error', onError)

				req.on('close', () => cleanup())

				claude.send(message)
			})
			.catch((err) => sendError(res, 500, err.message))
		return true
	}

	// POST /api/chat/clear
	if (pathname === '/api/chat/clear' && req.method === 'POST') {
		clearChat()
		claude.reset()
		sendJson(res, { status: 'cleared' })
		return true
	}

	// Ensure .gitignore includes chat file on first chat route access
	if (pathname.startsWith('/api/chat/')) {
		ensureGitignore()
	}

	return false
}
