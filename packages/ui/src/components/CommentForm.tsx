import { useState, useRef, useEffect } from 'react'

interface Props {
	filePath: string
	line: number
	side: 'old' | 'new'
	onSubmit: (body: string) => void
	onCancel: () => void
}

export function CommentForm({ filePath, line, side, onSubmit, onCancel }: Props) {
	const [body, setBody] = useState('')
	const ref = useRef<HTMLTextAreaElement>(null)

	useEffect(() => { ref.current?.focus() }, [])

	const handleSubmit = () => {
		if (!body.trim()) return
		onSubmit(body.trim())
		setBody('')
	}

	const handleKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
			e.preventDefault()
			handleSubmit()
		}
		if (e.key === 'Escape') onCancel()
	}

	return (
		<div className="comment-form">
			<div className="comment-form-header">
				<span className="comment-form-file">{filePath}:{line}</span>
				<button className="btn-icon" onClick={onCancel}>✕</button>
			</div>
			<textarea
				ref={ref}
				value={body}
				onChange={(e) => setBody(e.target.value)}
				onKeyDown={handleKeyDown}
				placeholder="Leave a comment... (Ctrl+Enter to submit)"
				rows={3}
			/>
			<div className="comment-form-actions">
				<button className="btn-cancel" onClick={onCancel}>Cancel</button>
				<button className="btn-submit" onClick={handleSubmit} disabled={!body.trim()}>Comment</button>
			</div>
		</div>
	)
}
