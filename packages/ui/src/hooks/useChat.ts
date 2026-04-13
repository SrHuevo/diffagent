import { useState, useEffect, useCallback } from 'react'
import { apiFetch, apiPost, apiUrl } from '../api'

export interface ChatMessage {
	role: 'user' | 'assistant' | 'system' | 'tool'
	content: string
	ts: string
	isStreaming?: boolean
	toolName?: string
	toolInput?: string
}

export function useChat() {
	const [messages, setMessages] = useState<ChatMessage[]>([])
	const [isProcessing, setIsProcessing] = useState(false)

	useEffect(() => {
		apiFetch<{ messages: ChatMessage[] }>('/api/chat/history')
			.then(({ messages }) => setMessages(messages))
			.catch(() => {})
	}, [])

	const send = useCallback(async (content: string) => {
		if (!content.trim() || isProcessing) return
		setIsProcessing(true)

		const userMsg: ChatMessage = { role: 'user', content, ts: new Date().toISOString() }
		setMessages((prev) => [...prev, userMsg])

		// Streaming assistant placeholder
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

							if (currentEvent === 'message') {
								// Tool use events
								if (data.type === 'assistant' && data.message?.content) {
									for (const block of data.message.content) {
										if (block.type === 'tool_use') {
											const toolMsg: ChatMessage = {
												role: 'tool',
												content: '',
												ts: new Date().toISOString(),
												toolName: block.name,
												toolInput: typeof block.input === 'string' ? block.input :
													block.input?.command || block.input?.file_path || block.input?.pattern ||
													JSON.stringify(block.input).substring(0, 200),
											}
											setMessages((prev) => {
												const withoutStreaming = prev.filter((m) => !m.isStreaming)
												return [...withoutStreaming, toolMsg, { role: 'assistant', content: fullText, ts: '', isStreaming: true }]
											})
										}
									}
								}
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
