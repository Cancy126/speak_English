import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { deleteConversation, listTrash, restoreConversation } from '../api/chat';
import { relativeTime } from '../utils/format';
import { useChatStore } from '../stores/chatStore';
import type { Conversation } from '../types';

/** Days left before a trashed conversation is purged for real; mirrors TRASH_RETENTION_DAYS. */
const TRASH_DAYS = 7;

function daysLeft(deletedAt: string | null): number {
  if (!deletedAt) return TRASH_DAYS;
  const elapsed = Date.now() - new Date(deletedAt).getTime();
  return Math.max(0, Math.ceil(TRASH_DAYS - elapsed / 86_400_000));
}

export function HistoryPage() {
  const { conversations, loadConversations, error } = useChatStore();
  const [trash, setTrash] = useState<Conversation[]>([]);
  const [showTrash, setShowTrash] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const navigate = useNavigate();

  const refresh = useCallback(async () => {
    await loadConversations();
    try {
      setTrash(await listTrash());
    } catch {
      // The trash list is secondary; an empty panel beats a hard error here.
      setTrash([]);
    }
  }, [loadConversations]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const remove = async (c: Conversation) => {
    const label = c.topic ?? c.scene ?? 'this conversation';
    if (!window.confirm(`Delete "${label}"? You can restore it from the trash for ${TRASH_DAYS} days.`)) {
      return;
    }
    setActionError(null);
    try {
      await deleteConversation(c.id);
      await refresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Delete failed');
    }
  };

  const restore = async (c: Conversation) => {
    setActionError(null);
    try {
      await restoreConversation(c.id);
      await refresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Restore failed');
    }
  };

  return (
    <div className="space-y-4 py-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-slate-800">Your conversations</h1>
        <Link
          to="/"
          className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm text-white hover:bg-brand-700"
        >
          New chat
        </Link>
      </div>

      {(error || actionError) && (
        <p className="text-sm text-rose-600">{actionError ?? error}</p>
      )}

      {conversations.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
          Nothing yet. Start a conversation and it will show up here.
        </p>
      ) : (
        <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
          {conversations.map((conversation) => (
            <li key={conversation.id} className="flex items-center gap-2 px-4 py-3">
              <button
                type="button"
                onClick={() => navigate(`/chat/${conversation.id}`)}
                className="min-w-0 flex-1 text-left"
              >
                <span className="block truncate text-sm font-medium text-slate-700">
                  {conversation.topic ?? conversation.scene ?? 'Free conversation'}
                </span>
                <span className="text-xs text-slate-400">
                  {relativeTime(conversation.updated_at)}
                </span>
              </button>
              <button
                type="button"
                onClick={() => remove(conversation)}
                className="shrink-0 rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}

      <section className="space-y-2">
        <button
          type="button"
          onClick={() => setShowTrash((v) => !v)}
          className="text-sm text-slate-500 hover:text-slate-700"
        >
          {showTrash ? '▾' : '▸'} Trash ({trash.length})
        </button>

        {showTrash && (
          trash.length === 0 ? (
            <p className="rounded-xl border border-dashed border-slate-300 p-4 text-center text-xs text-slate-400">
              Empty. Deleted conversations stay here for {TRASH_DAYS} days.
            </p>
          ) : (
            <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
              {trash.map((c) => (
                <li key={c.id} className="flex items-center gap-2 px-4 py-3">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-slate-600">
                      {c.topic ?? c.scene ?? 'Free conversation'}
                    </span>
                    <span className="text-xs text-slate-400">
                      {daysLeft(c.deleted_at)} day(s) left to restore
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => restore(c)}
                    className="shrink-0 rounded-md bg-brand-600 px-2 py-1 text-xs text-white hover:bg-brand-700"
                  >
                    Restore
                  </button>
                </li>
              ))}
            </ul>
          )
        )}
      </section>
    </div>
  );
}
