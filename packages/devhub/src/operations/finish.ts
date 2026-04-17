import { resolve } from 'node:path'
import { writeFileSync } from 'node:fs'
import http from 'node:http'
import { execSync } from 'node:child_process'
import { config } from '../config.js'
import { pool } from '../pool.js'
import { toUnixPath, sleep } from '../docker.js'
import { eventBus } from '../events.js'
import { destroyTask } from './destroy.js'
import type { TaskFinishRequest } from '../types.js'

export async function finishTask(
	task: string,
	opts: TaskFinishRequest,
): Promise<{ prUrl: string }> {
	const slot = pool.findTask(task)
	if (!slot) throw new Error(`Task not found: ${task}`)

	const worktreePath = resolve(config.worktreesDir, slot)
	const worktreeGitDir = resolve(config.mainGitDir, 'worktrees', slot)
	const info = pool.getSlot(slot)
	const baseBranch = info?.baseBranch || 'feature/version-3'

	eventBus.log('Finishing...', task)

	// Step 1: Ask Claude to commit all changes with a good message
	eventBus.log('Asking Claude to prepare changes...', task)
	const claudePrompt = [
		`Prepara los cambios de esta rama (${task}) para mergear a ${baseBranch}:`,
		`1. Revisa los cambios con git diff --stat y git status`,
		`2. Haz git add -A`,
		`3. Escribe un mensaje de commit descriptivo en inglés e imperativo que resuma todos los cambios`,
		`4. Haz git commit con ese mensaje`,
		`Muestra un resumen de lo que commiteaste.`,
	].join('\n')

	await new Promise<void>((resolve) => {
		const body = JSON.stringify({ message: claudePrompt })
		const req = http.request({
			hostname: '127.0.0.1',
			port: 80,
			path: `/${encodeURIComponent(task)}/diffagent/api/chat/inject`,
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Content-Length': Buffer.byteLength(body),
				'Host': `diffagent.${task}.localhost`,
			},
			timeout: 30000,
		}, (res) => {
			res.resume()
			res.on('end', () => {
				eventBus.log('Prompt injected into Claude terminal', task)
				resolve()
			})
			res.on('error', () => resolve())
		})
		req.on('error', () => {
			eventBus.log('Inject request failed, continuing...', task)
			resolve()
		})
		req.on('timeout', () => {
			req.destroy()
			eventBus.log('Inject timed out, continuing...', task)
			resolve()
		})
		req.write(body)
		req.end()
	})

	// Give Claude time to actually commit before we try to merge
	eventBus.log('Waiting 90s for Claude to commit...', task)
	await sleep(90000)

	// Step 2: Merge task branch into base branch from the host
	await sleep(2000)
	writeFileSync(resolve(worktreePath, '.git'), `gitdir: ${toUnixPath(worktreeGitDir)}\n`)

	eventBus.log(`Merging ${task} into ${baseBranch}...`, task)
	try {
		// Switch to base branch in the main repo and merge
		const mainRepo = config.gitRoot
		execSync(`git fetch . ${task}:${task}`, { cwd: mainRepo, encoding: 'utf8', timeout: 10000 })
		execSync(`git checkout ${baseBranch}`, { cwd: mainRepo, encoding: 'utf8', timeout: 10000 })
		execSync(`git merge ${task} --no-edit`, { cwd: mainRepo, encoding: 'utf8', timeout: 30000 })
		execSync(`git push origin ${baseBranch}`, { cwd: mainRepo, encoding: 'utf8', timeout: 30000 })
		eventBus.log(`Merged and pushed to ${baseBranch}`, task)
	} catch (err: any) {
		eventBus.log(`Merge failed: ${err.message?.substring(0, 200)}`, task)
	}

	// Restore docker gitfile before destroy
	writeFileSync(resolve(worktreePath, '.gitfile-docker'), 'gitdir: /tmp/git-worktree\n')

	// Step 3: Destroy task
	await destroyTask(task)

	return { prUrl: '' }
}
