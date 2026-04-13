interface FileInfo {
	path: string
	status: string
	additions: number
	deletions: number
}

interface Props {
	files: FileInfo[]
	open: boolean
	onClose: () => void
	onSelect: (path: string) => void
	selectedFile: string | null
}

export function FileTree({ files, open, onClose, onSelect, selectedFile }: Props) {
	return (
		<>
			{open && <div className="drawer-backdrop" onClick={onClose} />}
			<aside className={`drawer drawer-left ${open ? 'open' : ''}`}>
				<div className="drawer-header">
					<h2>Files <span className="badge">{files.length}</span></h2>
					<button className="btn-icon" onClick={onClose}>✕</button>
				</div>
				<div className="file-list">
					{files.map((f) => (
						<button
							key={f.path}
							className={`file-item ${selectedFile === f.path ? 'active' : ''}`}
							onClick={() => { onSelect(f.path); onClose() }}
						>
							<span className={`file-status file-status-${f.status}`}>
								{f.status === 'added' ? 'A' : f.status === 'deleted' ? 'D' : 'M'}
							</span>
							<span className="file-name">{f.path}</span>
							<span className="file-changes">
								{f.additions > 0 && <span className="stat-add">+{f.additions}</span>}
								{f.deletions > 0 && <span className="stat-del">-{f.deletions}</span>}
							</span>
						</button>
					))}
				</div>
			</aside>
		</>
	)
}
