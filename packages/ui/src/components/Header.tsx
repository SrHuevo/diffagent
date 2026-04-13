interface Props {
	repoName: string
	branch: string
	stats: { filesChanged: number; totalAdditions: number; totalDeletions: number } | null
}

export function Header({ repoName, branch, stats }: Props) {
	return (
		<header className="header">
			<div className="header-left">
				<span className="header-repo">{repoName}</span>
				<span className="header-branch">{branch}</span>
			</div>
			{stats && (
				<div className="header-stats">
					<span className="stat-files">{stats.filesChanged} files</span>
					<span className="stat-add">+{stats.totalAdditions}</span>
					<span className="stat-del">-{stats.totalDeletions}</span>
				</div>
			)}
		</header>
	)
}
