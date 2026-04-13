import { FolderTree, MessageCircle, Wand2 } from 'lucide-react'

interface Props {
	onToggleFiles: () => void
	onToggleChat: () => void
	onResolveComments: () => void
	openThreads: number
	isResolving: boolean
}

export function BottomBar({ onToggleFiles, onToggleChat, onResolveComments, openThreads, isResolving }: Props) {
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
				<>
					<div className="bottom-badge">{openThreads} open</div>
					<button
						className="bottom-btn bottom-btn-resolve"
						onClick={onResolveComments}
						disabled={isResolving}
						title="Send all open comments to Claude for resolution"
					>
						<Wand2 size={18} />
						<span>{isResolving ? 'Resolving...' : 'Resolve Comments'}</span>
					</button>
				</>
			)}
		</nav>
	)
}
