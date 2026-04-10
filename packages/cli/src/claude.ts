import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';

export interface ClaudeMessage {
  type: string;
  content?: string;
  tool?: string;
  input?: Record<string, unknown>;
  subtype?: string;
  [key: string]: unknown;
}

export class ClaudeProcess extends EventEmitter {
  private process: ChildProcess | null = null;
  private buffer = '';
  private _isReady = false;

  get isRunning(): boolean {
    return this.process !== null && !this.process.killed;
  }

  get isReady(): boolean {
    return this._isReady;
  }

  start(cwd: string): void {
    if (this.isRunning) return;

    this.process = spawn('claude', [
      '--input-format', 'stream-json',
      '--output-format', 'stream-json',
      '--dangerously-skip-permissions',
      '--verbose',
    ], {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, FORCE_COLOR: '0' },
    });

    this.process.stdout?.on('data', (chunk: Buffer) => {
      this.buffer += chunk.toString();
      const lines = this.buffer.split('\n');
      this.buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg: ClaudeMessage = JSON.parse(line);
          this._isReady = true;
          this.emit('message', msg);

          if (msg.type === 'result') {
            this.emit('result', msg);
          }
        } catch {
          // Non-JSON output, ignore
        }
      }
    });

    this.process.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString().trim();
      if (text) this.emit('stderr', text);
    });

    this.process.on('exit', (code) => {
      this._isReady = false;
      this.process = null;
      this.emit('exit', code);
    });

    this.process.on('error', (err) => {
      this.emit('error', err);
    });
  }

  send(message: string): void {
    if (!this.process?.stdin?.writable) {
      throw new Error('Claude process not running');
    }

    const msg = JSON.stringify({
      type: 'user',
      content: message,
    });

    this.process.stdin.write(msg + '\n');
  }

  stop(): void {
    if (this.process) {
      this.process.kill('SIGTERM');
      this.process = null;
      this._isReady = false;
    }
  }
}

// Singleton instance
let instance: ClaudeProcess | null = null;

export function getClaudeProcess(): ClaudeProcess {
  if (!instance) {
    instance = new ClaudeProcess();
  }
  return instance;
}
