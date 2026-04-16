interface Props {
	open: boolean
	onClose: () => void
}

function buildClaudeUrl(): string {
	const match = window.location.pathname.match(/^\/([^/]+)\/diffagent/)
	const task = match ? match[1] : null
	if (!task) return ''
	return `${window.location.origin}/${task}/claude/`
}

export function ChatPanel({ open, onClose }: Props) {
	const src = buildClaudeUrl()

	return (
		<>
			{open && <div className="drawer-backdrop" onClick={onClose} />}
			<aside className={`drawer drawer-right ${open ? 'open' : ''}`}>
				<div className="drawer-header">
					<h2>Claude Code</h2>
					<div className="drawer-header-actions">
						<button className="btn-icon" onClick={onClose}>✕</button>
					</div>
				</div>

				{open && src ? (
					<iframe
						className="chat-terminal"
						src={src}
						title="Claude Code terminal"
					/>
				) : (
					<div className="chat-empty">Terminal unavailable</div>
				)}
			</aside>
		</>
	)
}
