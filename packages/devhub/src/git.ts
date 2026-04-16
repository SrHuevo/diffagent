import { execFile as execFileCb } from 'node:child_process'
import { promisify } from 'node:util'
import { resolve } from 'node:path'
import { config } from './config.js'
import type { BranchInfo } from './types.js'

const execFile = promisify(execFileCb)

async function git(...args: string[]): Promise<string> {
	const { stdout } = await execFile('git', ['-C', config.gitRoot, ...args], {
		maxBuffer: 10 * 1024 * 1024,
	})
	return stdout.trim()
}

export async function listBranches(): Promise<BranchInfo[]> {
	const output = await git(
		'for-each-ref',
		'--sort=-committerdate',
		'--format=%(refname:short)|%(committerdate:relative)',
		'refs/heads/',
	)
	const branches: BranchInfo[] = []
	const pinnedSet = new Set(config.pinnedBranches)
	const lines = output.split('\n').filter(Boolean)

	for (const name of config.pinnedBranches) {
		const line = lines.find((l) => l.startsWith(`${name}|`))
		if (line) {
			const [, date] = line.split('|')
			branches.push({ name, date, pinned: true })
		}
	}

	for (const line of lines) {
		const [name, date] = line.split('|')
		if (pinnedSet.has(name) || name.startsWith('pool-')) continue
		branches.push({ name, date, pinned: false })
	}

	return branches
}

export async function getWorktreeChanges(slot: string): Promise<{ hasChanges: boolean; summary: string }> {
	const worktreePath = resolve(config.worktreesDir, slot)
	const gitDir = resolve(config.mainGitDir, 'worktrees', slot)
	const { stdout } = await execFile(
		'git',
		['-C', config.gitRoot, `--work-tree=${worktreePath}`, `--git-dir=${gitDir}`, 'status', '--porcelain'],
		{ maxBuffer: 10 * 1024 * 1024 },
	)
	return { hasChanges: stdout.trim().length > 0, summary: stdout.trim() }
}

export async function worktreeAdd(path: string, branch: string, baseBranch: string): Promise<void> {
	try {
		await git('worktree', 'add', path, '-b', branch, baseBranch)
	} catch {
		try {
			await git('worktree', 'add', path, branch)
		} catch (err: any) {
			throw new Error(`Failed to create worktree: ${err.message}`)
		}
	}
}

export async function checkoutBranch(worktreePath: string, task: string, baseBranch: string): Promise<void> {
	// Force checkout: discard local changes that would conflict
	await execFile('git', ['-C', worktreePath, 'checkout', '-f', '-B', task, baseBranch], {
		maxBuffer: 10 * 1024 * 1024,
		timeout: 30000,
	})
}

export async function gitInWorktree(slot: string, ...args: string[]): Promise<string> {
	const worktreePath = resolve(config.worktreesDir, slot)
	const gitDir = resolve(config.mainGitDir, 'worktrees', slot)
	const { stdout } = await execFile(
		'git',
		['-C', config.gitRoot, `--work-tree=${worktreePath}`, `--git-dir=${gitDir}`, ...args],
		{ maxBuffer: 10 * 1024 * 1024 },
	)
	return stdout.trim()
}
