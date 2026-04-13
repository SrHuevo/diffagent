import { useState, useEffect, useCallback } from 'react'
import { apiFetch, apiPost, apiUrl } from '../api'

export interface ChatMessage {
	role: 'user' | 'assistant' | 'system'
	content: string
	ts: string
	isStreaming?: boolean
}

export function useChat() {
	const [messages, setMessages] = useState<ChatMessage[]>([])
	const [isProcessing, setIsProcessing] = useState(false)

	// Load persisted history on mount
	useEffect(() => {
		apiFetch<{ messages: ChatMessage[] }>('/api/chat/history')
			.then(({ messages }) => setMessages(messages))
			.catch(() => {})
	}, [])

	const send = useCallback(async (content: string) => {
		if (!content.trim() || isProcessing) return
		setIsProcessing(true)

		// Add user message optimistically
		const userMsg: ChatMessage = { role: 'user', content, ts: new Date().toISOString() }
		setMessages((prev) => [...prev, userMsg])

		// Add streaming placeholder
		const streamId = `stream-${Date.now()}`
		setMessages((prev) => [...prev, { role: 'assistant', content: '', ts: '', isStreaming: true }])

		try {
			const res = await fetch(apiUrl('/api/chat/message'), {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ message: content }),
			})

			if (!res.ok) {
				const err = await res.json().catch(() => ({ error: 'Unknown error' }))
				setMessages((prev) => prev.filter((m) => !m.isStreaming).concat({
					role: 'system', content: `Error: ${err.error}`, ts: new Date().toISOString(),
				}))
				setIsProcessing(false)
				return
			}

			// Read SSE stream
			const reader = res.body?.getReader()
			if (!reader) return

			const decoder = new TextDecoder()
			let buffer = ''
			let fullText = ''

			while (true) {
				const { done, value } = await reader.read()
				if (done) break

				buffer += decoder.decode(value, { stream: true })
				const lines = buffer.split('\n')
				buffer = lines.pop() || ''

				let currentEvent = ''
				for (const line of lines) {
					if (line.startsWith('event: ')) {
						currentEvent = line.slice(7)
					} else if (line.startsWith('data: ')) {
						try {
							const data = JSON.parse(line.slice(6))
							if (currentEvent === 'text') {
								fullText += data.text
								setMessages((prev) =>
									prev.map((m) => m.isStreaming ? { ...m, content: fullText } : m),
								)
							}
							if (currentEvent === 'result') {
								fullText = data.result || fullText
								setMessages((prev) =>
									prev.map((m) => m.isStreaming
										? { ...m, content: fullText, ts: new Date().toISOString(), isStreaming: false }
										: m,
									),
								)
							}
							if (currentEvent === 'error') {
								setMessages((prev) => prev.filter((m) => !m.isStreaming).concat({
									role: 'system', content: `Error: ${data.error}`, ts: new Date().toISOString(),
								}))
							}
						} catch {}
					}
				}
			}

			// Finalize if no result event came
			setMessages((prev) => prev.map((m) => m.isStreaming ? { ...m, isStreaming: false } : m))
		} catch (err: any) {
			setMessages((prev) => prev.filter((m) => !m.isStreaming).concat({
				role: 'system', content: `Error: ${err.message}`, ts: new Date().toISOString(),
			}))
		}

		setIsProcessing(false)
	}, [isProcessing])

	const clear = useCallback(async () => {
		await apiPost('/api/chat/clear').catch(() => {})
		setMessages([])
	}, [])

	return { messages, isProcessing, send, clear }
}
