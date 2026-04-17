import { resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import http from 'node:http'
import { execSync } from 'node:child_process'
import { config } from '../config.js'
import { pool } from '../pool.js'
import { sanitizeBranch, toUnixPath, sleep, dkr } from '../docker.js'
import { eventBus } from '../events.js'
import { destroyTask } from './destroy.js'
import type { TaskFinishRequest } from '../types.js'

const GIT_EXCLUDE = "':!.claude-session' ':!.gitfile-docker' ':!.diffagent-chat.json' ':!.logs' ':!nul'"

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

	// Ensure git can operate in the worktree
	try {
		writeFileSync(resolve(worktreePath, '.git'), `gitdir: ${toUnixPath(worktreeGitDir)}\n`)
	} catch {}
	const gitOpts = { cwd: worktreePath, encoding: 'utf8' as const, timeout: 30000 }

	// Set git identity (WSL worktrees don't inherit the host config)
	try {
		execSync('git config user.name "Daniel Garoz"', gitOpts)
		execSync('git config user.email "heyspanishuk@gmail.com"', gitOpts)
	} catch {}

	// Remove Windows artifacts that break git add
	try { execSync('git rm -f nul 2>/dev/null || rm -f nul', { ...gitOpts, shell: 'bash' }) } catch {}

	// Step 1: Inject a direct, imperative prompt into Claude's terminal
	eventBus.log('Asking Claude to prepare changes...', task)
	const claudePrompt = `Haz lo siguiente SIN preguntar ni pedir confirmación: 1) git add -A 2) git commit con un mensaje descriptivo en inglés imperativo que resuma los cambios 3) Muestra el resultado de git log --oneline -1`

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
		eventBus.log(`Inject failed: ${err.message} — continuing with host fallback`, task)
	}

	// Step 2: Poll git status — wait for Claude to commit or detect stuck
	const hasDirtyFiles = () => {
		try {
			return execSync(`git status --porcelain -- . ${GIT_EXCLUDE}`, gitOpts).trim().length > 0
		} catch { return false }
	}

	const capturePaneHash = async (): Promise<string> => {
		try {
			const pane = await dkr('exec', '-u', 'dev', `app-${slot}`, 'tmux', 'capture-pane', '-t', 'claude', '-p')
			return createHash('md5').update(pane).digest('hex')
		} catch { return '' }
	}

	if (hasDirtyFiles()) {
		eventBus.log('Waiting for Claude to commit (polling every 5s, max 300s)...', task)
		let lastHash = await capturePaneHash()
		let staleCount = 0
		const STALE_THRESHOLD = 4

		for (let i = 0; i < 60; i++) {
			await sleep(5000)

			if (!hasDirtyFiles()) {
				eventBus.log('Worktree clean — Claude committed', task)
				break
			}

			const hash = await capturePaneHash()
			if (hash && hash === lastHash) {
				staleCount++
				if (staleCount >= STALE_THRESHOLD) {
					eventBus.log('Claude appears stuck (terminal unchanged for 20s) — proceeding with fallback', task)
					break
				}
			} else {
				staleCount = 0
				lastHash = hash
			}

			if (i === 59) eventBus.log('Timeout waiting for Claude to commit', task)
		}
	} else {
		eventBus.log('No uncommitted changes — nothing to commit', task)
	}

	// Step 3: Host fallback — commit whatever Claude didn't
	try {
		const status = execSync(`git status --porcelain -- . ${GIT_EXCLUDE}`, gitOpts).trim()
		if (status) {
			eventBus.log('Host fallback: committing remaining changes...', task)
			execSync(`git add -A -- . ${GIT_EXCLUDE}`, gitOpts)
			execSync(`git commit -m "chore: prepare ${task} for merge"`, gitOpts)
		}
	} catch (err: any) {
		eventBus.log(`Host commit fallback: ${err.message?.substring(0, 120)}`, task)
	}

	// Step 4: Merge — only if worktree is clean
	const remaining = execSync(`git status --porcelain -- . ${GIT_EXCLUDE}`, gitOpts).trim()
	if (remaining) {
		eventBus.log(`Aborting merge: ${remaining.split('\n').length} uncommitted file(s) remain. Commit them first.`, task)
		return { prUrl: '' }
	}

	eventBus.log(`Pushing ${task} to ${baseBranch}...`, task)
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

	// Step 5: Destroy task
	try {
		await destroyTask(task)
	} catch (err: any) {
		eventBus.log(`Destroy failed: ${err.message?.substring(0, 200)}`, task)
	}

	return { prUrl: '' }
}
