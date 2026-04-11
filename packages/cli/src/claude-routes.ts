import type { IncomingMessage, ServerResponse } from 'node:http';
import { getClaudeProcess, type ClaudeMessage } from './claude.js';
import { getThreadsForSession, updateThreadStatus } from './threads.js';

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
  const claude = getClaudeProcess();
  claude.setCwd(cwd);

  // GET /api/claude/status
  if (pathname === '/api/claude/status' && req.method === 'GET') {
    json(res, { running: claude.isRunning });
    return true;
  }

  // POST /api/claude/message — send message and stream response via SSE
  if (pathname === '/api/claude/message' && req.method === 'POST') {
    readBody(req)
      .then((body) => {
        const { message } = JSON.parse(body);

        if (claude.isRunning) {
          json(res, { error: 'Claude is already processing a message' }, 409);
          return;
        }

        // Set up SSE
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
          'Access-Control-Allow-Origin': '*',
        });

        const sendEvent = (event: string, data: unknown) => {
          res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        };

        const onText = (text: string) => sendEvent('text', { text });
        const onMessage = (msg: ClaudeMessage) => sendEvent('message', msg);
        const onResult = (msg: ClaudeMessage) => {
          sendEvent('result', { result: msg.result });
          cleanup();
          res.end();
        };
        const onDone = () => {
          cleanup();
          res.end();
        };
        const onError = (err: Error) => {
          sendEvent('error', { error: err.message });
          cleanup();
          res.end();
        };

        function cleanup() {
          claude.off('text', onText);
          claude.off('message', onMessage);
          claude.off('result', onResult);
          claude.off('done', onDone);
          claude.off('error', onError);
        }

        claude.on('text', onText);
        claude.on('message', onMessage);
        claude.on('result', onResult);
        claude.on('done', onDone);
        claude.on('error', onError);

        req.on('close', () => {
          cleanup();
        });

        claude.send(message);
      })
      .catch((err) => {
        json(res, { error: err.message }, 500);
      });
    return true;
  }

  // POST /api/claude/resolve — resolve comment threads via Claude
  if (pathname === '/api/claude/resolve' && req.method === 'POST') {
    readBody(req)
      .then((body) => {
        const { sessionId, threadIds } = JSON.parse(body);

        if (claude.isRunning) {
          json(res, { error: 'Claude is already processing' }, 409);
          return;
        }

        const allThreads = getThreadsForSession(sessionId);
        const threads = threadIds
          ? allThreads.filter((t: any) => threadIds.includes(t.id))
          : allThreads.filter((t: any) => t.status === 'open');

        if (threads.length === 0) {
          json(res, { error: 'No open threads to resolve' }, 400);
          return;
        }

        // Build resolve prompt
        const commentLines = threads
          .map((t: any) => {
            const lastComment = t.comments[t.comments.length - 1];
            return `- ${t.filePath}:${t.startLine}: "${lastComment.body}"`;
          })
          .join('\n');

        const prompt = `Resolve these code review comments by making the necessary code changes:\n\n${commentLines}\n\nAfter making changes, briefly describe what you did for each comment.`;

        // SSE response
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
          'Access-Control-Allow-Origin': '*',
        });

        const sendEvent = (event: string, data: unknown) => {
          res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        };

        sendEvent('info', { threadCount: threads.length });

        const onText = (text: string) => sendEvent('text', { text });
        const onResult = () => {
          // Auto-resolve threads after Claude finishes
          for (const thread of threads) {
            try {
              updateThreadStatus(thread.id, 'resolved', 'Auto-resolved by Claude');
            } catch {}
          }
          sendEvent('resolved', { threadIds: threads.map((t: any) => t.id) });
          cleanup();
          res.end();
        };
        const onDone = () => {
          cleanup();
          res.end();
        };

        function cleanup() {
          claude.off('text', onText);
          claude.off('result', onResult);
          claude.off('done', onDone);
        }

        claude.on('text', onText);
        claude.on('result', onResult);
        claude.on('done', onDone);

        claude.send(prompt);
      })
      .catch((err) => {
        json(res, { error: err.message }, 500);
      });
    return true;
  }

  // POST /api/claude/stop
  if (pathname === '/api/claude/stop' && req.method === 'POST') {
    claude.stop();
    json(res, { status: 'stopped' });
    return true;
  }

  // POST /api/claude/reset — clear session
  if (pathname === '/api/claude/reset' && req.method === 'POST') {
    claude.reset();
    json(res, { status: 'reset' });
    return true;
  }

  return false;
}
