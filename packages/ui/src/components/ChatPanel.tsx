import { useState, useRef, useEffect } from 'react'
import type { ChatMessage } from '../hooks/useChat'

function formatTime(ts: string): string {
	if (!ts) return ''
	try {
		return new Date(ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
	} catch { return '' }
}

interface Props {
	open: boolean
	onClose: () => void
	messages: ChatMessage[]
	isProcessing: boolean
	onSend: (message: string) => void
	onClear: () => void
}

export function ChatPanel({ open, onClose, messages, isProcessing, onSend, onClear }: Props) {
	const [input, setInput] = useState('')
	const messagesEndRef = useRef<HTMLDivElement>(null)
	const inputRef = useRef<HTMLTextAreaElement>(null)

	useEffect(() => {
		messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
	}, [messages])

	useEffect(() => {
		if (open) inputRef.current?.focus()
	}, [open])

	const handleSubmit = () => {
		if (!input.trim() || isProcessing) return
		onSend(input.trim())
		setInput('')
	}

	const handleKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === 'Enter' && e.ctrlKey) {
			e.preventDefault()
			handleSubmit()
		}
	}

	return (
		<>
			{open && <div className="drawer-backdrop" onClick={onClose} />}
			<aside className={`drawer drawer-right ${open ? 'open' : ''}`}>
				<div className="drawer-header">
					<h2>Claude Code</h2>
					<div className="drawer-header-actions">
						<button className="btn-text" onClick={onClear}>Clear</button>
						<button className="btn-icon" onClick={onClose}>✕</button>
					</div>
				</div>

				<div className="chat-messages">
					{messages.length === 0 && (
						<div className="chat-empty">Send a message to Claude Code</div>
					)}
					{messages.map((msg, i) => (
						msg.role === 'tool' ? (
							<div key={i} className="chat-msg chat-msg-tool">
								<div className="chat-tool">
									<span className="chat-tool-name">{msg.toolName}</span>
									{msg.toolInput && <span className="chat-tool-input">{msg.toolInput}</span>}
									{msg.ts && <span className="chat-msg-time">{formatTime(msg.ts)}</span>}
								</div>
							</div>
						) : (
							<div key={i} className={`chat-msg chat-msg-${msg.role}`}>
								<div className="chat-msg-meta">
									<span className="chat-msg-author">
										{msg.role === 'user' ? 'You' : msg.role === 'assistant' ? 'Claude' : 'System'}
									</span>
									{msg.ts && <span className="chat-msg-time">{formatTime(msg.ts)}</span>}
								</div>
								<div className="chat-msg-body">
									{msg.content.trim()}
									{msg.isStreaming && <span className="chat-cursor">▊</span>}
								</div>
							</div>
						)
					))}
					<div ref={messagesEndRef} />
				</div>

				<div className="chat-input">
					<textarea
						ref={inputRef}
						value={input}
						onChange={(e) => setInput(e.target.value)}
						onKeyDown={handleKeyDown}
						placeholder="Message Claude Code..."
						rows={2}
						disabled={isProcessing}
					/>
					<button
						className="btn-send"
						onClick={handleSubmit}
						disabled={isProcessing || !input.trim()}
					>
						{isProcessing ? '...' : 'Send'}
					</button>
				</div>
			</aside>
		</>
	)
}
