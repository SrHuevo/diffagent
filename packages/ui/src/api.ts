// Strip credentials from origin (browser includes them after Basic Auth login)
const cleanOrigin = `${location.protocol}//${location.host}`
const basePath = import.meta.env.BASE_URL.replace(/\/+$/, '')

export function apiUrl(path: string): string {
	if (path.startsWith('http')) return path
	const resolved = path.startsWith('/') ? `${basePath}${path}` : path
	// Ensure absolute URL without credentials
	if (resolved.startsWith('/')) return `${cleanOrigin}${resolved}`
	return `${cleanOrigin}/${resolved}`
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
