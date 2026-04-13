import { useState, useEffect, useRef } from 'react'
import { Search } from 'lucide-react'
import { apiFetch } from '../api'

interface Teacher {
	id: string
	name: string
	god: boolean
}

interface Props {
	onSelect: (teacherId: string, teacherName: string) => void
}

export function TeacherPicker({ onSelect }: Props) {
	const [teachers, setTeachers] = useState<Teacher[]>([])
	const [query, setQuery] = useState('')
	const [loading, setLoading] = useState(true)
	const inputRef = useRef<HTMLInputElement>(null)

	useEffect(() => {
		// Fetch teachers from dev-env service via host
		const path = window.location.pathname
		const match = path.match(/^\/([^/]+)\//)
		if (!match) return
		const task = match[1]

		fetch(`${window.location.origin}/api/host/teachers/${task}`)
			.then((r) => r.ok ? r.json() : [])
			.then(setTeachers)
			.catch(() => {})
			.finally(() => setLoading(false))
	}, [])

	useEffect(() => { inputRef.current?.focus() }, [])

	const filtered = query
		? teachers.filter((t) => t.name.toLowerCase().includes(query.toLowerCase()))
		: teachers

	return (
		<div className="teacher-picker-panel">
			<div className="teacher-search">
				<Search size={14} />
				<input
					ref={inputRef}
					type="text"
					value={query}
					onChange={(e) => setQuery(e.target.value)}
					placeholder="Search teacher..."
				/>
			</div>
			<div className="teacher-list">
				{loading && <div className="teacher-loading">Loading...</div>}
				{filtered.map((t) => (
					<button
						key={t.id}
						className={`teacher-item ${t.god ? 'teacher-god' : ''}`}
						onClick={() => onSelect(t.id, t.name)}
					>
						{t.name}{t.god ? ' ★' : ''}
					</button>
				))}
			</div>
		</div>
	)
}
