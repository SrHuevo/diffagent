import http from 'node:http'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn, ChildProcess } from 'node:child_process'
import { sleep } from './docker.js'
import { config } from './config.js'

const CLOUDFLARED_LOG = join(tmpdir(), 'cloudflared.log')
const CLOUDFLARED_PID = join(tmpdir(), 'cloudflared.pid')

let cloudflaredChild: ChildProcess | null = null
let cachedTunnelUrl: string | null = null

// ─── ngrok ───

async function getNgrokUrl(): Promise<string | null> {
	return new Promise((resolve) => {
		const req = http.get('http://127.0.0.1:4040/api/tunnels', (res) => {
			let data = ''
			res.on('data', (c) => (data += c))
			res.on('end', () => {
				try {
					const tunnels = JSON.parse(data).tunnels
					resolve(tunnels[0]?.public_url || null)
				} catch {
					resolve(null)
				}
			})
		})
		req.on('error', () => resolve(null))
		req.setTimeout(2000, () => { req.destroy(); resolve(null) })
	})
}

// ─── cloudflared ───

function getCloudflaredUrl(): string | null {
	try {
		const log = readFileSync(CLOUDFLARED_LOG, 'utf8')
		const match = log.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/)
		return match ? match[0] : null
	} catch {
		return null
	}
}

function isProcessAlive(pid: number): boolean {
	if (!pid || Number.isNaN(pid)) return false
	try {
		process.kill(pid, 0) // signal 0 = check existence without killing
		return true
	} catch {
		return false
	}
}

function readPidFile(): number | null {
	try {
		const raw = readFileSync(CLOUDFLARED_PID, 'utf8').trim()
		const pid = parseInt(raw, 10)
		return pid || null
	} catch {
		return null
	}
}

// ─── Public API ───

export async function getTunnelUrl(): Promise<string | null> {
	if (cachedTunnelUrl) return cachedTunnelUrl
	// Manual override (e.g. Tailscale Funnel URL)
	if (process.env.DEVHUB_TUNNEL_URL) {
		cachedTunnelUrl = process.env.DEVHUB_TUNNEL_URL.replace(/\/$/, '')
		return cachedTunnelUrl
	}
	// If a previous dev-hub run left cloudflared alive, pick up its URL
	const priorPid = readPidFile()
	if (priorPid && isProcessAlive(priorPid)) {
		const url = getCloudflaredUrl()
		if (url) {
			cachedTunnelUrl = url
			return url
		}
	}
	return getNgrokUrl()
}

export async function ensureTunnel(): Promise<string | null> {
	// Manual override — skip cloudflared entirely
	if (process.env.DEVHUB_TUNNEL_URL) {
		cachedTunnelUrl = process.env.DEVHUB_TUNNEL_URL.replace(/\/$/, '')
		return cachedTunnelUrl
	}

	// Already managing cloudflared in this process
	if (cachedTunnelUrl && cloudflaredChild && cloudflaredChild.exitCode === null) {
		return cachedTunnelUrl
	}

	// Reuse cloudflared from a previous dev-hub run if its PID is still alive.
	// This keeps bookmarks valid across dev-hub restarts.
	const priorPid = readPidFile()
	if (priorPid && isProcessAlive(priorPid)) {
		const url = getCloudflaredUrl()
		if (url) {
			console.log(`[tunnel] reusing existing cloudflared (pid ${priorPid}): ${url}`)
			cachedTunnelUrl = url
			return url
		}
	}

	// Stale PID file — clean it up
	try { unlinkSync(CLOUDFLARED_PID) } catch {}

	// Truncate the log so getCloudflaredUrl doesn't read a stale URL while we wait
	try { writeFileSync(CLOUDFLARED_LOG, '') } catch {}

	try {
		// --logfile/--pidfile are written by cloudflared itself, bypassing the
		// Windows cmd.exe shim that would otherwise swallow stderr and mask the
		// real cloudflared.exe PID.
		// Point the tunnel at the devhub itself (not Traefik) so it works the
		// same whether the devhub runs on Windows, WSL, or a container — we
		// don't depend on traefik being able to reach the devhub host, which
		// is unreliable under Docker-Desktop-on-WSL2 (`host.docker.internal`
		// resolves to the Docker VM, not the WSL distro).
		// The devhub's own path-based proxy (proxy.ts::tryProxy) routes
		// /${task}/* to the right container — no traefik needed for tunnel
		// traffic. Host-based routing (`app.task.localhost`) still uses
		// traefik for local browser access.
		cloudflaredChild = spawn(
			'cloudflared',
			[
				'tunnel',
				'--url', `http://localhost:${config.port}`,
				'--logfile', CLOUDFLARED_LOG,
				'--pidfile', CLOUDFLARED_PID,
			],
			{
				stdio: 'ignore',
				shell: true,
				detached: true,
				windowsHide: true,
			},
		)

		// Detach: cloudflared survives dev-hub restarts so the trycloudflare URL
		// remains stable and bookmarks keep working.
		cloudflaredChild.unref()

		cloudflaredChild.on('exit', (code) => {
			cachedTunnelUrl = null
			cloudflaredChild = null
			try { unlinkSync(CLOUDFLARED_PID) } catch {}
			console.error(`[tunnel] cloudflared exited with code ${code}`)
		})

		for (let i = 0; i < 30; i++) {
			await sleep(1000)
			const url = getCloudflaredUrl()
			if (url) {
				cachedTunnelUrl = url
				return url
			}
		}
	} catch {}

	return null
}
