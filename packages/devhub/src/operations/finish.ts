import { resolve } from 'node:path'
import { writeFileSync } from 'node:fs'
import http from 'node:http'
import { execSync } from 'node:child_process'
import { config } from '../config.js'
import { pool } from '../pool.js'
import { sanitizeBranch, toUnixPath, sleep } from '../docker.js'
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
	const safe = sanitizeBranch(task)

	eventBus.log('Finishing...', task)

	// Step 1: Ask Claude to commit all changes with a good message.
	// The inject pastes the prompt into the live tmux claude session.
	eventBus.log('Asking Claude to prepare changes...', task)
	const claudePrompt = [
		`Prepara los cambios de esta rama (${task}) para mergear a ${baseBranch}:`,
		`1. Revisa los cambios con git diff --stat y git status`,
		`2. Haz git add -A`,
		`3. Escribe un mensaje de commit descriptivo en inglés e imperativo que resuma todos los cambios`,
		`4. Haz git commit con ese mensaje`,
		`Muestra un resumen de lo que commiteaste.`,
	].join('\n')

	try {
		await new Promise<void>((resolve, reject) => {
			const body = JSON.stringify({ message: claudePrompt })
			const req = http.request({
				hostname: '127.0.0.1',
				port: 80,
				path: `/${safe}/diffagent/api/chat/inject`,
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Content-Length': Buffer.byteLength(body),
					'Host': `diffagent.${safe}.localhost`,
				},
				timeout: 30000,
			}, (res) => {
				res.resume()
				res.on('end', () => {
					if (res.statusCode && res.statusCode >= 400) {
						reject(new Error(`Inject returned ${res.statusCode}`))
					} else {
						resolve()
					}
				})
				res.on('error', reject)
			})
			req.on('error', reject)
			req.on('timeout', () => { req.destroy(); reject(new Error('timeout')) })
			req.write(body)
			req.end()
		})
		eventBus.log('Prompt injected into Claude terminal', task)
	} catch (err: any) {
		eventBus.log(`Inject failed: ${err.message} — continuing without Claude commit`, task)
	}

	// Give Claude time to actually commit before we try to merge
	eventBus.log('Waiting 90s for Claude to commit...', task)
	await sleep(90000)

	// Step 2: Commit any remaining uncommitted changes from the host
	// (fallback in case Claude didn't commit or had auth issues).
	try {
		writeFileSync(resolve(worktreePath, '.git'), `gitdir: ${toUnixPath(worktreeGitDir)}\n`)
	} catch {}

	const gitOpts = { cwd: worktreePath, encoding: 'utf8' as const, timeout: 30000 }
	try {
		const status = execSync('git status --porcelain', gitOpts).trim()
		if (status) {
			eventBus.log('Host fallback: committing remaining changes...', task)
			execSync('git add -A', gitOpts)
			execSync(`git commit -m "chore: prepare ${task} for merge"`, gitOpts)
		}
	} catch (err: any) {
		eventBus.log(`Host commit fallback: ${err.message?.substring(0, 120)}`, task)
	}

	// Step 3: Merge task branch into base branch.
	// Use the worktree's own git to push directly — avoids the "refusing to
	// fetch into branch checked out at worktree" error that happens when the
	// main repo tries to update a branch that a worktree holds.
	eventBus.log(`Merging ${task} into ${baseBranch}...`, task)
	try {
		execSync(`git push origin HEAD:${baseBranch}`, { ...gitOpts, timeout: 60000 })
		eventBus.log(`Pushed to ${baseBranch}`, task)
	} catch (err: any) {
		eventBus.log(`Push failed: ${err.message?.substring(0, 200)}`, task)
	}

	// Restore docker gitfile before destroy
	try {
		writeFileSync(resolve(worktreePath, '.gitfile-docker'), 'gitdir: /tmp/git-worktree\n')
	} catch {}

	// Step 4: Destroy task
	try {
		await destroyTask(task)
	} catch (err: any) {
		eventBus.log(`Destroy failed: ${err.message?.substring(0, 200)}`, task)
	}

	return { prUrl: '' }
}
