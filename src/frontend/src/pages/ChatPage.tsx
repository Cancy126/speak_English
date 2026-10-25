import { useCallback, useEffect, useRef, useState } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { scorePronunciation, listConversationScores, storedToCard } from '../api/pronunciation';
import type { RecordingResult } from '../api/pronunciation';
import { transcribe } from '../api/speech';
import { ChatBubble } from '../components/ChatBubble';
import { ChatInput } from '../components/ChatInput';
import { useChat } from '../hooks/useChat';
import { useRecorder } from '../hooks/useRecorder';
import { useSpeak } from '../hooks/useSpeech';
import { TITLE_MAX } from '../stores/chatStore';
import { useI18n } from '../i18n';
import { conversationLabel } from '../utils/format';
import type { Message, ScoreCard as ScoreCardType } from '../types';

/** Persisted so the phone keeps the hands-free mode the learner chose. */
const AUTO_LISTEN_KEY = 'autoListen';

export function ChatPage() {
  const { id } = useParams<{ id: string }>();
  const conversationId = id ? Number(id) : undefined;
  const { current, messages, streamingText, isTyping, error, send, stop, rename } =
    useChat(conversationId);
  const { t } = useI18n();
  const { speak, stop: stopSpeak, unlock, speaking: ttsPlaying, error: ttsError } = useSpeak();
  const recorder = useRecorder();
  const [target, setTarget] = useState<Message | null>(null);
  /** message_id -> score. Scores follow their sentence, per 产品规划 3.2.6. */
  const [cards, setCards] = useState<Record<number, ScoreCardType>>({});
  const [scoring, setScoring] = useState(false);
  const [scoreError, setScoreError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  /** Speak each new reply out loud, like a real conversation (产品规划 3.2.9). */
  const [autoListen, setAutoListen] = useState(() => localStorage.getItem(AUTO_LISTEN_KEY) !== '0');
  /** Messages already handled, so a replayed effect cannot speak the same reply twice. */
  const spoken = useRef<Set<number>>(new Set());
  const seeded = useRef(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    localStorage.setItem(AUTO_LISTEN_KEY, autoListen ? '1' : '0');
  }, [autoListen]);

  // Leaving the conversation must not leave a half-typed name behind for the next one.
  useEffect(() => {
    setEditing(false);
    setDraft('');
    seeded.current = false;
    spoken.current = new Set();
    stopSpeak();
  }, [conversationId, stopSpeak]);

  useEffect(() => {
    const last = messages[messages.length - 1];
    if (!last) return;
    if (!seeded.current) {
      // Opening an existing conversation must not read the whole backlog aloud; only
      // replies that arrive after this point are spoken.
      seeded.current = true;
      messages.forEach((m) => spoken.current.add(m.id));
      return;
    }
    if (spoken.current.has(last.id)) return;
    spoken.current.add(last.id);
    if (last.role !== 'assistant' || !autoListen || recorder.recording) return;
    void speak(last.content);
  }, [messages, autoListen, recorder.recording, speak]);

  const attach = useCallback((messageId: number, card: ScoreCardType) => {
    setCards((prev) => ({ ...prev, [messageId]: card }));
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, streamingText, cards]);

  const hydrate = useCallback(async () => {
    if (!conversationId) return;
    try {
      const rows = await listConversationScores(conversationId);
      // Rows are newest-first, so the first one seen per message wins.
      const next: Record<number, ScoreCardType> = {};
      for (const row of rows) if (!(row.message_id in next)) next[row.message_id] = storedToCard(row);
      setCards((prev) => ({ ...next, ...prev }));
    } catch {
      /* no history is not an error worth surfacing */
    }
  }, [conversationId]);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  // Redirect is render output here, not a side effect fired during render.
  if (!conversationId || Number.isNaN(conversationId)) {
    return <Navigate to="/" replace />;
  }

  // Naming is available here as well as on the history page: this is the moment the
  // learner actually knows what the conversation was about (产品规划 3.4.2).
  const saveName = async () => {
    if (!current) return;
    const updated = await rename(current.id, draft);
    // The store already replaced both `current` and the list row on success, so the
    // header updates without a reload and survives the next `openConversation`.
    if (updated) setEditing(false);
  };

  const finish = async () => {
    const reference = target;
    const recording = await recorder.stop();
    setTarget(null);
    if (!recording || !reference) return;
    setScoring(true);
    setScoreError(null);
    try {
      const card = await scorePronunciation(recording, reference.content, reference.id);
      // Read-aloud scores hang under the sentence that was practised.
      attach(reference.id, card);
    } catch (err) {
      setScoreError(err instanceof Error ? err.message : t('chat.scoreFailed'));
    } finally {
      setScoring(false);
    }
  };

  const onRepeat = async (message: Message) => {
    if (recorder.recording) {
      await finish();
      return;
    }
    // Hand the speaker back to the mic: an still-playing reply would be captured
    // and scored as if the learner had said it.
    stopSpeak();
    setScoreError(null);
    if (await recorder.start()) setTarget(message);
  };

  // Push-to-talk: the server transcribes, the text goes through the normal chat
  // route, then the same audio is scored in `free` mode against the learner's own
  // turn so the score lands under the sentence they actually said.
  const onVoice = async (recording: RecordingResult) => {
    setScoreError(null);
    try {
      const { text } = await transcribe(recording);
      if (!text.trim()) {
        setScoreError(t('chat.noText'));
        return;
      }
      const { userMessageId } = await send(text);
      if (!userMessageId) return;
      setScoring(true);
      try {
        attach(userMessageId, await scorePronunciation(recording, text, userMessageId, 'free'));
      } finally {
        setScoring(false);
      }
    } catch (err) {
      setScoring(false);
      setScoreError(err instanceof Error ? err.message : t('chat.assessFailed'));
    }
  };

  return (
    <div className="flex h-[calc(100vh-8.5rem)] flex-col gap-3">
      <div className="flex items-center gap-2">
        {editing ? (
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <input
              autoFocus
              value={draft}
              maxLength={TITLE_MAX}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void saveName();
                if (e.key === 'Escape') setEditing(false);
              }}
              placeholder={
                current ? conversationLabel(current, t) : t('chat.renamePlaceholder')
              }
              aria-label={t('chat.dialogName')}
              className="min-w-0 flex-1 rounded-lg border border-brand-500 px-2 py-1 text-sm outline-none"
            />
            <button
              type="button"
              onClick={() => void saveName()}
              disabled={!draft.trim()}
              className="shrink-0 rounded-md bg-brand-600 px-2 py-1 text-xs text-white hover:bg-brand-700 disabled:opacity-40"
            >
              {t('history.save')}
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="shrink-0 rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-600"
            >
              {t('history.cancel')}
            </button>
          </div>
        ) : (
          <>
            <h2 className="min-w-0 flex-1 truncate text-sm font-medium text-slate-600">
              {current ? conversationLabel(current, t) : t('chat.unnamed')}
            </h2>
            {ttsPlaying && (
              <button
                type="button"
                onClick={stopSpeak}
                className="shrink-0 text-xs text-brand-600"
                title={t('chat.stopPlayback')}
              >
                {t('chat.playing')}
              </button>
            )}
            <button
              type="button"
              onClick={() => setAutoListen((v) => !v)}
              className="shrink-0 text-xs text-slate-400 hover:text-brand-600"
              title={autoListen ? t('chat.autoListenOnHint') : t('chat.autoListenOffHint')}
            >
              {autoListen ? t('chat.autoListenOn') : t('chat.autoListenOff')}
            </button>
            {current && (
              <button
                type="button"
                onClick={() => {
                  setDraft(current.title ?? '');
                  setEditing(true);
                }}
                className="shrink-0 text-xs text-slate-400 hover:text-brand-600"
                title={t('chat.renameHint')}
              >
                {t('chat.rename')}
              </button>
            )}
            <span className="shrink-0 text-xs text-slate-400">
              {t('chat.turns', { n: messages.length })}
            </span>
          </>
        )}
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto rounded-xl bg-slate-50/60 p-3">
        {messages.map((message) => (
          <ChatBubble
            key={message.id}
            message={message}
            onSpeak={message.role === 'assistant' ? (text) => speak(text) : undefined}
            onRepeat={message.role === 'assistant' ? onRepeat : undefined}
            repeating={target?.id === message.id}
            score={cards[message.id] ?? null}
          />
        ))}

        {streamingText && (
          <div className="flex justify-start">
            <div className="max-w-[85%] rounded-2xl rounded-bl-md border border-slate-200 bg-white px-4 py-2.5 text-[15px] text-slate-700 sm:max-w-[75%]">
              {streamingText}
              <span className="ml-0.5 inline-block animate-pulse">▍</span>
            </div>
          </div>
        )}

        {isTyping && !streamingText && (
          <p className="pl-1 text-xs text-slate-400">{t('chat.thinking')}</p>
        )}

        {error && <p className="text-sm text-rose-600">{error}</p>}
        <div ref={bottomRef} />
      </div>

      {/* Process state only — evaluation results live under their own message. */}
      {(recorder.recording || scoring || scoreError || recorder.error || ttsError) && (
        <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-3">
          {recorder.recording && (
            <div className="flex items-center justify-between gap-3">
              <p className="min-w-0 flex-1 truncate text-xs text-slate-500">
                {t('chat.repeatTarget', { text: target?.content ?? '' })}
              </p>
              <div className="flex shrink-0 gap-2">
                <button
                  type="button"
                  onClick={finish}
                  className="rounded-lg bg-rose-500 px-3 py-1 text-xs font-medium text-white"
                >
                  {t('chat.stopAndScore')}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    recorder.cancel();
                    setTarget(null);
                  }}
                  className="rounded-lg border border-slate-300 px-3 py-1 text-xs text-slate-600"
                >
                  {t('history.cancel')}
                </button>
              </div>
            </div>
          )}

          {scoring && <p className="text-xs text-slate-500">{t('chat.scoring')}</p>}
          {recorder.error && <p className="text-xs text-rose-600">{recorder.error}</p>}
          {scoreError && <p className="text-xs text-rose-600">{scoreError}</p>}
          {/* Playback failures surface here instead of leaving the learner tapping a
              button that appears to do nothing (产品规划 3.2.9). */}
          {ttsError && <p className="text-xs text-rose-600">{ttsError}</p>}
        </div>
      )}

      {/* Any press in the input area is a genuine gesture, so prime mobile audio there:
          iOS only allows playback after an element has been started by a touch. */}
      <div onPointerDown={unlock}>
        <ChatInput
          onSend={send}
          onVoice={onVoice}
          onRecordStart={stopSpeak}
          busy={isTyping}
          onStop={stop}
        />
      </div>
    </div>
  );
}
