import http from 'node:http';
import { execSync } from 'node:child_process';

const HOST_URL = 'http://host.docker.internal:3100';

let taskName: string | null = null;

function detectTask(): string {
  if (taskName) return taskName;
  try {
    taskName = execSync('git rev-parse --abbrev-ref HEAD', {
      encoding: 'utf8',
      timeout: 5000,
    }).trim();
  } catch {
    taskName = 'unknown';
  }
  return taskName;
}

export function hostGit(cmd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const task = detectTask();
    const url = `${HOST_URL}/api/host/git/${encodeURIComponent(task)}?cmd=${encodeURIComponent(cmd)}`;
    const req = http.get(url, { timeout: 10000 }, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`Host git returned ${res.statusCode}`));
        res.resume();
        return;
      }
      let data = '';
      res.on('data', (c) => data += c);
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Host git timeout')); });
  });
}

// Sync wrapper: tries host first, falls back to local execSync
export function execGit(cmd: string, cwd?: string): string {
  // In Docker, try host service first (sync workaround via blocking on async)
  // This doesn't work well, so we keep local as primary but offer async alternative
  return execSync(`git ${cmd}`, {
    encoding: 'utf8',
    cwd,
    maxBuffer: 50 * 1024 * 1024,
  }).trim();
}
