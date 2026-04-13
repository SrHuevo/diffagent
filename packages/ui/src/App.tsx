import { useState, useCallback } from 'react'
import { Header, type Tab } from './components/Header'
import { FileTree } from './components/FileTree'
import { DiffViewer } from './components/DiffViewer'
import { ChatPanel } from './components/ChatPanel'
import { BottomBar } from './components/BottomBar'
import { useRepoInfo } from './hooks/useRepoInfo'
import { useDiff } from './hooks/useDiff'
import { useChat } from './hooks/useChat'
import { useThreads } from './hooks/useThreads'

function getTaskFromUrl(): string | null {
	const match = window.location.pathname.match(/^\/([^/]+)\/diffagent/)
	return match ? match[1] : null
}

function buildIframeUrl(tab: Tab): string {
	const task = getTaskFromUrl()
	if (!task) return ''
	const origin = window.location.origin
	if (tab === 'students') return `${origin}/${task}/students/`
	if (tab === 'api') return `${origin}/api/teachers-dashboard`
	return ''
}

export function App() {
	const { info } = useRepoInfo()
	const { data: diff, loading: diffLoading, error: diffError } = useDiff()
	const chat = useChat()
	const { threads, createThread, reply, resolve } = useThreads(info?.sessionId)

	const [activePanel, setActivePanel] = useState<'files' | 'chat' | null>(null)
	const [selectedFile, setSelectedFile] = useState<string | null>(null)
	const [activeTab, setActiveTab] = useState<Tab>('diff')
	const [teacherIframeUrl, setTeacherIframeUrl] = useState<string | null>(null)
	const [selectedTeacher, setSelectedTeacher] = useState<string | null>(null)
	const [loadedTabs, setLoadedTabs] = useState<Set<Tab>>(new Set(['diff']))
	const [isPulling, setIsPulling] = useState(false)
	const [isSyncing, setIsSyncing] = useState(false)

	const filesOpen = activePanel === 'files'
	const chatOpen = activePanel === 'chat'
	const openThreads = threads.filter((t) => t.status === 'open').length

	const files = diff?.files.map((f) => ({
		path: f.newName !== '/dev/null' ? f.newName : f.oldName,
		status: f.isNew ? 'added' : f.isDeleted ? 'deleted' : 'modified',
		additions: f.addedLines,
		deletions: f.deletedLines,
	})) || []

	const handleTabChange = useCallback(async (tab: Tab) => {
		setActiveTab(tab)
		setActivePanel(null)
		if (tab === 'students') {
			const task = getTaskFromUrl()
			if (task) {
				try { await fetch(`${window.location.origin}/api/host/vite/${task}/students`, { method: 'POST' }) } catch {}
			}
		}
		setLoadedTabs((prev) => new Set(prev).add(tab))
	}, [])

	const handleTeacherSelect = useCallback(async (teacherId: string, teacherName: string) => {
		const task = getTaskFromUrl()
		if (!task) return
		setSelectedTeacher(teacherName)
		setActiveTab('teachers')
		// Ensure Vite is running
		try { await fetch(`${window.location.origin}/api/host/vite/${task}/teachers`, { method: 'POST' }) } catch {}
		const fakeUrl = `${window.location.origin}/${task}/api/teachers-dashboard/fake?user=${teacherId}`
		setTeacherIframeUrl(fakeUrl)
		setLoadedTabs((prev) => new Set(prev).add('teachers'))
	}, [])

	const handlePull = useCallback(async () => {
		if (isPulling) return
		setIsPulling(true)
		setActivePanel('chat')
		const baseBranch = info?.description?.replace('Changes from ', '') || 'feature/version-3'
		await chat.send(`Haz git fetch origin y luego git merge origin/${baseBranch} --no-edit. Si hay conflictos, resuélvelos de forma inteligente manteniendo ambos cambios cuando sea posible. Después muestra un resumen de lo que se actualizó.`)
		setIsPulling(false)
	}, [isPulling, chat, info])

	const handleSync = useCallback(async () => {
		if (isSyncing) return
		setIsSyncing(true)
		const task = getTaskFromUrl()
		if (task) {
			try {
				await fetch(`${window.location.protocol}//${window.location.host}/api/host/sync-diffagent/${task}`, { method: 'POST' })
				window.location.reload()
			} catch {}
		}
		setIsSyncing(false)
	}, [isSyncing])

	return (
		<div className="app">
			<Header
				repoName={info?.name || 'Loading...'}
				branch={info?.branch || ''}
				stats={diff?.stats || null}
				activeTab={activeTab}
				onTabChange={handleTabChange}
				onTeacherSelect={handleTeacherSelect}
				selectedTeacher={selectedTeacher}
				onPull={handlePull}
				isPulling={isPulling}
				onSync={handleSync}
				isSyncing={isSyncing}
			/>

			<FileTree
				files={files}
				open={filesOpen}
				onClose={() => setActivePanel(null)}
				onSelect={(path) => { setSelectedFile(path); setActiveTab('diff') }}
				selectedFile={selectedFile}
			/>

			{/* All panels always mounted, shown/hidden with CSS to preserve iframe state */}
			<main className="main" style={{ display: activeTab === 'diff' ? undefined : 'none' }}
				onClick={() => activePanel && setActivePanel(null)}>
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

			<main className="main" style={{ display: activeTab === 'teachers' ? undefined : 'none' }}>
				{!teacherIframeUrl ? (
					<div className="diff-empty">Select a teacher from the dropdown above</div>
				) : (
					<iframe className="tab-iframe" src={teacherIframeUrl} />
				)}
			</main>

			<main className="main" style={{ display: activeTab === 'students' ? undefined : 'none' }}>
				{loadedTabs.has('students') && <iframe className="tab-iframe" src={buildIframeUrl('students')} />}
			</main>

			<main className="main" style={{ display: activeTab === 'api' ? undefined : 'none' }}>
				{loadedTabs.has('api') && <iframe className="tab-iframe" src={buildIframeUrl('api')} />}
			</main>

			<ChatPanel
				open={chatOpen}
				onClose={() => setActivePanel(null)}
				messages={chat.messages}
				isProcessing={chat.isProcessing}
				onSend={chat.send}
				onClear={chat.clear}
			/>

			<BottomBar
				onToggleFiles={() => setActivePanel((p) => p === 'files' ? null : 'files')}
				onToggleChat={() => setActivePanel((p) => p === 'chat' ? null : 'chat')}
				openThreads={openThreads}
			/>
		</div>
	)
}
