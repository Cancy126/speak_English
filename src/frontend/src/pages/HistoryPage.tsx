import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  deleteConversation,
  listTrash,
  purgeConversation,
  restoreConversation,
} from '../api/chat';
import { conversationLabel, relativeTime } from '../utils/format';
import { translate, useI18n } from '../i18n';
import { TITLE_MAX, useChatStore } from '../stores/chatStore';
import type { Conversation } from '../types';

/** Days a trashed conversation stays restorable; mirrors TRASH_RETENTION_DAYS. */
const TRASH_DAYS = 7;

function daysLeft(deletedAt: string | null): number {
  if (!deletedAt) return TRASH_DAYS;
  const elapsed = Date.now() - new Date(deletedAt).getTime();
  return Math.max(0, Math.ceil(TRASH_DAYS - elapsed / 86_400_000));
}

export function HistoryPage() {
  const { conversations, loadConversations, error, rename } = useChatStore();
  const { t } = useI18n();
  const [trash, setTrash] = useState<Conversation[]>([]);
  const [showTrash, setShowTrash] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState('');
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
    const label = conversationLabel(c, t);
    if (!window.confirm(t('history.deleteConfirm', { name: label, days: TRASH_DAYS }))) return;
    setActionError(null);
    try {
      await deleteConversation(c.id);
      await refresh();
    } catch (err) {
      setActionError(messageOf(err));
    }
  };

  const restore = async (c: Conversation) => {
    setActionError(null);
    try {
      await restoreConversation(c.id);
      await refresh();
    } catch (err) {
      setActionError(messageOf(err));
    }
  };

  // Permanent, and only offered from the trash — the server refuses it otherwise.
  const purge = async (c: Conversation) => {
    const label = conversationLabel(c, t);
    if (!window.confirm(t('history.purgeConfirm', { name: label }))) return;
    setActionError(null);
    try {
      await purgeConversation(c.id);
      await refresh();
    } catch (err) {
      setActionError(messageOf(err));
    }
  };

  const startRename = (c: Conversation) => {
    setEditing(c.id);
    setDraft(c.title ?? c.topic ?? '');
    setActionError(null);
  };

  const saveRename = async (c: Conversation) => {
    // Validation and the request both live in the store, so this rename and the chat
    // page's cannot drift apart on what a legal name is (产品规划 3.4.2).
    const updated = await rename(c.id, draft);
    if (!updated) return;
    setEditing(null);
    // Re-read the list: a rename bumps `updated_at`, which is what orders it.
    await refresh();
  };

  return (
    <div className="space-y-4 py-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-slate-800">{t('history.title')}</h1>
        <Link
          to="/"
          className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm text-white hover:bg-brand-700"
        >
          {t('history.newChat')}
        </Link>
      </div>

      {(error || actionError) && <p className="text-sm text-rose-600">{actionError ?? error}</p>}

      {conversations.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
          {t('history.empty')}
        </p>
      ) : (
        <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
          {conversations.map((conversation) => (
            <li key={conversation.id} className="flex items-center gap-2 px-4 py-3">
              {editing === conversation.id ? (
                <>
                  <input
                    autoFocus
                    value={draft}
                    maxLength={TITLE_MAX}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void saveRename(conversation);
                      if (e.key === 'Escape') setEditing(null);
                    }}
                    className="min-w-0 flex-1 rounded-lg border border-brand-500 px-2 py-1 text-sm outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => saveRename(conversation)}
                    className="shrink-0 rounded-md bg-brand-600 px-2 py-1 text-xs text-white"
                  >
                    {t('history.save')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditing(null)}
                    className="shrink-0 rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-600"
                  >
                    {t('history.cancel')}
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => navigate(`/chat/${conversation.id}`)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <span className="block truncate text-sm font-medium text-slate-700">
                      {conversationLabel(conversation, t)}
                    </span>
                    <span className="text-xs text-slate-400">
                      {relativeTime(conversation.updated_at, t)}
                      {conversation.title && conversation.topic
                        ? ` · ${conversationLabel({ ...conversation, title: null }, t)}`
                        : ''}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => startRename(conversation)}
                    className="shrink-0 rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
                  >
                    {t('history.rename')}
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(conversation)}
                    className="shrink-0 rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
                  >
                    {t('history.delete')}
                  </button>
                </>
              )}
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
          {showTrash ? '▾' : '▸'} {t('history.trash')} ({trash.length})
        </button>

        {showTrash &&
          (trash.length === 0 ? (
            <p className="rounded-xl border border-dashed border-slate-300 p-4 text-center text-xs text-slate-400">
              {t('history.trashEmpty', { days: TRASH_DAYS })}
            </p>
          ) : (
            <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
              {trash.map((c) => (
                <li key={c.id} className="flex items-center gap-2 px-4 py-3">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-slate-600">
                      {conversationLabel(c, t)}
                    </span>
                    <span className="text-xs text-slate-400">
                      {t('history.daysLeft', { days: daysLeft(c.deleted_at) })}
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => restore(c)}
                    className="shrink-0 rounded-md bg-brand-600 px-2 py-1 text-xs text-white hover:bg-brand-700"
                  >
                    {t('history.restore')}
                  </button>
                  <button
                    type="button"
                    onClick={() => purge(c)}
                    className="shrink-0 rounded-md border border-rose-200 px-2 py-1 text-xs text-rose-600 hover:bg-rose-50"
                  >
                    {t('history.purge')}
                  </button>
                </li>
              ))}
            </ul>
          ))}
      </section>
    </div>
  );
}

function messageOf(err: unknown): string {
  if (err && typeof err === 'object' && 'response' in err) {
    const res = (err as { response?: { data?: { detail?: string } } }).response;
    if (res?.data?.detail) return res.data.detail;
  }
  // The server's own `detail` above is not translated (界面双语的边界，3.2.10); this
  // fallback is ours, so it goes through the dictionary like every other UI string.
  return err instanceof Error ? err.message : translate('common.failed');
}
