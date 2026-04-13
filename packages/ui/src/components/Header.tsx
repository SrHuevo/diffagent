import { useState, useEffect, useRef } from 'react'
import { GitCompareArrows, Layout, Users, Server, ChevronDown, Search } from 'lucide-react'
import { apiFetch } from '../api'

export type Tab = 'diff' | 'teachers' | 'students' | 'api'

interface Teacher {
	id: string
	name: string
	god: boolean
}

interface Props {
	repoName: string
	branch: string
	stats: { filesChanged: number; totalAdditions: number; totalDeletions: number } | null
	activeTab: Tab
	onTabChange: (tab: Tab) => void
	onTeacherSelect: (teacherId: string, teacherName: string) => void
	selectedTeacher: string | null
}

export function Header({ repoName, branch, stats, activeTab, onTabChange, onTeacherSelect, selectedTeacher }: Props) {
	const [teacherOpen, setTeacherOpen] = useState(false)
	const [teachers, setTeachers] = useState<Teacher[]>([])
	const [query, setQuery] = useState('')
	const [loading, setLoading] = useState(false)
	const dropdownRef = useRef<HTMLDivElement>(null)
	const searchRef = useRef<HTMLInputElement>(null)

	useEffect(() => {
		if (!teacherOpen || teachers.length > 0) return
		setLoading(true)
		const path = window.location.pathname
		const match = path.match(/^\/([^/]+)\//)
		if (!match) return
		fetch(`${window.location.origin}/api/host/teachers/${match[1]}`)
			.then((r) => r.ok ? r.json() : [])
			.then(setTeachers)
			.catch(() => {})
			.finally(() => setLoading(false))
	}, [teacherOpen, teachers.length])

	useEffect(() => {
		if (teacherOpen) { setQuery(''); searchRef.current?.focus() }
	}, [teacherOpen])

	useEffect(() => {
		const handleClick = (e: MouseEvent) => {
			if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
				setTeacherOpen(false)
			}
		}
		document.addEventListener('click', handleClick)
		return () => document.removeEventListener('click', handleClick)
	}, [])

	const filtered = query
		? teachers.filter((t) => t.name.toLowerCase().includes(query.toLowerCase()))
		: teachers

	const handleTeacherClick = (t: Teacher) => {
		onTeacherSelect(t.id, t.name)
		setTeacherOpen(false)
	}

	return (
		<header className="header">
			<div className="header-left">
				<span className="header-repo">{repoName}</span>
				<span className="header-branch">{branch}</span>
				{stats && activeTab === 'diff' && (
					<div className="header-stats">
						<span className="stat-files">{stats.filesChanged}</span>
						<span className="stat-add">+{stats.totalAdditions}</span>
						<span className="stat-del">-{stats.totalDeletions}</span>
					</div>
				)}
			</div>
			<nav className="header-tabs">
				<button className={`header-tab ${activeTab === 'diff' ? 'active' : ''}`} onClick={() => onTabChange('diff')}>
					<GitCompareArrows size={14} />
					<span>Diff</span>
				</button>

				<div className="header-tab-dropdown" ref={dropdownRef}>
					<button
						className={`header-tab ${activeTab === 'teachers' ? 'active' : ''}`}
						onClick={(e) => { e.stopPropagation(); setTeacherOpen((o) => !o) }}
					>
						<Layout size={14} />
						<span>{selectedTeacher || 'Teachers'}</span>
						<ChevronDown size={12} />
					</button>
					{teacherOpen && (
						<div className="tab-dropdown">
							<div className="tab-dropdown-search">
								<Search size={12} />
								<input
									ref={searchRef}
									value={query}
									onChange={(e) => setQuery(e.target.value)}
									placeholder="Search..."
									onClick={(e) => e.stopPropagation()}
								/>
							</div>
							<div className="tab-dropdown-list">
								{loading && <div className="tab-dropdown-loading">Loading...</div>}
								{filtered.map((t) => (
									<button
										key={t.id}
										className={`tab-dropdown-item ${t.god ? 'tab-dropdown-god' : ''}`}
										onClick={() => handleTeacherClick(t)}
									>
										{t.name}{t.god ? ' ★' : ''}
									</button>
								))}
							</div>
						</div>
					)}
				</div>

				<button className={`header-tab ${activeTab === 'students' ? 'active' : ''}`} onClick={() => onTabChange('students')}>
					<Users size={14} />
					<span>Students</span>
				</button>
				<button className={`header-tab ${activeTab === 'api' ? 'active' : ''}`} onClick={() => onTabChange('api')}>
					<Server size={14} />
					<span>API</span>
				</button>
			</nav>
		</header>
	)
}
