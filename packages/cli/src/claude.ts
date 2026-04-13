import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';

export interface ClaudeMessage {
  type: string;
  subtype?: string;
  content?: string;
  message?: {
    content?: Array<{ type: string; text?: string }>;
    [key: string]: unknown;
  };
  result?: string;
  session_id?: string;
  tool?: string;
  name?: string;
  input?: Record<string, unknown>;
  [key: string]: unknown;
}

export class ClaudeProcess extends EventEmitter {
  private sessionId: string | null = null;
  private activeProcess: ChildProcess | null = null;
  private cwd: string = '';

  get isRunning(): boolean {
    return this.activeProcess !== null && !this.activeProcess.killed;
  }

  setCwd(cwd: string): void {
    this.cwd = cwd;
  }

  send(message: string): void {
    if (this.isRunning) {
      this.emit('error', new Error('Claude is already processing a message'));
      return;
    }

    const args = [
      '-p', message,
      '--output-format', 'stream-json',
      '--verbose',
      '--dangerously-skip-permissions',
    ];

    // Continue previous session if we have one
    if (this.sessionId) {
      args.push('--resume', this.sessionId);
    }

    // Run as non-root user 'dev' if running as root (required for --dangerously-skip-permissions)
    const isRoot = process.getuid?.() === 0;
    const cmd = isRoot ? 'su' : 'claude';
    // Quote each arg for shell when running via su -c (spaces in message would split otherwise)
    const spawnArgs = isRoot
      ? ['dev', '-c', `claude ${args.map((a) => `'${a.replace(/'/g, "'\\''")}'`).join(' ')}`]
      : args;

    this.activeProcess = spawn(cmd, spawnArgs, {
      cwd: this.cwd || process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, FORCE_COLOR: '0' },
    });

    this.activeProcess.stdout?.on('data', (chunk: Buffer) => {
      const lines = chunk.toString().split('\n').filter((l) => l.trim());
      for (const line of lines) {
        try {
          const msg: ClaudeMessage = JSON.parse(line);
          this.emit('message', msg);

          // Capture session ID from init event
          if (msg.type === 'system' && msg.subtype === 'init' && msg.session_id) {
            this.sessionId = msg.session_id as string;
          }

          // Extract text from assistant messages
          if (msg.type === 'assistant' && msg.message?.content) {
            for (const block of msg.message.content) {
              if (block.type === 'text' && block.text) {
                this.emit('text', block.text);
              }
            }
          }

          if (msg.type === 'result') {
            this.emit('result', msg);
          }
        } catch {
          // Non-JSON line
        }
      }
    });

    this.activeProcess.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString().trim();
      if (text && !text.includes('Warning: no stdin')) {
        this.emit('stderr', text);
      }
    });

    this.activeProcess.on('exit', () => {
      this.activeProcess = null;
      this.emit('done');
    });

    this.activeProcess.on('error', (err) => {
      this.activeProcess = null;
      this.emit('error', err);
    });
  }

  stop(): void {
    if (this.activeProcess) {
      this.activeProcess.kill('SIGTERM');
      this.activeProcess = null;
    }
  }

  reset(): void {
    this.stop();
    this.sessionId = null;
  }
}

// Singleton
let instance: ClaudeProcess | null = null;

export function getClaudeProcess(): ClaudeProcess {
  if (!instance) {
    instance = new ClaudeProcess();
  }
  return instance;
}
