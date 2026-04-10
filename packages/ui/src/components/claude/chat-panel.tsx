import { useState, useRef, useEffect } from 'react';
import type { ChatMessage } from '../../hooks/use-claude';

interface ChatPanelProps {
  messages: ChatMessage[];
  isConnected: boolean;
  isProcessing: boolean;
  onSend: (message: string) => void;
  onResolveAll: () => void;
  onStop: () => void;
  onClear: () => void;
  openThreadCount: number;
}

export function ChatPanel({
  messages,
  isConnected,
  isProcessing,
  onSend,
  onResolveAll,
  onStop,
  onClear,
  openThreadCount,
}: ChatPanelProps) {
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isProcessing) return;
    onSend(input);
    setInput('');
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  return (
    <div className="flex flex-col h-full bg-bg border-l border-border">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <div className="flex items-center gap-2">
          <div
            className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-400' : 'bg-zinc-500'}`}
          />
          <span className="text-sm font-medium text-fg">Claude Code</span>
        </div>
        <div className="flex items-center gap-1">
          {openThreadCount > 0 && (
            <button
              onClick={onResolveAll}
              disabled={isProcessing}
              className="px-2 py-1 text-xs rounded bg-accent text-white hover:opacity-90 disabled:opacity-50"
            >
              Resolve All ({openThreadCount})
            </button>
          )}
          <button
            onClick={onClear}
            className="px-2 py-1 text-xs rounded text-fg-muted hover:text-fg hover:bg-hover"
          >
            Clear
          </button>
          {isConnected && (
            <button
              onClick={onStop}
              className="px-2 py-1 text-xs rounded text-red-400 hover:text-red-300 hover:bg-hover"
            >
              Stop
            </button>
          )}
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {messages.length === 0 && (
          <div className="text-center text-fg-muted text-sm py-8">
            <p>Send a message to Claude Code</p>
            <p className="text-xs mt-1">or use Resolve to fix review comments</p>
          </div>
        )}
        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <form onSubmit={handleSubmit} className="p-3 border-t border-border">
        <div className="flex gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={isProcessing ? 'Claude is working...' : 'Message Claude Code...'}
            disabled={isProcessing}
            rows={1}
            className="flex-1 resize-none px-3 py-2 text-sm rounded-md bg-input border border-border text-fg placeholder:text-fg-muted focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={isProcessing || !input.trim()}
            className="px-3 py-2 rounded-md bg-accent text-white text-sm hover:opacity-90 disabled:opacity-50"
          >
            Send
          </button>
        </div>
      </form>
    </div>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user';
  const isSystem = message.role === 'system';

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[85%] px-3 py-2 rounded-lg text-sm whitespace-pre-wrap ${
          isUser
            ? 'bg-accent text-white rounded-br-sm'
            : isSystem
              ? 'bg-hover text-fg-muted text-xs italic'
              : 'bg-hover text-fg rounded-bl-sm'
        } ${message.isStreaming ? 'border border-accent/30' : ''}`}
      >
        {message.content}
        {message.isStreaming && (
          <span className="inline-block w-1.5 h-4 ml-1 bg-accent animate-pulse" />
        )}
      </div>
    </div>
  );
}
