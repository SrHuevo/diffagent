#!/usr/bin/env node

import { execSync } from 'child_process';
import { dirname, resolve, join } from 'path';
import { rmSync } from 'fs';
import { fileURLToPath } from 'url';
import concurrently from 'concurrently';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..');

execSync('tsx scripts/link-dev.ts && npm run build:skills', {
  cwd: rootDir,
  stdio: 'inherit',
});

const homeDir = process.env.HOME || process.env.USERPROFILE || '';
const globalClaudeSkillsDir = join(homeDir, '.claude', 'skills');

function cleanupDevSkills() {
  try {
    rmSync(globalClaudeSkillsDir, { recursive: true, force: true });
    console.log('Cleaned up dev skills');
  } catch {}
}

process.on('SIGINT', () => {
  cleanupDevSkills();
  process.exit(0);
});
process.on('SIGTERM', () => {
  cleanupDevSkills();
  process.exit(0);
});

concurrently(
  [
    { command: 'npm run dev -w @diffagent/parser', name: 'parser' },
    { command: 'npm run dev -w @diffagent/git', name: 'git' },
    { command: 'npm run dev -w @diffagent/github', name: 'github' },
    { command: 'npm run dev:watch -w diffagent', name: 'cli' },
    // `vite build --watch` instead of `vite dev` so the output lands in dist/ui
    // where the CLI server can serve it. `vite dev` only serves from memory.
    { command: 'npx -w @diffagent/ui vite build --watch', name: 'ui' },
    {
      command: 'tsx --watch-path=packages/skills scripts/build-skills.ts',
      name: 'skills',
    },
  ],
  {
    prefixColors: ['blue', 'green', 'yellow', 'magenta', 'cyan'],
  }
).result.finally(() => {
  cleanupDevSkills();
});
