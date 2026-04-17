import http from 'node:http'
import type { IncomingMessage, ServerResponse, Server } from 'node:http'
import type { Socket } from 'node:net'
import { execSync } from 'node:child_process'
import { resolve } from 'node:path'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { pool } from './pool.js'
import { config } from './config.js'
import { sanitizeBranch } from './docker.js'

// --- File-based comment storage for DiffAgent ---

const COMMENTS_FILE = '.diffagent-comments.json'

interface CommentEntry {
	id: string
	author: string
	body: string
	ts: string
}

interface ThreadEntry {
	id: string
	filePath: string
	line: number
	side: 'old' | 'new'
	status: 'open' | 'resolved' | 'dismissed'
	comments: CommentEntry[]
}

interface CommentsStore {
	threads: ThreadEntry[]
}

function commentsFilePath(worktreePath: string): string {
	return resolve(worktreePath, COMMENTS_FILE)
}

function readComments(worktreePath: string): CommentsStore {
	const file = commentsFilePath(worktreePath)
	if (!existsSync(file)) return { threads: [] }
	try {
		return JSON.parse(readFileSync(file, 'utf8'))
	} catch {
		return { threads: [] }
	}
}

function writeComments(worktreePath: string, store: CommentsStore): void {
	writeFileSync(commentsFilePath(worktreePath), JSON.stringify(store, null, '\t'), 'utf8')
}

function genId(prefix: string): string {
	return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
}

async function readBody(req: http.IncomingMessage): Promise<any> {
	return new Promise((resolve, reject) => {
		let data = ''
		req.on('data', (c: Buffer) => (data += c))
		req.on('end', () => {
			try { resolve(JSON.parse(data)) } catch { reject(new Error('Invalid JSON')) }
		})
	})
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
	const json = JSON.stringify(body)
	res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
	res.end(json)
}

// Convert file-based thread format to the format the UI expects (useThreads.ts)
function toApiThread(t: ThreadEntry) {
	return {
		id: t.id,
		filePath: t.filePath,
		side: t.side,
		startLine: t.line,
		endLine: t.line,
		status: t.status,
		comments: t.comments.map((c) => ({
			id: c.id,
			authorName: c.author,
			authorType: c.author.toLowerCase() === 'claude' ? 'agent' : 'user',
			body: c.body,
			createdAt: c.ts,
		})),
	}
}

interface ProxyTarget {
	host: string
	stripPrefix: string
	rewriteBasePath: string | null
	forwardedPrefix: string
}

function resolveTarget(path: string): ProxyTarget | null {
	const parts = path.split('/').filter(Boolean)
	if (parts.length < 1) return null

	const active = pool.listActive()

	// Handle bare /api/* paths from SPA frontends (no task prefix)
	// These come from apps using root-relative API URLs like /api/teachers-dashboard/me
	// Route them to the first active task's app container
	if (parts[0] === 'api' && active.length > 0) {
		const taskSafe = sanitizeBranch(active[0].info.task)
		return {
			host: `${taskSafe}.localhost`,
			stripPrefix: '',
			rewriteBasePath: null,
			forwardedPrefix: '',
		}
	}

	const taskSafe = parts[0]
	const match = active.find(({ info }) => sanitizeBranch(info.task) === taskSafe)
	if (!match) return null

	const sub = parts[1]

	if (sub === 'diffagent') {
		return {
			host: `diffagent.${taskSafe}.localhost`,
			stripPrefix: `/${taskSafe}/diffagent`,
			rewriteBasePath: `/${taskSafe}/diffagent`,
			forwardedPrefix: `/${taskSafe}/diffagent`,
		}
	}
	if (sub === 'teachers') {
		return {
			host: `teachers.${taskSafe}.localhost`,
			stripPrefix: '',
			rewriteBasePath: null,
			forwardedPrefix: `/${taskSafe}/teachers`,
		}
	}
	if (sub === 'students') {
		return {
			host: `students.${taskSafe}.localhost`,
			stripPrefix: '',
			rewriteBasePath: null,
			forwardedPrefix: `/${taskSafe}/students`,
		}
	}
	if (sub === 'claude') {
		return {
			host: `claude.${taskSafe}.localhost`,
			stripPrefix: `/${taskSafe}/claude`,
			rewriteBasePath: null,
			forwardedPrefix: `/${taskSafe}/claude`,
		}
	}
	// Default: app/API — redirect to teachers base path after login
	return {
		host: `${taskSafe}.localhost`,
		stripPrefix: `/${taskSafe}`,
		rewriteBasePath: null,
		forwardedPrefix: `/${taskSafe}/teachers`,
	}
}

