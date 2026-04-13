import { useState, useEffect, useCallback } from 'react'
import { apiFetch, apiUrl } from '../api'

interface DiffStats {
	totalAdditions: number
	totalDeletions: number
	filesChanged: number
}

interface DiffFile {
	oldPath: string
	newPath: string
	status: string
	additions: number
	deletions: number
}

export interface DiffData {
	rawDiff: string
	files: DiffFile[]
	stats: DiffStats
}

export function useDiff() {
	const [data, setData] = useState<DiffData | null>(null)
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState<string | null>(null)

	const fetchDiff = useCallback(async () => {
		setLoading(true)
		setError(null)
		try {
			const [parsed, rawRes] = await Promise.all([
				apiFetch<{ files: DiffFile[]; stats: DiffStats }>('/api/diff?ref=work'),
				fetch(apiUrl('/api/diff/raw?ref=work')),
			])
			const rawDiff = rawRes.ok ? await rawRes.text() : ''
			setData({ rawDiff, files: parsed.files, stats: parsed.stats })
		} catch (err: any) {
			setError(err.message)
		} finally {
			setLoading(false)
		}
	}, [])

	useEffect(() => { fetchDiff() }, [fetchDiff])

	return { data, loading, error, refresh: fetchDiff }
}
