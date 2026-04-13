interface Props {
	onToggleFiles: () => void
	onToggleChat: () => void
	openThreads: number
}

export function BottomBar({ onToggleFiles, onToggleChat, openThreads }: Props) {
	return (
		<nav className="bottom-bar">
			<button className="bottom-btn" onClick={onToggleFiles}>
				<span className="bottom-icon">📁</span>
				<span>Files</span>
			</button>
			<button className="bottom-btn" onClick={onToggleChat}>
				<span className="bottom-icon">💬</span>
				<span>Chat</span>
			</button>
			{openThreads > 0 && (
				<div className="bottom-badge">{openThreads} open</div>
			)}
		</nav>
	)
}
