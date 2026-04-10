import { useState, useEffect, useCallback, useRef } from 'react';
import { claudeStart, claudeSendMessage, claudeResolve, claudeStop } from '../lib/api';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
  isStreaming?: boolean;
}

export function useClaude(sessionId: string | undefined) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);
  const currentAssistantRef = useRef<string>('');
  const currentMsgIdRef = useRef<string>('');

  // Connect to SSE stream
  useEffect(() => {
    const es = new EventSource('/api/claude/stream');
    eventSourceRef.current = es;

    es.addEventListener('status', (e) => {
      const data = JSON.parse(e.data);
      setIsConnected(data.running);
    });

    es.addEventListener('message', (e) => {
      const msg = JSON.parse(e.data);

      if (msg.type === 'assistant' && msg.subtype === 'text') {
        const text = msg.content || '';
        currentAssistantRef.current += text;

        setMessages((prev) => {
          const existing = prev.find((m) => m.id === currentMsgIdRef.current);
          if (existing) {
            return prev.map((m) =>
              m.id === currentMsgIdRef.current
                ? { ...m, content: currentAssistantRef.current, isStreaming: true }
                : m,
            );
          }
          const id = `assistant-${Date.now()}`;
          currentMsgIdRef.current = id;
          return [
            ...prev,
            {
              id,
              role: 'assistant',
              content: currentAssistantRef.current,
              timestamp: new Date(),
              isStreaming: true,
            },
          ];
        });
      }

      if (msg.type === 'tool_use') {
        setMessages((prev) => [
          ...prev,
          {
            id: `tool-${Date.now()}`,
            role: 'system',
            content: `🔧 ${msg.tool || msg.name || 'Tool'}: ${typeof msg.input === 'object' ? JSON.stringify(msg.input).slice(0, 100) : '...'}`,
            timestamp: new Date(),
          },
        ]);
      }
    });

    es.addEventListener('result', () => {
      setIsProcessing(false);
      currentAssistantRef.current = '';
      currentMsgIdRef.current = '';

      // Mark last assistant message as done streaming
      setMessages((prev) =>
        prev.map((m) => (m.isStreaming ? { ...m, isStreaming: false } : m)),
      );
    });

    es.addEventListener('exit', () => {
      setIsConnected(false);
      setIsProcessing(false);
    });

    es.onerror = () => {
      setIsConnected(false);
    };

    return () => {
      es.close();
      eventSourceRef.current = null;
    };
  }, []);

  const start = useCallback(async () => {
    await claudeStart();
    setIsConnected(true);
  }, []);

  const send = useCallback(
    async (content: string) => {
      if (!content.trim()) return;

      // Add user message
      setMessages((prev) => [
        ...prev,
        {
          id: `user-${Date.now()}`,
          role: 'user',
          content,
          timestamp: new Date(),
        },
      ]);

      setIsProcessing(true);
      currentAssistantRef.current = '';
      currentMsgIdRef.current = '';

      if (!isConnected) {
        await start();
      }

      await claudeSendMessage(content);
    },
    [isConnected, start],
  );

  const resolve = useCallback(
    async (threadIds?: string[]) => {
      if (!sessionId) return;

      setIsProcessing(true);
      setMessages((prev) => [
        ...prev,
        {
          id: `system-${Date.now()}`,
          role: 'system',
          content: `🔄 Resolving ${threadIds ? threadIds.length : 'all open'} comments...`,
          timestamp: new Date(),
        },
      ]);

      currentAssistantRef.current = '';
      currentMsgIdRef.current = '';

      if (!isConnected) {
        await start();
      }

      await claudeResolve(sessionId, threadIds);
    },
    [sessionId, isConnected, start],
  );

  const stop = useCallback(async () => {
    await claudeStop();
    setIsConnected(false);
    setIsProcessing(false);
  }, []);

  const clear = useCallback(() => {
    setMessages([]);
  }, []);

  return {
    messages,
    isConnected,
    isProcessing,
    send,
    resolve,
    start,
    stop,
    clear,
  };
}
