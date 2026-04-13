import type { Command } from 'commander';
import pc from 'picocolors';
import { readRegistry, killInstance } from '../registry.js';

export function registerKillCommand(program: Command) {
  program
    .command('kill')
    .description('Stop all running diffagent instances')
    .action(() => {
      const entries = readRegistry();

      if (entries.length === 0) {
        console.log(pc.dim('No running diffagent instances.'));
        return;
      }

      for (const entry of entries) {
        killInstance(entry);
      }

      console.log(pc.green(`Stopped ${entries.length} instance${entries.length > 1 ? 's' : ''}.`));
    });
}
