import { useEffect, useRef, useState } from 'react';
import type { RecordingResult } from '../api/pronunciation';
import { useRecorder } from '../hooks/useRecorder';
import { useI18n, type MessageKey } from '../i18n';

interface Props {
  onSend: (text: string) => void;
  /** A completed push-to-talk recording; the caller transcribes it on the server. */
  onVoice?: (recording: RecordingResult) => Promise<void> | void;
  /**
   * Fires inside the press gesture, before the mic opens. The page uses it to stop any
   * reply that is still playing — otherwise the speaker feeds the AI's voice straight
   * back into the microphone and it gets scored as the learner's attempt.
   */
  onRecordStart?: () => void;
  busy?: boolean;
  onStop?: () => void;
}

/** Holding shorter than this is treated as a mis-tap and discarded, not sent. */
const MIN_HOLD_MS = 500;
/** Drag further up than this before releasing to cancel. */
const CANCEL_SLIDE_PX = 60;
/**
 * Voice-first is the whole point of the app (产品规划 3.2.10 / 建议5), so the keyboard
 * starts collapsed. Learners who genuinely prefer typing (desktop, quiet place) can
 * switch, and their choice survives a reload — per-origin, like every other preference
 * stored in localStorage.
 */
const TEXT_MODE_KEY = 'textMode';

