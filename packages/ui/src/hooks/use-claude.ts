import { useState, useCallback } from 'react';
import { apiUrl } from '../lib/api';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
  isStreaming?: boolean;
}

export function useClaude(sessionId: string | undefined) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);

  const handleSSEResponse = useCallback(
    async (response: Response, onDone?: () => void) => {
      const reader = response.body?.getReader();
      if (!reader) return;

      const decoder = new TextDecoder();
      let buffer = '';
      let assistantId = `assistant-${Date.now()}`;
      let assistantText = '';

      // Add empty assistant message
      setMessages((prev) => [
        ...prev,
        { id: assistantId, role: 'assistant', content: '', timestamp: new Date(), isStreaming: true },
      ]);

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          let currentEvent = '';
          for (const line of lines) {
            if (line.startsWith('event: ')) {
              currentEvent = line.slice(7);
            } else if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.slice(6));

                if (currentEvent === 'text') {
                  assistantText += data.text;
                  setMessages((prev) =>
                    prev.map((m) =>
                      m.id === assistantId ? { ...m, content: assistantText } : m,
                    ),
                  );
                }

                if (currentEvent === 'result') {
                  setMessages((prev) =>
                    prev.map((m) =>
                      m.id === assistantId
                        ? { ...m, content: assistantText || data.result || '', isStreaming: false }
                        : m,
                    ),
                  );
                }

                if (currentEvent === 'error') {
                  setMessages((prev) => [
                    ...prev,
                    {
                      id: `error-${Date.now()}`,
                      role: 'system',
                      content: `Error: ${data.error}`,
                      timestamp: new Date(),
                    },
                  ]);
                }

                if (currentEvent === 'resolved') {
                  setMessages((prev) => [
                    ...prev,
                    {
                      id: `resolved-${Date.now()}`,
                      role: 'system',
                      content: `Resolved ${data.threadIds?.length || 0} comment(s)`,
                      timestamp: new Date(),
                    },
                  ]);
                }

                if (currentEvent === 'info') {
                  setMessages((prev) => [
                    ...prev,
                    {
                      id: `info-${Date.now()}`,
                      role: 'system',
                      content: `Resolving ${data.threadCount} comment(s)...`,
                      timestamp: new Date(),
                    },
                  ]);
                }
              } catch {}
            }
          }
        }
      } finally {
        setIsProcessing(false);
        setMessages((prev) =>
          prev.map((m) => (m.isStreaming ? { ...m, isStreaming: false } : m)),
        );
        onDone?.();
      }
    },
    [],
  );

  const send = useCallback(
    async (content: string) => {
      if (!content.trim() || isProcessing) return;

      setMessages((prev) => [
        ...prev,
        { id: `user-${Date.now()}`, role: 'user', content, timestamp: new Date() },
      ]);

      setIsProcessing(true);

      try {
        const response = await fetch(apiUrl('/api/claude/message'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: content }),
        });

        if (!response.ok) {
          const err = await response.json().catch(() => ({ error: 'Unknown error' }));
          setMessages((prev) => [
            ...prev,
            {
              id: `error-${Date.now()}`,
              role: 'system',
              content: `Error: ${err.error}`,
              timestamp: new Date(),
            },
          ]);
          setIsProcessing(false);
          return;
        }

        await handleSSEResponse(response);
      } catch (err: any) {
        setMessages((prev) => [
          ...prev,
          {
            id: `error-${Date.now()}`,
            role: 'system',
            content: `Error: ${err.message}`,
            timestamp: new Date(),
          },
        ]);
        setIsProcessing(false);
      }
    },
    [isProcessing, handleSSEResponse],
  );

  const resolve = useCallback(
    async (threadIds?: string[]) => {
      if (!sessionId || isProcessing) return;

      setIsProcessing(true);

      try {
        const response = await fetch(apiUrl('/api/claude/resolve'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId, threadIds }),
        });

        if (!response.ok) {
          const err = await response.json().catch(() => ({ error: 'Unknown error' }));
          setMessages((prev) => [
            ...prev,
            {
              id: `error-${Date.now()}`,
              role: 'system',
              content: `Error: ${err.error}`,
              timestamp: new Date(),
            },
          ]);
          setIsProcessing(false);
          return;
        }

        await handleSSEResponse(response);
      } catch (err: any) {
        setMessages((prev) => [
          ...prev,
          {
            id: `error-${Date.now()}`,
            role: 'system',
            content: `Error: ${err.message}`,
            timestamp: new Date(),
          },
        ]);
        setIsProcessing(false);
      }
    },
    [sessionId, isProcessing, handleSSEResponse],
  );

  const stop = useCallback(async () => {
    try {
      await fetch(apiUrl('/api/claude/stop'), { method: 'POST' });
    } catch {}
    setIsProcessing(false);
  }, []);

  const clear = useCallback(() => {
    setMessages([]);
    fetch(apiUrl('/api/claude/reset'), { method: 'POST' }).catch(() => {});
  }, []);

  return {
    messages,
    isConnected: true, // Always "connected" since we spawn per-message
    isProcessing,
    send,
    resolve,
    stop,
    clear,
  };
}
