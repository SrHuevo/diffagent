import { useState } from 'react'
import type { Thread } from '../hooks/useThreads'

interface Props {
	thread: Thread
	onReply: (threadId: string, body: string) => void
	onResolve: (threadId: string) => void
}

export function CommentThread({ thread, onReply, onResolve }: Props) {
	const [replyText, setReplyText] = useState('')
	const [showReply, setShowReply] = useState(false)

	const handleReply = () => {
		if (!replyText.trim()) return
		onReply(thread.id, replyText.trim())
		setReplyText('')
		setShowReply(false)
	}

	return (
		<div className={`comment-thread comment-thread-${thread.status}`}>
			{thread.comments.map((c) => (
				<div key={c.id} className={`comment comment-${c.authorType}`}>
					<div className="comment-author">{c.authorName}</div>
					<div className="comment-body">{c.body}</div>
				</div>
			))}

			<div className="comment-actions">
				{thread.status === 'open' && (
					<>
						{!showReply && (
							<button className="btn-text" onClick={() => setShowReply(true)}>Reply</button>
						)}
						<button className="btn-text btn-resolve" onClick={() => onResolve(thread.id)}>Resolve</button>
					</>
				)}
				{thread.status === 'resolved' && (
					<span className="comment-resolved">Resolved</span>
				)}
			</div>

			{showReply && (
				<div className="comment-reply">
					<textarea
						value={replyText}
						onChange={(e) => setReplyText(e.target.value)}
						placeholder="Reply..."
						rows={2}
						onKeyDown={(e) => {
							if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleReply()
							if (e.key === 'Escape') setShowReply(false)
						}}
						autoFocus
					/>
					<div className="comment-reply-actions">
						<button className="btn-cancel" onClick={() => setShowReply(false)}>Cancel</button>
						<button className="btn-submit" onClick={handleReply} disabled={!replyText.trim()}>Reply</button>
					</div>
				</div>
			)}
		</div>
	)
}
