import { useState, useRef, useEffect } from 'react';
import type { CommentThread as CommentThreadType, CommentAuthor } from '../types/comment';
import { isThreadResolved } from '../types/comment';
import type { CommentActions } from '../hooks/use-comment-actions';
import { CommentBubble } from './comment-bubble';
import { CommentForm } from './comment-form';
import { CommentIcon } from './icons/comment-icon';
import { TrashIcon } from './icons/trash-icon';
import { ThreadBadge } from './ui/thread-badge';

const DEFAULT_AUTHOR: CommentAuthor = { name: 'You', type: 'user' };

interface PathCommentsProps {
  pathKey: string;
  threads: CommentThreadType[];
  commentActions: CommentActions;
  label: string;
}

export function PathComments(props: PathCommentsProps) {
  const { pathKey, threads, commentActions, label } = props;
  const [open, setOpen] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    const handler = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setOpen(false);
        setShowForm(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const handleSubmit = (body: string) => {
    commentActions.addThread(`__path__:${pathKey}`, 'new', 0, 0, body, DEFAULT_AUTHOR);
    setShowForm(false);
  };

  const handleOpen = () => {
    setOpen(true);
    if (threads.length === 0) {
      setShowForm(true);
    }
  };

  return (
    <div className="relative inline-flex" ref={popoverRef}>
      <button
        onClick={handleOpen}
        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-text-muted hover:text-accent hover:bg-hover transition-colors cursor-pointer"
        title={`Comment on ${label}`}
      >
        <CommentIcon className="w-3.5 h-3.5" />
        {threads.length > 0 && (
          <span className="text-[10px] font-semibold text-accent leading-none">{threads.length}</span>
        )}
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-1 w-96 max-h-[400px] overflow-y-auto bg-bg rounded-lg shadow-lg border border-border z-50">
          <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border">
            <span className="text-[11px] text-text-muted truncate">{label}</span>
            <div className="flex-1" />
            {!showForm && (
              <button
                onClick={() => setShowForm(true)}
                className="text-[11px] text-accent hover:text-accent-hover transition-colors cursor-pointer shrink-0"
              >
                Add comment
              </button>
            )}
          </div>

          <div className="p-2 space-y-2">
            {showForm && (
              <CommentForm
                onSubmit={handleSubmit}
                onCancel={() => {
                  setShowForm(false);
                  if (threads.length === 0) {
                    setOpen(false);
                  }
                }}
                placeholder={`Comment on ${label}...`}
                submitLabel="Comment"
              />
            )}
            {threads.map(thread => (
              <PathThreadCard
                key={thread.id}
                thread={thread}
                onReply={(body) => commentActions.addReply(thread.id, body, DEFAULT_AUTHOR)}
                onResolve={() => commentActions.resolveThread(thread.id)}
                onUnresolve={() => commentActions.unresolveThread(thread.id)}
                onEditComment={(commentId, body) => commentActions.editComment(commentId, body)}
                onDeleteComment={(commentId) => commentActions.deleteComment(thread.id, commentId)}
                onDeleteThread={() => commentActions.deleteThread(thread.id)}
              />
            ))}
            {threads.length === 0 && !showForm && (
              <div className="py-2 text-center text-xs text-text-muted">No comments yet</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

interface PathThreadCardProps {
  thread: CommentThreadType;
  onReply: (body: string) => void;
  onResolve: () => void;
  onUnresolve: () => void;
  onEditComment: (commentId: string, body: string) => void;
  onDeleteComment: (commentId: string) => void;
  onDeleteThread: () => void;
}

function PathThreadCard(props: PathThreadCardProps) {
  const { thread, onReply, onResolve, onUnresolve, onEditComment, onDeleteComment, onDeleteThread } = props;
  const [showReply, setShowReply] = useState(false);
  const resolved = isThreadResolved(thread);

  return (
    <div className="rounded-lg overflow-hidden bg-bg-secondary" data-thread-id={thread.id}>
      <div className="flex items-center justify-between px-3 py-1.5">
        <div className="flex items-center gap-2">
          {resolved && <ThreadBadge variant="resolved" />}
        </div>
        <div className="flex items-center gap-1">
          {resolved ? (
            <button onClick={onUnresolve} className="text-[11px] text-text-muted hover:text-text-secondary transition-colors cursor-pointer">
              Reopen
            </button>
          ) : (
            <button onClick={onResolve} className="text-[11px] text-text-muted hover:text-text-secondary transition-colors cursor-pointer">
              Resolve
            </button>
          )}
          <button onClick={onDeleteThread} className="text-text-muted hover:text-deleted transition-colors cursor-pointer ml-1" title="Delete">
            <TrashIcon className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
      <div className="px-0.5">
        {thread.comments.map(comment => (
          <CommentBubble
            key={comment.id}
            comment={comment}
            onEdit={(body) => onEditComment(comment.id, body)}
            onDelete={() => onDeleteComment(comment.id)}
          />
        ))}
      </div>
      {showReply ? (
        <div className="px-3 py-2">
          <CommentForm
            onSubmit={(body) => {
              onReply(body);
              setShowReply(false);
            }}
            onCancel={() => setShowReply(false)}
            placeholder="Reply..."
            submitLabel="Reply"
          />
        </div>
      ) : (
        <div className="px-3 py-1.5">
          <button onClick={() => setShowReply(true)} className="text-xs text-accent hover:text-accent-hover transition-colors cursor-pointer">
            Reply
          </button>
        </div>
      )}
    </div>
  );
}