export function ChatInput({ onSend, onVoice, onRecordStart, busy = false, onStop }: Props) {
  const { t } = useI18n();
  const [text, setText] = useState('');
  const recorder = useRecorder();
  /**
   * A key rather than a rendered string: a hint set while the interface was Chinese must
   * not stay Chinese after the learner switches to English mid-recording.
   */
  const [hint, setHint] = useState<{ key: MessageKey; px?: number } | null>(null);
  const [sendingVoice, setSendingVoice] = useState(false);
  const [typing, setTyping] = useState(() => localStorage.getItem(TEXT_MODE_KEY) === '1');
  const startY = useRef(0);
  const cancelling = useRef(false);
  const startedAt = useRef(0);
  /** True when no gesture owns the microphone, so a take can only be handed over once. */
  const settled = useRef(true);

  useEffect(() => {
    localStorage.setItem(TEXT_MODE_KEY, typing ? '1' : '0');
  }, [typing]);

  const submit = () => {
    const value = text.trim();
    if (!value || busy) return;
    onSend(value);
    setText('');
  };

  const pointerDown = async (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!onVoice || busy) return;
    if (recorder.recording) {
      // `settled` says whether a live gesture still owns the microphone. If it does not,
      // this is a take whose release the browser never delivered — reclaim it instead of
      // refusing forever, which is what left the button dead until a reload.
      if (settled.current) recorder.cancel();
      else return; // a second finger during a real hold: ignore, do not interrupt it
    }
    // Claim the gesture before the browser can: left alone, iOS/Android start their
    // long-press text selection here, which fires pointercancel and orphans the mic.
    e.preventDefault();
    // Same gesture: silence a still-playing reply before the mic opens.
    onRecordStart?.();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    startY.current = e.clientY;
    cancelling.current = false;
    settled.current = false;
    setHint(null);
    startedAt.current = Date.now();
    const started = await recorder.start();
    // A tap released before getUserMedia resolved would otherwise leave the mic running
    // with nobody left to stop it.
    if (started && settled.current) recorder.cancel();
  };

  const pointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!recorder.recording) return;
    const up = startY.current - e.clientY;
    cancelling.current = up > CANCEL_SLIDE_PX;
    setHint(
      cancelling.current
        ? { key: 'input.hintSlideUp' }
        : { key: 'input.hintReleasePx', px: up > 0 ? Math.round(up) : undefined },
    );
  };

  /**
   * One path for "finger lifted" and "browser took the gesture away" — both have to hand
   * the microphone back. A pointercancel is not the learner cancelling: they never chose
   * to discard, so the take is sent rather than dropped.
   *
   * Before this, pointercancel only set a flag and nothing ever called stop(), so the
   * recording hung, the mic stayed live, and the early return in pointerDown left the
   * button dead until a page reload.
   */
  const finish = async () => {
    if (settled.current) return; // a stray pointerup after a cancel must not send twice
    settled.current = true;
    if (!recorder.recording) {
      setHint(null);
      return;
    }
    const held = Date.now() - startedAt.current;
    if (cancelling.current) {
      recorder.cancel();
      setHint(null);
      return;
    }
    const recording = await recorder.stop();
    if (!recording || held < MIN_HOLD_MS) {
      if (held < MIN_HOLD_MS) setHint({ key: 'input.hintTooShort' });
      return;
    }
    setSendingVoice(true);
    try {
      await onVoice?.(recording);
    } finally {
      setSendingVoice(false);
      setHint(null);
    }
  };

  const finishRef = useRef(finish);
  useEffect(() => {
    finishRef.current = finish;
  });

  /**
   * Safety net while the mic is open: the release does not always reach this button.
   * Android hands the press to the system (long-press menu, notification shade, app
   * switch, a call coming in) and then sends the element nothing at all — which is how
   * the previous fix still left the button stuck. Listening on window/document means any
   * of those ends the take; `finish` is idempotent, so the element's own events and these
   * can both fire without sending twice.
   */
  useEffect(() => {
    if (!recorder.recording) return;
    const settle = () => void finishRef.current();
    const onHide = () => {
      if (document.visibilityState === 'hidden') settle();
    };
    window.addEventListener('pointerup', settle);
    window.addEventListener('pointercancel', settle);
    window.addEventListener('blur', settle);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      window.removeEventListener('pointerup', settle);
      window.removeEventListener('pointercancel', settle);
      window.removeEventListener('blur', settle);
      document.removeEventListener('visibilitychange', onHide);
    };
  }, [recorder.recording]);

  // Identical press behaviour in both layouts: only the size differs, so the collapse
  // cannot silently downgrade the gesture that every pointer fix above protects.
  const micButton = (
    <button
      type="button"
      disabled={busy || sendingVoice}
      onPointerDown={pointerDown}
      onPointerMove={pointerMove}
      onPointerUp={finish}
      onPointerCancel={finish}
      onContextMenu={(e) => e.preventDefault()}
      onDragStart={(e) => e.preventDefault()}
      aria-label={t('input.holdToTalkAria')}
      className={`no-callout flex touch-none select-none items-center justify-center rounded-xl text-sm font-medium transition disabled:opacity-40 ${
        typing
          ? 'h-10 shrink-0 px-3'
          : 'h-12 flex-1 text-base' /* voice-first: the mic is the primary control */
      } ${
        recorder.recording
          ? cancelling.current
            ? 'bg-rose-500 text-white'
            : 'bg-brand-600 text-white'
          : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
      }`}
    >
      {sendingVoice
        ? t('input.recognizing')
        : recorder.recording
          ? t('input.releaseToSend')
          : t('input.holdToTalk')}
    </button>
  );

  return (
    <div className="space-y-1.5">
      {recorder.error && <p className="px-1 text-xs text-rose-600">{recorder.error}</p>}
      {(hint || recorder.recording) && (
        <p className={`px-1 text-xs ${cancelling.current ? 'text-rose-600' : 'text-slate-500'}`}>
          {hint
            ? t(hint.key) + (hint.px ? `（${hint.px}px）` : '')
            : t('input.recording')}
        </p>
      )}

      <div className="flex items-end gap-2 rounded-2xl border border-slate-300 bg-white p-2 shadow-sm focus-within:border-brand-500">
        {typing ? (
          <textarea
            value={text}
            rows={1}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder={recorder.recording ? t('input.hintRelease') : t('input.typePlaceholder')}
            className="max-h-32 flex-1 resize-none bg-transparent px-2 py-1.5 text-[15px] outline-none placeholder:text-slate-400"
          />
        ) : (
          // Voice-first keeps the row honest about what to do instead of leaving a
          // text field that invites typing by default.
          <p className="min-w-0 flex-1 truncate px-2 py-1.5 text-[15px] text-slate-400">
            {t('input.voiceFirstHint')}
          </p>
        )}

        {onVoice && micButton}

        {busy ? (
          <button
            type="button"
            onClick={onStop}
            className="shrink-0 rounded-xl bg-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-300"
          >
            {t('input.stop')}
          </button>
        ) : (
          typing && (
            <button
              type="button"
              onClick={submit}
              disabled={!text.trim()}
              className="shrink-0 rounded-xl bg-brand-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-brand-700 disabled:opacity-40"
            >
              {t('input.send')}
            </button>
          )
        )}

        {/* The only escape hatch from voice-first; hidden when there is no mic at all. */}
        {onVoice && (
          <button
            type="button"
            onClick={() => setTyping((v) => !v)}
            aria-pressed={typing}
            title={t(typing ? 'input.switchToVoiceHint' : 'input.switchToTextHint')}
            className="shrink-0 rounded-xl px-2 py-2 text-xs text-slate-500 hover:bg-slate-100 hover:text-slate-700"
          >
            {typing ? t('input.switchToVoice') : t('input.switchToText')}
          </button>
        )}
      </div>
    </div>
  );
}
