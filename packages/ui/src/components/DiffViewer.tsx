import { useRef, useEffect } from 'react'
import { html as diff2htmlHtml } from 'diff2html'
import 'diff2html/bundles/css/diff2html.min.css' // @ts-ignore css import

interface Props {
	rawDiff: string
	selectedFile: string | null
	onLineClick?: (filePath: string, line: number, side: 'old' | 'new') => void
}

export function DiffViewer({ rawDiff, selectedFile, onLineClick }: Props) {
	const containerRef = useRef<HTMLDivElement>(null)

	useEffect(() => {
		if (!rawDiff || !containerRef.current) return

		const html = diff2htmlHtml(rawDiff, {
			drawFileList: false,
			outputFormat: 'line-by-line',
			matching: 'lines',
			colorScheme: 'dark' as any,
		})

		containerRef.current.innerHTML = html

		// Scroll to selected file
		if (selectedFile) {
			const fileHeaders = containerRef.current.querySelectorAll('.d2h-file-header')
			for (const header of fileHeaders) {
				if (header.textContent?.includes(selectedFile)) {
					header.scrollIntoView({ behavior: 'smooth', block: 'start' })
					break
				}
			}
		}
	}, [rawDiff, selectedFile])

	// Event delegation for line clicks (comment button)
	useEffect(() => {
		const container = containerRef.current
		if (!container || !onLineClick) return

		const handleClick = (e: MouseEvent) => {
			const target = e.target as HTMLElement
			const lineNum = target.closest('.d2h-code-linenumber')
			if (!lineNum) return

			// Find the file this line belongs to
			const fileWrapper = lineNum.closest('.d2h-file-wrapper')
			const fileHeader = fileWrapper?.querySelector('.d2h-file-name')
			const filePath = fileHeader?.textContent?.trim() || ''

			// Get line number
			const lineText = lineNum.textContent?.trim() || ''
			const num = parseInt(lineText)
			if (isNaN(num)) return

			// Determine side
			const row = lineNum.closest('tr')
			const isDelete = row?.querySelector('.d2h-del') !== null
			const side = isDelete ? 'old' : 'new'

			onLineClick(filePath, num, side as 'old' | 'new')
		}

		container.addEventListener('click', handleClick)
		return () => container.removeEventListener('click', handleClick)
	}, [onLineClick])

	if (!rawDiff) {
		return <div className="diff-empty">No changes</div>
	}

	return <div ref={containerRef} className="diff-container" />
}
