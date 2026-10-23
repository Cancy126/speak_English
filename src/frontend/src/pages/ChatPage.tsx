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
import type { Message, ScoreCard as ScoreCardType } from '../types';

export function ChatPage() {
  const { id } = useParams<{ id: string }>();
  const conversationId = id ? Number(id) : undefined;
  const { current, messages, streamingText, isTyping, error, send, stop } = useChat(conversationId);
  const { speak } = useSpeak();
  const recorder = useRecorder();
  const [target, setTarget] = useState<Message | null>(null);
  /** message_id -> score. Scores follow their sentence, per 产品规划 3.2.6. */
  const [cards, setCards] = useState<Record<number, ScoreCardType>>({});
  const [scoring, setScoring] = useState(false);
  const [scoreError, setScoreError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

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
      setScoreError(err instanceof Error ? err.message : '评分失败');
    } finally {
      setScoring(false);
    }
  };

  const onRepeat = async (message: Message) => {
    if (recorder.recording) {
      await finish();
      return;
    }
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
        setScoreError('没听清，请再试一次');
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
      setScoreError(err instanceof Error ? err.message : '评测失败');
    }
  };

  return (
    <div className="flex h-[calc(100vh-8.5rem)] flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="truncate text-sm font-medium text-slate-600">
          {current?.topic ? `Topic: ${current.topic}` : 'Free conversation'}
        </h2>
        <span className="text-xs text-slate-400">{messages.length} turns</span>
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

        {isTyping && !streamingText && <p className="pl-1 text-xs text-slate-400">Thinking…</p>}

        {error && <p className="text-sm text-rose-600">{error}</p>}
        <div ref={bottomRef} />
      </div>

      {/* Process state only — evaluation results live under their own message. */}
      {(recorder.recording || scoring || scoreError || recorder.error) && (
        <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-3">
          {recorder.recording && (
            <div className="flex items-center justify-between gap-3">
              <p className="min-w-0 flex-1 truncate text-xs text-slate-500">
                跟读：{target?.content}
              </p>
              <div className="flex shrink-0 gap-2">
                <button
                  type="button"
                  onClick={finish}
                  className="rounded-lg bg-rose-500 px-3 py-1 text-xs font-medium text-white"
                >
                  ■ 停止并评分
                </button>
                <button
                  type="button"
                  onClick={() => {
                    recorder.cancel();
                    setTarget(null);
                  }}
                  className="rounded-lg border border-slate-300 px-3 py-1 text-xs text-slate-600"
                >
                  取消
                </button>
              </div>
            </div>
          )}

          {scoring && <p className="text-xs text-slate-500">评分中…</p>}
          {recorder.error && <p className="text-xs text-rose-600">{recorder.error}</p>}
          {scoreError && <p className="text-xs text-rose-600">{scoreError}</p>}
        </div>
      )}

      <ChatInput onSend={send} onVoice={onVoice} busy={isTyping} onStop={stop} />
    </div>
  );
}
