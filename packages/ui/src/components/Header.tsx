import { useState, useEffect, useRef } from 'react'
import { GitCompareArrows, Layout, Users, Server, ChevronDown, Search, LayoutGrid, Menu, GitPullRequest } from 'lucide-react'

export type Tab = 'diff' | 'teachers' | 'students' | 'api'

interface Teacher {
	id: string
	name: string
	god: boolean
}

interface TaskInfo {
	task: string
	slot: string
}

interface Props {
	repoName: string
	branch: string
	stats: { filesChanged: number; totalAdditions: number; totalDeletions: number } | null
	activeTab: Tab
	onTabChange: (tab: Tab) => void
	onTeacherSelect: (teacherId: string, teacherName: string) => void
	selectedTeacher: string | null
	onPull: () => void
	isPulling: boolean
}

function getTaskFromUrl(): string | null {
	const match = window.location.pathname.match(/^\/([^/]+)\/diffagent/)
	return match ? match[1] : null
}

export function Header({ repoName, branch, stats, activeTab, onTabChange, onTeacherSelect, selectedTeacher, onPull, isPulling }: Props) {
	const [teacherOpen, setTeacherOpen] = useState(false)
	const [teachers, setTeachers] = useState<Teacher[]>([])
	const [teacherQuery, setTeacherQuery] = useState('')
	const [teacherLoading, setTeacherLoading] = useState(false)
	const teacherRef = useRef<HTMLDivElement>(null)
	const teacherSearchRef = useRef<HTMLInputElement>(null)

	const [navOpen, setNavOpen] = useState(false)
	const [tasks, setTasks] = useState<TaskInfo[]>([])
	const navRef = useRef<HTMLDivElement>(null)

	const [burgerOpen, setBurgerOpen] = useState(false)
	const burgerRef = useRef<HTMLDivElement>(null)

	// Load teachers on open
	useEffect(() => {
		if (!teacherOpen || teachers.length > 0) return
		setTeacherLoading(true)
		const task = getTaskFromUrl()
		if (!task) return
		fetch(`${window.location.origin}/api/host/teachers/${task}`)
			.then((r) => r.ok ? r.json() : [])
			.then(setTeachers)
			.catch(() => {})
			.finally(() => setTeacherLoading(false))
	}, [teacherOpen, teachers.length])

	useEffect(() => { if (teacherOpen) { setTeacherQuery(''); teacherSearchRef.current?.focus() } }, [teacherOpen])

	// Load tasks on nav open
	useEffect(() => {
		if (!navOpen) return
		fetch(`${window.location.origin}/api/tasks`)
			.then((r) => r.ok ? r.json() : [])
			.then((t: any[]) => setTasks(t.map(x => ({ task: x.task, slot: x.slot }))))
			.catch(() => {})
	}, [navOpen])

	// Close dropdowns on outside click
	useEffect(() => {
		const handleClick = (e: MouseEvent) => {
			if (teacherRef.current && !teacherRef.current.contains(e.target as Node)) setTeacherOpen(false)
			if (navRef.current && !navRef.current.contains(e.target as Node)) setNavOpen(false)
			if (burgerRef.current && !burgerRef.current.contains(e.target as Node)) setBurgerOpen(false)
		}
		document.addEventListener('click', handleClick)
		return () => document.removeEventListener('click', handleClick)
	}, [])

	const filteredTeachers = teacherQuery
		? teachers.filter((t) => t.name.toLowerCase().includes(teacherQuery.toLowerCase()))
		: teachers

	const currentTask = getTaskFromUrl()

	return (
		<header className="header">
			<div className="header-left">
				<div className="header-tab-dropdown" ref={navRef}>
					<button className="header-tab" onClick={(e) => { e.stopPropagation(); setNavOpen((o) => !o) }}>
						<LayoutGrid size={14} />
						<span>{currentTask || 'Tasks'}</span>
						<ChevronDown size={12} />
					</button>
					{navOpen && (
						<div className="tab-dropdown">
							<a className="tab-dropdown-item tab-dropdown-hub" href={window.location.origin} target="_self">
								← Dashboard
							</a>
							{tasks.filter(t => t.task !== currentTask).map(t => (
								<a
									key={t.slot}
									className="tab-dropdown-item"
									href={`${window.location.origin}/${t.task}/diffagent/`}
								>
									{t.task}
								</a>
							))}
						</div>
					)}
				</div>
				<span className="header-branch">{branch}</span>
				<button className="header-pull-btn" onClick={onPull} disabled={isPulling} title="Pull latest from base branch (via Claude)">
					<GitPullRequest size={12} />
					<span>{isPulling ? 'Pulling...' : 'Pull'}</span>
				</button>
				{stats && activeTab === 'diff' && (
					<div className="header-stats">
						<span className="stat-files">{stats.filesChanged}</span>
						<span className="stat-add">+{stats.totalAdditions}</span>
						<span className="stat-del">-{stats.totalDeletions}</span>
					</div>
				)}
			</div>
			{/* Burger menu for mobile */}
			<div className="header-burger" ref={burgerRef}>
				<button className="header-burger-btn" onClick={(e) => { e.stopPropagation(); setBurgerOpen((o) => !o) }}>
					<Menu size={18} />
				</button>
				{burgerOpen && (
					<div className="header-burger-dropdown">
						<button className={`header-tab ${activeTab === 'diff' ? 'active' : ''}`} onClick={() => { onTabChange('diff'); setBurgerOpen(false) }}>
							<GitCompareArrows size={14} />
							<span>Diff</span>
						</button>
						<div className="header-tab-dropdown" ref={teacherRef}>
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
											ref={teacherSearchRef}
											value={teacherQuery}
											onChange={(e) => setTeacherQuery(e.target.value)}
											placeholder="Search..."
											onClick={(e) => e.stopPropagation()}
										/>
									</div>
									<div className="tab-dropdown-list">
										{teacherLoading && <div className="tab-dropdown-loading">Loading...</div>}
										{filteredTeachers.map((t) => (
											<button
												key={t.id}
												className={`tab-dropdown-item ${t.god ? 'tab-dropdown-god' : ''}`}
												onClick={() => { onTeacherSelect(t.id, t.name); setTeacherOpen(false); setBurgerOpen(false) }}
											>
												{t.name}{t.god ? ' ★' : ''}
											</button>
										))}
									</div>
								</div>
							)}
						</div>
						<button className={`header-tab ${activeTab === 'students' ? 'active' : ''}`} onClick={() => { onTabChange('students'); setBurgerOpen(false) }}>
							<Users size={14} />
							<span>Students</span>
						</button>
						<button className={`header-tab ${activeTab === 'api' ? 'active' : ''}`} onClick={() => { onTabChange('api'); setBurgerOpen(false) }}>
							<Server size={14} />
							<span>API</span>
						</button>
					</div>
				)}
			</div>

			{/* Desktop tabs (inline) */}
			<nav className="header-tabs">
				<button className={`header-tab ${activeTab === 'diff' ? 'active' : ''}`} onClick={() => onTabChange('diff')}>
					<GitCompareArrows size={14} />
					<span>Diff</span>
				</button>

				<div className="header-tab-dropdown" ref={teacherRef}>
					<button
						className={`header-tab ${activeTab === 'teachers' ? 'active' : ''}`}
						onClick={(e) => { e.stopPropagation(); setTeacherOpen((o) => !o) }}
					>
						<Layout size={14} />
						<span>{selectedTeacher || 'Teachers'}</span>
						<ChevronDown size={12} />
					</button>
					{teacherOpen && (
						<div className="tab-dropdown tab-dropdown-right">
							<div className="tab-dropdown-search">
								<Search size={12} />
								<input
									ref={teacherSearchRef}
									value={teacherQuery}
									onChange={(e) => setTeacherQuery(e.target.value)}
									placeholder="Search..."
									onClick={(e) => e.stopPropagation()}
								/>
							</div>
							<div className="tab-dropdown-list">
								{teacherLoading && <div className="tab-dropdown-loading">Loading...</div>}
								{filteredTeachers.map((t) => (
									<button
										key={t.id}
										className={`tab-dropdown-item ${t.god ? 'tab-dropdown-god' : ''}`}
										onClick={() => { onTeacherSelect(t.id, t.name); setTeacherOpen(false) }}
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
