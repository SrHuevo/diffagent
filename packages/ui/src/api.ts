// Strip credentials from origin (browser includes them after Basic Auth login)
const cleanOrigin = `${location.protocol}//${location.host}`

// Derive API base path from current URL pathname
// e.g. /task/diffagent/  → /task/diffagent
// e.g. /                 → (empty)
function getBasePath(): string {
	const path = location.pathname
	const match = path.match(/^(\/[^/]+\/diffagent)/)
	return match ? match[1] : ''
}

const basePath = getBasePath()

export function apiUrl(path: string): string {
	if (path.startsWith('http')) return path
	const fullPath = path.startsWith('/') ? `${basePath}${path}` : `${basePath}/${path}`
	return `${cleanOrigin}${fullPath}`
}

export async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
	const res = await fetch(apiUrl(url), init)
	if (!res.ok) {
		const json = await res.json().catch(() => null)
		throw new Error(json?.error || `HTTP ${res.status}`)
	}
	return res.json()
}

export async function apiPost<T>(url: string, body?: unknown): Promise<T> {
	return apiFetch(url, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: body ? JSON.stringify(body) : undefined,
	})
}