export async function tryProxy(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
	const url = new URL(req.url || '/', `http://${req.headers.host}`)
	const target = resolveTarget(url.pathname)
	if (!target) return false

	// Intercept slow Diffity git operations and resolve them on the host (20x faster)
	const targetPath = url.pathname.slice(target.stripPrefix.length) || '/'
	if (target.host.startsWith('diffagent.') && (targetPath.startsWith('/api/diff/raw') || targetPath.startsWith('/api/info') || targetPath.startsWith('/api/threads'))) {
		const parts = url.pathname.split('/').filter(Boolean)
		const taskSafe = parts[0]
		const active = pool.listActive()
		const match = active.find(({ info }) => sanitizeBranch(info.task) === taskSafe)
		if (match) {
			const slot = match.slot
			const worktreePath = resolve(config.worktreesDir, slot)
			if (targetPath.startsWith('/api/diff/raw')) {
				try {
					const diff = execSync('git diff HEAD', { cwd: worktreePath, encoding: 'utf8', maxBuffer: 50 * 1024 * 1024, timeout: 10000 })
					res.writeHead(200, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' })
					res.end(diff)
					return true
				} catch {}
			}
			if (targetPath.startsWith('/api/info')) {
				try {
					const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: worktreePath, encoding: 'utf8', timeout: 5000 }).trim()
					const info = match.info
					res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
					res.end(JSON.stringify({
						name: worktreePath.split(/[\\/]/).pop() || 'app',
						branch,
						root: worktreePath,
						description: `Changes from ${info.baseBranch || 'HEAD'}`,
						capabilities: { reviews: true, revert: true, staleness: false },
						sessionId: null,
					}))
					return true
				} catch {}
			}

			// --- Comment endpoints (file-based, fast host I/O) ---

			// CORS preflight for comment endpoints
			if (req.method === 'OPTIONS' && targetPath.startsWith('/api/threads')) {
				res.writeHead(204, {
					'Access-Control-Allow-Origin': '*',
					'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
					'Access-Control-Allow-Headers': 'Content-Type',
				})
				res.end()
				return true
			}

			// GET /api/threads?session=*
			if (req.method === 'GET' && targetPath.startsWith('/api/threads')) {
				const store = readComments(worktreePath)
				sendJson(res, 200, store.threads.map(toApiThread))
				return true
			}

			// POST /api/threads — create new thread
			if (req.method === 'POST' && targetPath === '/api/threads') {
				try {
					const body = await readBody(req)
					const store = readComments(worktreePath)
					const thread: ThreadEntry = {
						id: genId('t'),
						filePath: body.filePath,
						line: body.startLine,
						side: body.side || 'new',
						status: 'open',
						comments: [{
							id: genId('c'),
							author: body.author?.name || 'User',
							body: body.body,
							ts: new Date().toISOString(),
						}],
					}
					store.threads.push(thread)
					writeComments(worktreePath, store)
					sendJson(res, 201, toApiThread(thread))
				} catch (err: any) {
					sendJson(res, 400, { error: err.message })
				}
				return true
			}

			// POST /api/threads/:id/reply
			const replyMatch = targetPath.match(/^\/api\/threads\/([^/]+)\/reply$/)
			if (req.method === 'POST' && replyMatch) {
				try {
					const threadId = replyMatch[1]
					const body = await readBody(req)
					const store = readComments(worktreePath)
					const thread = store.threads.find((t) => t.id === threadId)
					if (!thread) { sendJson(res, 404, { error: 'Thread not found' }); return true }
					const comment: CommentEntry = {
						id: genId('c'),
						author: body.author?.name || 'User',
						body: body.body,
						ts: new Date().toISOString(),
					}
					thread.comments.push(comment)
					writeComments(worktreePath, store)
					sendJson(res, 201, toApiThread(thread))
				} catch (err: any) {
					sendJson(res, 400, { error: err.message })
				}
				return true
			}

			// PATCH /api/threads/:id/status
			const statusMatch = targetPath.match(/^\/api\/threads\/([^/]+)\/status$/)
			if (req.method === 'PATCH' && statusMatch) {
				try {
					const threadId = statusMatch[1]
					const body = await readBody(req)
					const store = readComments(worktreePath)
					const thread = store.threads.find((t) => t.id === threadId)
					if (!thread) { sendJson(res, 404, { error: 'Thread not found' }); return true }
					thread.status = body.status || 'resolved'
					writeComments(worktreePath, store)
					sendJson(res, 200, toApiThread(thread))
				} catch (err: any) {
					sendJson(res, 400, { error: err.message })
				}
				return true
			}
		}
	}

	// SPA sub-paths need trailing slash for relative asset resolution
	// e.g. /remote/teachers -> /remote/teachers/
	const parts = url.pathname.split('/').filter(Boolean)
	if (parts.length === 2 && !url.pathname.endsWith('/')) {
		res.writeHead(301, { Location: `${url.pathname}/${url.search}` })
		res.end()
		return true
	}

	const proxyPath = url.pathname.slice(target.stripPrefix.length) || '/'
	const targetUrl = `${proxyPath}${url.search}`

	// Build proxy headers
	const originalHost = req.headers.host || ''
	const headers: Record<string, string | string[] | undefined> = {
		...req.headers,
		host: target.host,
		'x-forwarded-host': originalHost,
		'x-forwarded-proto': originalHost.includes('trycloudflare.com') || originalHost.includes('ngrok') ? 'https' : 'http',
		'x-forwarded-prefix': target.forwardedPrefix,
	}
	// Strip accept-encoding for rewritable targets (need to read + rewrite HTML/manifest)
	if (target.rewriteBasePath) {
		delete headers['accept-encoding']
	}

	const proxyReq = http.request(
		{
			hostname: '127.0.0.1',
			port: 80,
			path: targetUrl,
			method: req.method,
			headers,
		},
		(proxyRes) => {
			const ct = proxyRes.headers['content-type'] || ''

			const needsRewrite = target.rewriteBasePath && (
				ct.includes('text/html') || proxyPath.match(/manifest.*\.js/)
			)

			if (needsRewrite) {
				// Buffer and rewrite HTML (basename) or manifest (module paths)
				const chunks: Buffer[] = []
				proxyRes.on('data', (c: Buffer) => chunks.push(c))
				proxyRes.on('end', () => {
					let body = Buffer.concat(chunks).toString()
					const base = target.rewriteBasePath!
					if (ct.includes('text/html')) {
						// React Router basename
						body = body.replace('"basename":"/"', `"basename":"${base}"`)
						// Vite dev server absolute paths: /@vite/client, /src/main.tsx, /@react-refresh
						body = body.replaceAll(' src="/', ` src="${base}/`)
						body = body.replaceAll(' href="/', ` href="${base}/`)
						body = body.replaceAll(' from "/', ` from "${base}/`)
						// Vite HMR base config
						body = body.replace('__BASE__="/"', `__BASE__="${base}/"`)
					} else {
						// Rewrite "./assets/x" → "/base/assets/x" in manifest JS
						// so dynamic import() resolves correctly from any module location
						body = body.replaceAll('"./assets/', `"${base}/assets/`)
						body = body.replaceAll("'./assets/", `'${base}/assets/`)
					}
					const resHeaders = { ...proxyRes.headers }
					delete resHeaders['content-encoding']
					delete resHeaders['transfer-encoding']
					resHeaders['content-length'] = String(Buffer.byteLength(body))
					res.writeHead(proxyRes.statusCode || 200, resHeaders)
					res.end(body)
				})
			} else {
				// Rewrite Location headers on redirects so they point back to the
				// original host (tunnel URL), not to internal addresses.
				const resHeaders = { ...proxyRes.headers }
				if (originalHost) {
					const isTunnel = originalHost.includes('trycloudflare.com') || originalHost.includes('.ts.net') || originalHost.includes('ngrok')
					const proto = isTunnel ? 'https' : 'http'
					if (resHeaders.location) {
						resHeaders.location = resHeaders.location
							.replace(/^https?:\/\/localhost:\d+/, `${proto}://${originalHost}`)
							.replace(/^https?:\/\/[^/]*\.localhost(?::\d+)?/, `${proto}://${originalHost}`)
					}
					// Relax SameSite for tunnel iframes (cross-scheme HTTPS→HTTP blocks Strict cookies)
					if (isTunnel && resHeaders['set-cookie']) {
						const cookies = Array.isArray(resHeaders['set-cookie']) ? resHeaders['set-cookie'] : [resHeaders['set-cookie']]
						resHeaders['set-cookie'] = cookies.map((c: string) =>
							c.replace(/SameSite=\w+/i, 'SameSite=None; Secure')
						)
					}
				}
				res.writeHead(proxyRes.statusCode || 200, resHeaders)
				proxyRes.pipe(res)
			}
		},
	)

	proxyReq.on('error', (err) => {
		if (!res.headersSent) {
			res.writeHead(502, { 'Content-Type': 'text/plain' })
			res.end(`Proxy error: ${err.message}`)
		}
	})

	req.pipe(proxyReq)
	return true
}

