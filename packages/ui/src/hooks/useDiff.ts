import { useState, useEffect, useCallback } from 'react'
import { apiUrl } from '../api'
import { parse } from 'diff2html'

export interface DiffFile {
	oldName: string
	newName: string
	addedLines: number
	deletedLines: number
	isNew: boolean
	isDeleted: boolean
	isRename: boolean
}

export interface DiffData {
	rawDiff: string
	files: DiffFile[]
	stats: { filesChanged: number; totalAdditions: number; totalDeletions: number }
}

export function useDiff() {
	const [data, setData] = useState<DiffData | null>(null)
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState<string | null>(null)

	const fetchDiff = useCallback(async () => {
		setLoading(true)
		setError(null)
		try {
			// Only fetch raw diff — diff2html parses it client-side
			const res = await fetch(apiUrl('/api/diff/raw?ref=work'))
			if (!res.ok) throw new Error(`HTTP ${res.status}`)
			const rawDiff = await res.text()

			const parsed = parse(rawDiff)
			const stats = {
				filesChanged: parsed.length,
				totalAdditions: parsed.reduce((a, f) => a + f.addedLines, 0),
				totalDeletions: parsed.reduce((a, f) => a + f.deletedLines, 0),
			}

			setData({
				rawDiff,
				files: parsed.map((f) => ({
					oldName: f.oldName,
					newName: f.newName,
					addedLines: f.addedLines,
					deletedLines: f.deletedLines,
					isNew: f.oldName === '/dev/null',
					isDeleted: f.newName === '/dev/null',
					isRename: f.isRename ?? false,
				})),
				stats,
			})
		} catch (err: any) {
			setError(err.message)
		} finally {
			setLoading(false)
		}
	}, [])

	useEffect(() => { fetchDiff() }, [fetchDiff])

	return { data, loading, error, refresh: fetchDiff }
}
