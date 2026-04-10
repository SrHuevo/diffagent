import type { IncomingMessage, ServerResponse } from 'node:http';
import { getClaudeProcess, type ClaudeMessage } from './claude.js';
import { getThreadsForSession, updateThreadStatus, addReply } from './threads.js';

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
    req.on('error', reject);
  });
}

function json(res: ServerResponse, data: unknown, status = 200): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

export function handleClaudeRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  cwd: string,
): boolean {
  // POST /api/claude/start
  if (pathname === '/api/claude/start' && req.method === 'POST') {
    const claude = getClaudeProcess();
    if (!claude.isRunning) {
      claude.start(cwd);
    }
    json(res, { status: 'started', running: claude.isRunning });
    return true;
  }

  // GET /api/claude/status
  if (pathname === '/api/claude/status' && req.method === 'GET') {
    const claude = getClaudeProcess();
    json(res, { running: claude.isRunning, ready: claude.isReady });
    return true;
  }

  // POST /api/claude/message
  if (pathname === '/api/claude/message' && req.method === 'POST') {
    readBody(req).then((body) => {
      const { message } = JSON.parse(body);
      const claude = getClaudeProcess();

      if (!claude.isRunning) {
        claude.start(cwd);
      }

      claude.send(message);
      json(res, { sent: true });
    }).catch((err) => {
      json(res, { error: err.message }, 500);
    });
    return true;
  }

  // GET /api/claude/stream (SSE)
  if (pathname === '/api/claude/stream' && req.method === 'GET') {
    const claude = getClaudeProcess();

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });

    const sendEvent = (event: string, data: unknown) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    // Send current status
    sendEvent('status', { running: claude.isRunning, ready: claude.isReady });

    const onMessage = (msg: ClaudeMessage) => sendEvent('message', msg);
    const onResult = (msg: ClaudeMessage) => sendEvent('result', msg);
    const onStderr = (text: string) => sendEvent('stderr', { text });
    const onExit = (code: number) => sendEvent('exit', { code });

    claude.on('message', onMessage);
    claude.on('result', onResult);
    claude.on('stderr', onStderr);
    claude.on('exit', onExit);

    // Heartbeat
    const heartbeat = setInterval(() => {
      res.write(': heartbeat\n\n');
    }, 15000);

    req.on('close', () => {
      clearInterval(heartbeat);
      claude.off('message', onMessage);
      claude.off('result', onResult);
      claude.off('stderr', onStderr);
      claude.off('exit', onExit);
    });

    return true;
  }

  // POST /api/claude/resolve
  if (pathname === '/api/claude/resolve' && req.method === 'POST') {
    readBody(req).then(async (body) => {
      const { sessionId, threadIds } = JSON.parse(body);
      const claude = getClaudeProcess();

      if (!claude.isRunning) {
        claude.start(cwd);
      }

      // Fetch the threads to resolve
      const allThreads = getThreadsForSession(sessionId);
      const threads = threadIds
        ? allThreads.filter((t: any) => threadIds.includes(t.id))
        : allThreads.filter((t: any) => t.status === 'open');

      if (threads.length === 0) {
        json(res, { error: 'No open threads to resolve' }, 400);
        return;
      }

      // Build the resolve prompt
      const commentLines = threads.map((t: any) => {
        const lastComment = t.comments[t.comments.length - 1];
        return `- ${t.filePath}:${t.startLine}: "${lastComment.body}"`;
      }).join('\n');

      const prompt = `Resolve these code review comments by making the necessary code changes:\n\n${commentLines}\n\nAfter making changes, briefly describe what you did for each comment.`;

      // Listen for result to auto-resolve threads
      const onResult = (msg: ClaudeMessage) => {
        for (const thread of threads) {
          updateThreadStatus(thread.id, 'resolved', 'Auto-resolved by Claude');
        }
        claude.off('result', onResult);
      };
      claude.on('result', onResult);

      claude.send(prompt);
      json(res, { sent: true, threadCount: threads.length });
    }).catch((err) => {
      json(res, { error: err.message }, 500);
    });
    return true;
  }

  // POST /api/claude/stop
  if (pathname === '/api/claude/stop' && req.method === 'POST') {
    const claude = getClaudeProcess();
    claude.stop();
    json(res, { status: 'stopped' });
    return true;
  }

  return false;
}
