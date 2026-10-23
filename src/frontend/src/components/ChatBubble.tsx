import { ScoreCard } from './ScoreCard';
import { parseFeedback, scoreTone } from '../utils/format';
import type { Message, ScoreCard as ScoreCardType } from '../types';

interface Props {
  message: Message;
  onSpeak?: (text: string) => void;
  onRepeat?: (message: Message) => void;
  repeating?: boolean;
  /** This turn's evaluation; rendered right under the bubble and expanded in place (3.2.6). */
  score?: ScoreCardType | null;
}

export function ChatBubble({ message, onSpeak, onRepeat, repeating = false, score }: Props) {
  const isUser = message.role === 'user';
  const feedback = !isUser ? parseFeedback(message.feedback) : null;
  const corrections = (feedback?.corrections as { original: string; fixed: string; reason: string }[] | undefined) ?? [];
  const natural = feedback?.natural as { original: string; better: string } | null | undefined;
  const vocab = feedback?.vocab as { from: string; to: string; why: string } | null | undefined;

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[85%] space-y-2 sm:max-w-[75%]`}>
        <div
          className={`rounded-2xl px-4 py-2.5 text-[15px] leading-relaxed ${
            isUser
              ? 'rounded-br-md bg-brand-600 text-white'
              : 'rounded-bl-md border border-slate-200 bg-white text-slate-800'
          }`}
        >
          <p className="whitespace-pre-wrap">{message.content}</p>
        </div>

        {/* The score belongs to the sentence it came from, so it sits under this
            bubble and expands here — not in a panel by the input box. */}
        {score && (
          <details className="group rounded-lg border border-slate-200 bg-white">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-2 py-1 text-[11px]">
              <span className="flex items-baseline gap-1.5">
                <span className={`font-semibold ${scoreTone(score.pronunciation.overall)}`}>
                  {score.pronunciation.overall.toFixed(0)}
                </span>
                <span className="text-slate-400">
                  {score.mode === 'free' ? '自由表达' : '跟读'}
                  {score.pronunciation.wer !== null && ` · WER ${score.pronunciation.wer.toFixed(0)}%`}
                </span>
              </span>
              <span className="text-slate-300 group-open:hidden">详情 ▾</span>
              <span className="hidden text-slate-300 group-open:inline">收起 ▴</span>
            </summary>
            <div className="border-t border-slate-100 p-2">
              <ScoreCard
                card={score}
                reference={!isUser && score.mode === 'read_aloud' ? message.content : null}
              />
            </div>
          </details>
        )}

        {!isUser && onSpeak && (
          <div className="ml-1 flex gap-3">
            <button
              type="button"
              onClick={() => onSpeak(message.content)}
              className="text-xs text-slate-400 hover:text-brand-600"
            >
              🔊 Listen
            </button>
            {onRepeat && (
              <button
                type="button"
                onClick={() => onRepeat(message)}
                className={`text-xs hover:text-brand-600 ${repeating ? 'text-rose-600' : 'text-slate-400'}`}
              >
                {repeating ? '● 正在录音…' : '🎙️ 跟读评测'}
              </button>
            )}
          </div>
        )}

        {(corrections.length > 0 || natural || vocab) && (
          <div className="space-y-1.5 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
            <p className="font-medium">Feedback on your last turn</p>
            {corrections.map((c) => (
              <p key={c.original}>
                ✏️ <span className="line-through opacity-70">{c.original}</span> →{' '}
                <span className="font-medium">{c.fixed}</span>
                {c.reason ? <span className="opacity-70"> ({c.reason})</span> : null}
              </p>
            ))}
            {natural && (
              <p>
                💬 Say it like: <span className="font-medium">{natural.better}</span>
              </p>
            )}
            {vocab && (
              <p>
                📈 Try <span className="font-medium">{vocab.to}</span> instead of {vocab.from}
                {vocab.why ? <span className="opacity-70"> — {vocab.why}</span> : null}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
