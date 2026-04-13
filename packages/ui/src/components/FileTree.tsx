import { useState } from 'react'
import { ChevronsDownUp, ChevronsUpDown, X } from 'lucide-react'

interface FileInfo {
	path: string
	status: string
	additions: number
	deletions: number
}

interface TreeNode {
	name: string
	fullPath: string
	isFile: boolean
	file?: FileInfo
	children: TreeNode[]
}

interface Props {
	files: FileInfo[]
	open: boolean
	onClose: () => void
	onSelect: (path: string) => void
	selectedFile: string | null
}

function buildTree(files: FileInfo[]): TreeNode[] {
	const root: TreeNode[] = []
	for (const file of files) {
		const parts = file.path.split('/')
		let current = root
		for (let i = 0; i < parts.length; i++) {
			const name = parts[i]
			const isFile = i === parts.length - 1
			const fullPath = parts.slice(0, i + 1).join('/')
			let node = current.find((n) => n.name === name)
			if (!node) {
				node = { name, fullPath, isFile, children: [], file: isFile ? file : undefined }
				current.push(node)
			}
			current = node.children
		}
	}
	return root
}

function collectFolderPaths(nodes: TreeNode[]): string[] {
	const paths: string[] = []
	for (const node of nodes) {
		if (!node.isFile) {
			paths.push(node.fullPath)
			paths.push(...collectFolderPaths(node.children))
		}
	}
	return paths
}

function sortNodes(nodes: TreeNode[]): TreeNode[] {
	return [...nodes].sort((a, b) => (a.isFile === b.isFile ? a.name.localeCompare(b.name) : a.isFile ? 1 : -1))
}

function FolderNode({ node, onSelect, selectedFile, depth, collapsedSet, onToggle }: {
	node: TreeNode
	onSelect: (path: string) => void
	selectedFile: string | null
	depth: number
	collapsedSet: Set<string>
	onToggle: (path: string) => void
}) {
	if (node.isFile && node.file) {
		return (
			<button
				className={`file-item ${selectedFile === node.file.path ? 'active' : ''}`}
				style={{ paddingLeft: `${depth * 12 + 8}px` }}
				onClick={() => onSelect(node.file!.path)}
			>
				<span className={`file-status file-status-${node.file.status}`}>
					{node.file.status === 'added' ? 'A' : node.file.status === 'deleted' ? 'D' : 'M'}
				</span>
				<span className="file-name">{node.name}</span>
				<span className="file-changes">
					{node.file.additions > 0 && <span className="stat-add">+{node.file.additions}</span>}
					{node.file.deletions > 0 && <span className="stat-del">-{node.file.deletions}</span>}
				</span>
			</button>
		)
	}

	const isCollapsed = collapsedSet.has(node.fullPath)

	return (
		<div className="file-tree-folder">
			<div
				className="file-tree-folder-header"
				style={{ paddingLeft: `${depth * 12 + 8}px` }}
				onClick={() => onToggle(node.fullPath)}
			>
				<span className={`folder-icon ${isCollapsed ? 'collapsed' : ''}`}>▾</span>
				<span>{node.name}</span>
			</div>
			{!isCollapsed && (
				<div className="file-tree-folder-children">
					{sortNodes(node.children).map((child) => (
						<FolderNode
							key={child.fullPath}
							node={child}
							onSelect={onSelect}
							selectedFile={selectedFile}
							depth={depth + 1}
							collapsedSet={collapsedSet}
							onToggle={onToggle}
						/>
					))}
				</div>
			)}
		</div>
	)
}

export function FileTree({ files, open, onClose, onSelect, selectedFile }: Props) {
	const tree = buildTree(files)
	const [collapsedSet, setCollapsedSet] = useState<Set<string>>(new Set())

	const toggle = (path: string) => {
		setCollapsedSet((prev) => {
			const next = new Set(prev)
			if (next.has(path)) next.delete(path)
			else next.add(path)
			return next
		})
	}

	const expandAll = () => setCollapsedSet(new Set())
	const collapseAll = () => setCollapsedSet(new Set(collectFolderPaths(tree)))

	return (
		<>
			{open && <div className="drawer-backdrop" onClick={onClose} />}
			<aside className={`drawer drawer-left ${open ? 'open' : ''}`}>
				<div className="drawer-header">
					<h2>Files</h2>
					<div className="drawer-header-actions">
						<button className="btn-icon" title="Expand all" onClick={expandAll}><ChevronsUpDown size={16} /></button>
						<button className="btn-icon" title="Collapse all" onClick={collapseAll}><ChevronsDownUp size={16} /></button>
						<button className="btn-icon" onClick={onClose}><X size={16} /></button>
					</div>
				</div>
				<div className="file-list">
					{sortNodes(tree).map((node) => (
						<FolderNode
							key={node.fullPath}
							node={node}
							onSelect={(path) => { onSelect(path); onClose() }}
							selectedFile={selectedFile}
							depth={0}
							collapsedSet={collapsedSet}
							onToggle={toggle}
						/>
					))}
				</div>
			</aside>
		</>
	)
}
