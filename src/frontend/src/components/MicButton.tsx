export function MicButton({
  listening,
  onStart,
  onStop,
}: {
  listening: boolean;
  onStart: () => void;
  onStop: () => void;
}) {
  return (
    <button
      type="button"
      onClick={listening ? onStop : onStart}
      aria-label={listening ? 'Stop recording' : 'Start recording'}
      className={`relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition ${
        listening ? 'bg-rose-500 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
      }`}
    >
      {listening && (
        <span className="absolute inset-0 animate-ping rounded-xl bg-rose-400 opacity-40" />
      )}
      <span aria-hidden className="text-lg">
        {listening ? '■' : '🎤'}
      </span>
    </button>
  );
}
