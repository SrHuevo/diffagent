import { readFileSync, writeFileSync, existsSync, appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { getRepoRoot } from '@diffagent/git'

export interface ChatMessage {
	role: 'user' | 'assistant' | 'system'
	content: string
	ts: string
}

export interface ChatState {
	sessionId: string | null
	messages: ChatMessage[]
}

const CHAT_FILE = '.diffagent-chat.json'

function getChatPath(): string {
	return join(getRepoRoot(), CHAT_FILE)
}

export function readChat(): ChatState {
	const path = getChatPath()
	try {
		if (existsSync(path)) {
			return JSON.parse(readFileSync(path, 'utf8'))
		}
	} catch {}
	return { sessionId: null, messages: [] }
}

export function writeChat(state: ChatState): void {
	writeFileSync(getChatPath(), JSON.stringify(state, null, '\t'))
}

export function appendMessage(msg: ChatMessage): void {
	const state = readChat()
	state.messages.push(msg)
	writeChat(state)
}

export function setSessionId(sessionId: string): void {
	const state = readChat()
	state.sessionId = sessionId
	writeChat(state)
}

export function clearChat(): void {
	writeChat({ sessionId: null, messages: [] })
}

export function ensureGitignore(): void {
	const gitignorePath = join(getRepoRoot(), '.gitignore')
	try {
		const content = existsSync(gitignorePath) ? readFileSync(gitignorePath, 'utf8') : ''
		if (!content.includes(CHAT_FILE)) {
			appendFileSync(gitignorePath, `\n# Diffity chat history\n${CHAT_FILE}\n`)
		}
	} catch {}
}
