import { useState, useEffect, useCallback } from 'react'
import { apiFetch, apiPost } from '../api'

export interface Comment {
	id: string
	authorName: string
	authorType: 'user' | 'agent'
	body: string
	createdAt: string
}

export interface Thread {
	id: string
	filePath: string
	side: 'old' | 'new'
	startLine: number
	endLine: number
	status: 'open' | 'resolved' | 'dismissed'
	comments: Comment[]
}

export function useThreads(sessionId: string | null | undefined) {
	const [threads, setThreads] = useState<Thread[]>([])

	const refresh = useCallback(async () => {
		if (!sessionId) return
		const data = await apiFetch<Thread[]>(`/api/threads?session=${sessionId}`)
		setThreads(data)
	}, [sessionId])

	useEffect(() => {
		refresh()
	}, [refresh])

	const createThread = useCallback(async (opts: {
		filePath: string
		side: 'old' | 'new'
		startLine: number
		endLine: number
		body: string
	}) => {
		if (!sessionId) return
		await apiPost('/api/threads', {
			sessionId,
			...opts,
			author: { name: 'User', type: 'user' },
		})
		refresh()
	}, [sessionId, refresh])

	const reply = useCallback(async (threadId: string, body: string) => {
		await apiPost(`/api/threads/${threadId}/reply`, {
			body,
			author: { name: 'User', type: 'user' },
		})
		refresh()
	}, [refresh])

	const resolve = useCallback(async (threadId: string) => {
		await apiFetch(`/api/threads/${threadId}/status`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ status: 'resolved' }),
		})
		refresh()
	}, [refresh])

	return { threads, refresh, createThread, reply, resolve }
}
