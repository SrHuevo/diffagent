import { FolderTree, MessageCircle } from 'lucide-react'

interface Props {
	onToggleFiles: () => void
	onToggleChat: () => void
	openThreads: number
}

export function BottomBar({ onToggleFiles, onToggleChat, openThreads }: Props) {
	return (
		<nav className="bottom-bar">
			<button className="bottom-btn" onClick={onToggleFiles}>
				<FolderTree size={18} />
				<span>Files</span>
			</button>
			<button className="bottom-btn" onClick={onToggleChat}>
				<MessageCircle size={18} />
				<span>Chat</span>
			</button>
			{openThreads > 0 && (
				<div className="bottom-badge">{openThreads} open</div>
			)}
		</nav>
	)
}
