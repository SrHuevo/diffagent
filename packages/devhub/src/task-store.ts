import { readFileSync, writeFileSync, existsSync, appendFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { config } from './config.js'

export interface SavedTask {
	name: string
	slot: string
	baseBranch: string
	status: 'active' | 'stopped'
}

interface TaskStore {
	tasks: SavedTask[]
}

const STORE_FILE = resolve(config.projectRoot, '.devhub-tasks.json')

export function readTaskStore(): TaskStore {
	try {
		if (existsSync(STORE_FILE)) {
			return JSON.parse(readFileSync(STORE_FILE, 'utf8'))
		}
	} catch {}
	return { tasks: [] }
}

function writeTaskStore(store: TaskStore): void {
	writeFileSync(STORE_FILE, JSON.stringify(store, null, '\t'))
}

export function saveTask(task: SavedTask): void {
	const store = readTaskStore()
	const idx = store.tasks.findIndex((t) => t.name === task.name)
	if (idx >= 0) {
		store.tasks[idx] = task
	} else {
		store.tasks.push(task)
	}
	writeTaskStore(store)
}

export function removeTask(name: string): void {
	const store = readTaskStore()
	store.tasks = store.tasks.filter((t) => t.name !== name)
	writeTaskStore(store)
}

export function setTaskStatus(name: string, status: 'active' | 'stopped'): void {
	const store = readTaskStore()
	const task = store.tasks.find((t) => t.name === name)
	if (task) {
		task.status = status
		writeTaskStore(store)
	}
}

export function getActiveTasks(): SavedTask[] {
	return readTaskStore().tasks.filter((t) => t.status === 'active')
}

export function getStoppedTasks(): SavedTask[] {
	return readTaskStore().tasks.filter((t) => t.status === 'stopped')
}

export function ensureGitignore(): void {
	const gitignorePath = resolve(config.projectRoot, '.gitignore')
	try {
		const content = existsSync(gitignorePath) ? readFileSync(gitignorePath, 'utf8') : ''
		if (!content.includes('.devhub-tasks.json')) {
			appendFileSync(gitignorePath, '\n# Dev Hub task state\n.devhub-tasks.json\n')
		}
	} catch {}
}
