import { useRef, useState } from 'react';
import type { RecordingResult } from '../api/pronunciation';
import { useRecorder } from '../hooks/useRecorder';

interface Props {
  onSend: (text: string) => void;
  /** A completed push-to-talk recording; the caller transcribes it on the server. */
  onVoice?: (recording: RecordingResult) => Promise<void> | void;
  busy?: boolean;
  onStop?: () => void;
}

/** Holding shorter than this is treated as a mis-tap and discarded, not sent. */
const MIN_HOLD_MS = 500;
/** Drag further up than this before releasing to cancel. */
const CANCEL_SLIDE_PX = 60;

export function ChatInput({ onSend, onVoice, busy = false, onStop }: Props) {
  const [text, setText] = useState('');
  const recorder = useRecorder();
  const [hint, setHint] = useState<string | null>(null);
  const [sendingVoice, setSendingVoice] = useState(false);
  const startY = useRef(0);
  const cancelling = useRef(false);
  const startedAt = useRef(0);

  const submit = () => {
    const value = text.trim();
    if (!value || busy) return;
    onSend(value);
    setText('');
  };

  const pointerDown = async (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!onVoice || busy || recorder.recording) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    startY.current = e.clientY;
    cancelling.current = false;
    setHint(null);
    startedAt.current = Date.now();
    await recorder.start();
  };

  const pointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!recorder.recording) return;
    const up = startY.current - e.clientY;
    cancelling.current = up > CANCEL_SLIDE_PX;
    setHint(cancelling.current ? '松开手指取消发送' : `松开发送 · 上滑取消${up > 0 ? `（${Math.round(up)}px）` : ''}`);
  };

  const pointerUp = async () => {
    if (!recorder.recording) return;
    const held = Date.now() - startedAt.current;
    if (cancelling.current) {
      recorder.cancel();
      setHint(null);
      return;
    }
    const recording = await recorder.stop();
    if (!recording || held < MIN_HOLD_MS) {
      if (held < MIN_HOLD_MS) setHint('说得太短了，请按住说完再松开');
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

  const pointerLeave = () => {
    if (recorder.recording) cancelling.current = true;
  };

  return (
    <div className="space-y-1.5">
      {recorder.error && <p className="px-1 text-xs text-rose-600">{recorder.error}</p>}
      {(hint || recorder.recording) && (
        <p className={`px-1 text-xs ${cancelling.current ? 'text-rose-600' : 'text-slate-500'}`}>
          {hint ?? '正在录音…'}
        </p>
      )}

      <div className="flex items-end gap-2 rounded-2xl border border-slate-300 bg-white p-2 shadow-sm focus-within:border-brand-500">
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
          placeholder={recorder.recording ? '松开发送，上滑取消' : '打字或按住说话…'}
          className="max-h-32 flex-1 resize-none bg-transparent px-2 py-1.5 text-[15px] outline-none placeholder:text-slate-400"
        />

        {onVoice && (
          <button
            type="button"
            disabled={busy || sendingVoice}
            onPointerDown={pointerDown}
            onPointerMove={pointerMove}
            onPointerUp={pointerUp}
            onPointerCancel={pointerLeave}
            onContextMenu={(e) => e.preventDefault()}
            aria-label="按住说话"
            className={`flex h-10 shrink-0 select-none touch-none items-center justify-center rounded-xl px-3 text-sm font-medium transition disabled:opacity-40 ${
              recorder.recording
                ? cancelling.current
                  ? 'bg-rose-500 text-white'
                  : 'bg-brand-600 text-white'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            {sendingVoice ? '识别中…' : recorder.recording ? '松开 发送' : '🎤 按住说话'}
          </button>
        )}

        {busy ? (
          <button
            type="button"
            onClick={onStop}
            className="rounded-xl bg-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-300"
          >
            Stop
          </button>
        ) : (
          <button
            type="button"
            onClick={submit}
            disabled={!text.trim()}
            className="rounded-xl bg-brand-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-brand-700 disabled:opacity-40"
          >
            Send
          </button>
        )}
      </div>
    </div>
  );
}