/**
 * Forward WebSocket upgrade requests through the same path routing as tryProxy.
 * Needed for ttyd (claude terminal) and potentially any other WS endpoint.
 * The upgrade is proxied to Traefik on port 80 with the rewritten Host header
 * so Traefik can route it to the right container/port.
 */
export function attachUpgradeProxy(server: Server): void {
	server.on('upgrade', (req: IncomingMessage, socket: Socket, head: Buffer) => {
		const url = new URL(req.url || '/', `http://${req.headers.host}`)
		const target = resolveTarget(url.pathname)
		if (!target) {
			socket.destroy()
			return
		}

		const proxyPath = url.pathname.slice(target.stripPrefix.length) || '/'
		const targetUrl = `${proxyPath}${url.search}`

		const upstream = http.request({
			hostname: '127.0.0.1',
			port: 80,
			path: targetUrl,
			method: req.method,
			headers: {
				...req.headers,
				host: target.host,
			},
		})

		upstream.on('upgrade', (upstreamRes, upstreamSocket, upstreamHead) => {
			// Tell the client the upgrade succeeded, copying upstream headers
			const headers = upstreamRes.headers
			let resp = `HTTP/1.1 101 Switching Protocols\r\n`
			for (const [k, v] of Object.entries(headers)) {
				if (v == null) continue
				resp += `${k}: ${Array.isArray(v) ? v.join(', ') : v}\r\n`
			}
			resp += '\r\n'
			socket.write(resp)
			if (upstreamHead.length) socket.write(upstreamHead)
			upstreamSocket.pipe(socket).pipe(upstreamSocket)
			upstreamSocket.on('error', () => socket.destroy())
			socket.on('error', () => upstreamSocket.destroy())
		})

		upstream.on('error', () => socket.destroy())
		upstream.on('response', (res) => {
			// Upstream refused to upgrade — relay the non-101 response and close.
			socket.write(`HTTP/1.1 ${res.statusCode} ${res.statusMessage}\r\n\r\n`)
			socket.destroy()
		})

		if (head.length) upstream.write(head)
		upstream.end()
	})
}
