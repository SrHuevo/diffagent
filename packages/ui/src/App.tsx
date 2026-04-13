import { useState } from 'react'
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
	const { data: diff, loading: diffLoading, error: diffError } = useDiff()
	const chat = useChat()
	const { threads, createThread, reply, resolve } = useThreads(info?.sessionId)

	const [filesOpen, setFilesOpen] = useState(false)
	const [chatOpen, setChatOpen] = useState(false)
	const [selectedFile, setSelectedFile] = useState<string | null>(null)

	const openThreads = threads.filter((t) => t.status === 'open').length

	const files = diff?.files.map((f) => ({
		path: f.newName !== '/dev/null' ? f.newName : f.oldName,
		status: f.isNew ? 'added' : f.isDeleted ? 'deleted' : 'modified',
		additions: f.addedLines,
		deletions: f.deletedLines,
	})) || []

	return (
		<div className="app">
			<Header
				repoName={info?.name || 'Loading...'}
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
				{diffLoading && (
					<div className="diff-loading">
						<div className="spinner" />
						<p>Loading diff...</p>
					</div>
				)}
				{diffError && (
					<div className="diff-error">
						<p>Error: {diffError}</p>
					</div>
				)}
				{diff && (
					<DiffViewer
						rawDiff={diff.rawDiff}
						selectedFile={selectedFile}
						threads={threads}
						onCreateComment={createThread}
						onReply={reply}
						onResolve={resolve}
					/>
				)}
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
