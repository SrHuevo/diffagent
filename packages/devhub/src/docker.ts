import { execFile as execFileCb, exec as execCb } from 'node:child_process'
import { promisify } from 'node:util'
import { config } from './config.js'

const execFile = promisify(execFileCb)
const exec = promisify(execCb)

const DOCKER_ENV = { ...process.env, MSYS_NO_PATHCONV: '1' }

export async function dkr(...args: string[]): Promise<string> {
	const { stdout } = await execFile('docker', args, {
		env: DOCKER_ENV,
		maxBuffer: 10 * 1024 * 1024,
	})
	return stdout.trim()
}

export async function shell(command: string, cwd?: string): Promise<string> {
	const { stdout } = await exec(command, {
		env: DOCKER_ENV,
		cwd: cwd || config.projectRoot,
		maxBuffer: 10 * 1024 * 1024,
	})
	return stdout.trim()
}

export async function ensureNetwork(): Promise<void> {
	try {
		const networks = await dkr('network', 'ls', '--format', '{{.Name}}')
		if (networks.split('\n').includes(config.networkName)) return
	} catch {}
	try {
		await dkr('network', 'create', config.networkName)
	} catch {}
}

export async function ensureTraefik(): Promise<void> {
	try {
		const running = await dkr('ps', '--format', '{{.Names}}')
		if (running.includes('diluu-traefik')) return
	} catch {}
	await shell(
		`docker compose -f "${toUnixPath(config.dockerDir)}/docker-compose.traefik.yml" -p diluu-traefik up -d`,
	)
	await sleep(2000)
}

export async function ensureImage(): Promise<void> {
	try {
		const images = await dkr('images', '--format', '{{.Repository}}:{{.Tag}}')
		if (images.includes('diluu-dev:latest')) return
	} catch {}
	await shell(
		`docker build -t diluu-dev:latest -f "${toUnixPath(config.dockerDir)}/Dockerfile.dev" "${toUnixPath(config.dockerDir)}"`,
	)
}

export function sanitizeBranch(name: string): string {
	return name.replace(/\//g, '-').toLowerCase()
}

export function toUnixPath(p: string): string {
	return p.replace(/\\/g, '/')
}

export function sleep(ms: number): Promise<void> {
	return new Promise((r) => setTimeout(r, ms))
}
