import type { Command } from 'commander';
import { createHash } from 'node:crypto';
import open from 'open';
import pc from 'picocolors';
import { isGitRepo, getRepoRoot } from '@diffagent/git';
import { findInstanceForRepo } from '../registry.js';

export function registerOpenCommand(program: Command) {
  program
    .command('open')
    .description('Open the browser to a running diffagent instance')
    .argument('[ref]', 'Ref to view (e.g. work, staged, HEAD~1)')
    .action(async (ref?: string) => {
      if (!isGitRepo()) {
        console.error(pc.red('Error: Not a git repository'));
        process.exit(1);
      }

      const repoRoot = getRepoRoot();
      const repoHash = createHash('sha256').update(repoRoot).digest('hex').slice(0, 12);
      const existing = findInstanceForRepo(repoHash);

      if (!existing) {
        console.error(pc.red('No running diffagent instance for this repo.'));
        console.log(`Run ${pc.cyan('diffagent')} to start one.`);
        process.exit(1);
      }

      const urlParams = new URLSearchParams();
      if (ref) {
        urlParams.set('ref', ref);
      }
      const qs = urlParams.toString();
      const url = `http://localhost:${existing.port}/diff${qs ? `?${qs}` : ''}`;

      console.log(`  ${pc.green('→')} ${pc.cyan(url)}`);
      await open(url);
    });
}
