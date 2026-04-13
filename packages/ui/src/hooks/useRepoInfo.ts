import { useState, useEffect } from 'react'
import { apiFetch } from '../api'

export interface RepoInfo {
	name: string
	branch: string
	root: string
	description: string
	sessionId?: string | null
}

export function useRepoInfo() {
	const [info, setInfo] = useState<RepoInfo | null>(null)
	const [loading, setLoading] = useState(true)

	useEffect(() => {
		apiFetch<RepoInfo>('/api/info?ref=work')
			.then(setInfo)
			.catch(console.error)
			.finally(() => setLoading(false))
	}, [])

	return { info, loading }
}
