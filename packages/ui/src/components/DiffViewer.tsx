import { useRef, useEffect, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { html as diff2htmlHtml } from 'diff2html'
import 'diff2html/bundles/css/diff2html.min.css' // @ts-ignore css import
import { CommentForm } from './CommentForm'
import { CommentThread } from './CommentThread'
import type { Thread } from '../hooks/useThreads'

interface Props {
	rawDiff: string
	selectedFile: string | null
	threads: Thread[]
	onCreateComment: (opts: { filePath: string; side: 'old' | 'new'; startLine: number; endLine: number; body: string }) => void
	onReply: (threadId: string, body: string) => void
	onResolve: (threadId: string) => void
}

interface CommentTarget {
	filePath: string
	line: number
	side: 'old' | 'new'
	anchorRow: HTMLElement
}

export function DiffViewer({ rawDiff, selectedFile, threads, onCreateComment, onReply, onResolve }: Props) {
	const containerRef = useRef<HTMLDivElement>(null)
	const [commentTarget, setCommentTarget] = useState<CommentTarget | null>(null)
	const [portalContainers, setPortalContainers] = useState<Map<string, HTMLElement>>(new Map())

	// Render diff HTML
	useEffect(() => {
		if (!rawDiff || !containerRef.current) return

		const html = diff2htmlHtml(rawDiff, {
			drawFileList: false,
			outputFormat: 'line-by-line',
			matching: 'lines',
			colorScheme: 'dark' as any,
		})

		containerRef.current.innerHTML = html

		if (selectedFile) {
			const fileHeaders = containerRef.current.querySelectorAll('.d2h-file-header')
			for (const header of fileHeaders) {
				if (header.textContent?.includes(selectedFile)) {
					header.scrollIntoView({ behavior: 'smooth', block: 'start' })
					break
				}
			}
		}

		// Create portal containers for existing threads
		const portals = new Map<string, HTMLElement>()
		for (const thread of threads) {
			const row = findRowForThread(containerRef.current, thread)
			if (row) {
				const key = `${thread.filePath}:${thread.startLine}`
				if (!portals.has(key)) {
					const portal = document.createElement('tr')
					portal.className = 'comment-portal-row'
					const td = document.createElement('td')
					td.colSpan = 3
					portal.appendChild(td)
					row.after(portal)
					portals.set(key, td)
				}
			}
		}
		setPortalContainers(portals)
	}, [rawDiff, selectedFile, threads])

	// Click handler for line numbers
	useEffect(() => {
		const container = containerRef.current
		if (!container) return

		const handleClick = (e: MouseEvent) => {
			const target = e.target as HTMLElement
			const lineNum = target.closest('.d2h-code-linenumber') as HTMLElement
			if (!lineNum) return

			const fileWrapper = lineNum.closest('.d2h-file-wrapper')
			const fileHeader = fileWrapper?.querySelector('.d2h-file-name')
			const filePath = fileHeader?.textContent?.trim() || ''
			const row = lineNum.closest('tr') as HTMLElement
			const isDelete = row?.querySelector('.d2h-del') !== null
			const side = isDelete ? 'old' : 'new'

			const lineText = lineNum.textContent?.trim() || ''
			const nums = lineText.split('\n').map((n) => parseInt(n.trim())).filter((n) => !isNaN(n))
			const num = side === 'old' ? nums[0] : (nums[1] || nums[0])
			if (!num) return

			setCommentTarget({ filePath, line: num, side, anchorRow: row })
		}

		container.addEventListener('click', handleClick)
		return () => container.removeEventListener('click', handleClick)
	}, [])

	const handleCreateComment = useCallback((body: string) => {
		if (!commentTarget) return
		onCreateComment({
			filePath: commentTarget.filePath,
			side: commentTarget.side,
			startLine: commentTarget.line,
			endLine: commentTarget.line,
			body,
		})
		setCommentTarget(null)
	}, [commentTarget, onCreateComment])

	if (!rawDiff) {
		return <div className="diff-empty">No changes</div>
	}

	// Group threads by file:line
	const threadsByKey = new Map<string, Thread[]>()
	for (const t of threads) {
		const key = `${t.filePath}:${t.startLine}`
		if (!threadsByKey.has(key)) threadsByKey.set(key, [])
		threadsByKey.get(key)!.push(t)
	}

	return (
		<>
			<div ref={containerRef} className="diff-container" />

			{Array.from(portalContainers.entries()).map(([key, el]) => {
				const keyThreads = threadsByKey.get(key)
				if (!keyThreads) return null
				return createPortal(
					<div className="comment-portal">
						{keyThreads.map((t) => (
							<CommentThread key={t.id} thread={t} onReply={onReply} onResolve={onResolve} />
						))}
					</div>,
					el,
					key,
				)
			})}

			{commentTarget && createPortal(
				<div className="comment-portal">
					<CommentForm
						filePath={commentTarget.filePath}
						line={commentTarget.line}
						side={commentTarget.side}
						onSubmit={handleCreateComment}
						onCancel={() => setCommentTarget(null)}
					/>
				</div>,
				getOrCreateFormPortal(commentTarget.anchorRow),
				'new-comment',
			)}
		</>
	)
}

function findRowForThread(container: HTMLElement, thread: Thread): HTMLElement | null {
	const fileWrappers = container.querySelectorAll('.d2h-file-wrapper')
	for (const wrapper of fileWrappers) {
		const fileName = wrapper.querySelector('.d2h-file-name')?.textContent?.trim()
		if (fileName?.includes(thread.filePath)) {
			const rows = wrapper.querySelectorAll('tr')
			for (const row of rows) {
				const lineNum = row.querySelector('.d2h-code-linenumber')
				const text = lineNum?.textContent?.trim() || ''
				const nums = text.split('\n').map((n) => parseInt(n.trim())).filter((n) => !isNaN(n))
				if (nums.includes(thread.startLine)) return row as HTMLElement
			}
		}
	}
	return null
}

function getOrCreateFormPortal(anchorRow: HTMLElement): HTMLElement {
	const existing = anchorRow.nextElementSibling
	if (existing?.classList.contains('comment-form-portal-row')) {
		return existing.querySelector('td')!
	}
	const tr = document.createElement('tr')
	tr.className = 'comment-form-portal-row'
	const td = document.createElement('td')
	td.colSpan = 3
	tr.appendChild(td)
	anchorRow.after(tr)
	return td
}
