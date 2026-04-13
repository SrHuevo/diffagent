import { useState, useCallback } from 'react'
import { Header } from './components/Header'
import { FileTree } from './components/FileTree'
import { DiffViewer } from './components/DiffViewer'
import { ChatPanel } from './components/ChatPanel'
import { BottomBar } from './components/BottomBar'
import { useRepoInfo } from './hooks/useRepoInfo'
import { useDiff } from './hooks/useDiff'
import { useChat } from './hooks/useChat'
import { useThreads } from './hooks/useThreads'

export function App() {
	const { info } = useRepoInfo()
	const { data: diff, loading, error } = useDiff()
	const chat = useChat()
	const { threads } = useThreads(info?.sessionId)

	const [filesOpen, setFilesOpen] = useState(false)
	const [chatOpen, setChatOpen] = useState(false)
	const [selectedFile, setSelectedFile] = useState<string | null>(null)

	const handleLineClick = useCallback((filePath: string, line: number, side: 'old' | 'new') => {
		// TODO: open comment form for this line
		console.log('Comment on', filePath, line, side)
	}, [])

	const openThreads = threads.filter((t) => t.status === 'open').length

	const files = diff?.files.map((f) => ({
		path: f.newPath || f.oldPath,
		status: f.status,
		additions: f.additions,
		deletions: f.deletions,
	})) || []

	if (loading) {
		return (
			<div className="loading">
				<div className="spinner" />
			</div>
		)
	}

	if (error) {
		return (
			<div className="error-page">
				<h1>Error loading diff</h1>
				<p>{error}</p>
			</div>
		)
	}

	return (
		<div className="app">
			<Header
				repoName={info?.name || ''}
				branch={info?.branch || ''}
				stats={diff?.stats || null}
			/>

			<FileTree
				files={files}
				open={filesOpen}
				onClose={() => setFilesOpen(false)}
				onSelect={setSelectedFile}
				selectedFile={selectedFile}
			/>

			<main className="main">
				<DiffViewer
					rawDiff={diff?.rawDiff || ''}
					selectedFile={selectedFile}
					onLineClick={handleLineClick}
				/>
			</main>

			<ChatPanel
				open={chatOpen}
				onClose={() => setChatOpen(false)}
				messages={chat.messages}
				isProcessing={chat.isProcessing}
				onSend={chat.send}
				onClear={chat.clear}
			/>

			<BottomBar
				onToggleFiles={() => setFilesOpen((o) => !o)}
				onToggleChat={() => setChatOpen((o) => !o)}
				openThreads={openThreads}
			/>
		</div>
	)
}
