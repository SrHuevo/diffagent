export type SlotStatus = 'free' | 'warming' | 'active' | 'stopped' | 'error' | 'stopping' | 'destroying'

export interface SlotInfo {
	status: SlotStatus
	task: string
	updated: string
	baseBranch?: string
	viteTeachers?: boolean
	viteStudents?: boolean
}

export interface PoolState {
	slots: Record<string, SlotInfo>
}

export interface TaskCreateRequest {
	name: string
	baseBranch: string
	backup?: string
}

export interface BackupInfo {
	name: string
	mtime: string
}

export interface TaskFinishRequest {
	commitMessage?: string
	prTitle?: string
}

export interface BranchInfo {
	name: string
	date: string
	pinned: boolean
}

export interface TaskView {
	slot: string
	task: string
	safeName: string
	status: SlotStatus
	baseBranch: string
	urls: {
		app: string
		diffagent: string
		teachers: string
		students: string
		claude: string
		tunnelApp?: string
		tunnelDiffagent?: string
		tunnelTeachers?: string
		tunnelStudents?: string
		tunnelClaude?: string
	}
	viteTeachers: boolean
	viteStudents: boolean
}

export interface SSEEvent {
	type: 'pool-update' | 'task-update' | 'log' | 'error'
	data: unknown
}
