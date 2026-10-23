import { scoreTone } from '../utils/format';
import type { ScoreCard as ScoreCardType, WordScore } from '../types';

function Meter({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-1">
        <span className="truncate text-[11px] text-slate-500" title={hint}>
          {label}
        </span>
        <span className={`text-xs font-semibold ${scoreTone(value)}`}>{value.toFixed(0)}</span>
      </div>
      <div className="mt-0.5 h-1 w-full overflow-hidden rounded-full bg-slate-100">
        <div className="h-full rounded-full bg-brand-500" style={{ width: `${value}%` }} />
      </div>
    </div>
  );
}

const STATUS_LABEL: Record<WordScore['status'], string> = {
  matched: '',
  substituted: '→',
  missing: '漏读',
  unclear: '听不清',
};

const STATUS_TONE: Record<WordScore['status'], string> = {
  matched: 'border-slate-200 bg-white text-slate-600',
  substituted: 'border-amber-200 bg-amber-50 text-amber-800',
  missing: 'border-rose-200 bg-rose-50 text-rose-700',
  unclear: 'border-amber-200 bg-amber-50 text-amber-800',
};

/**
 * 产品规划 3.2.2 / 3.2.3. Word-level only; phoneme detail arrives with GOP.
 *
 * Kept deliberately compact: this panel sits under the chat, and a tall card pushes
 * the sentence being practised out of view. `reference` is therefore rendered first.
 */
export function ScoreCard({
  card,
  reference,
  pendingReason,
}: {
  card: ScoreCardType | null;
  reference?: string | null;
  pendingReason?: string;
}) {
  if (!card) {
    return (
      <p className="rounded-lg border border-dashed border-slate-300 p-3 text-xs text-slate-500">
        {pendingReason ?? '录一段音即可得到发音评分。'}
      </p>
    );
  }

  const { pronunciation, content, audio_bytes: audioBytes, mode } = card;
  const free = mode === 'free';

  if (!pronunciation.available) {
    return (
      <div className="space-y-2 text-xs">
        <p className="text-slate-500">
          录音已保存{audioBytes ? `（${(audioBytes / 1024).toFixed(0)} KB）` : ''}
        </p>
        <p className="rounded-lg bg-slate-50 p-2 text-slate-500">
          {pronunciation.note ?? '本次未能进行发音评测'}
        </p>
        {content && (
          <div className="grid grid-cols-3 gap-3 border-t border-slate-100 pt-2">
            <Meter label="词汇" value={content.vocabulary_range} />
            <Meter label="句式" value={content.sentence_diversity} />
            <Meter label="地道" value={content.nativeness} />
          </div>
        )}
      </div>
    );
  }

  const trouble = pronunciation.words.filter((w) => w.status !== 'matched');

  return (
    <div className="space-y-2 text-xs">
      {/* The sentence being practised must stay readable — it is what the learner
          compares the feedback against. */}
      {reference && (
        <p className="text-slate-500">
          <span className="text-[10px] uppercase tracking-wide text-slate-400">原句 </span>
          {reference}
        </p>
      )}

      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[10px] uppercase tracking-wide text-slate-400">
          {free ? '自由表达 · 发音为置信度代理分' : '跟读评测'}
          {pronunciation.wer !== null && ` · WER ${pronunciation.wer.toFixed(0)}%`}
        </span>
        <span className={`text-lg font-bold leading-none ${scoreTone(pronunciation.overall)}`}>
          {pronunciation.overall.toFixed(0)}
        </span>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Meter
          label="发音"
          value={pronunciation.accuracy}
          hint={free ? 'ASR 逐词置信度代理，非音素级' : '与参考句对齐的准确度（1−WER）'}
        />
        <Meter label="流利" value={pronunciation.fluency} hint="词/秒与长停顿" />
        <Meter
          label={free ? '有效语音' : '完整'}
          value={pronunciation.completeness}
          hint={free ? '转写语音占录音时长比例' : '未漏读的比例'}
        />
      </div>

      {pronunciation.transcript && (
        <p className="truncate text-slate-500" title={pronunciation.transcript}>
          <span className="text-[10px] uppercase tracking-wide text-slate-400">听到 </span>
          {pronunciation.transcript}
        </p>
      )}

      {trouble.length > 0 && (
        <div className="flex flex-wrap gap-1 border-t border-slate-100 pt-2">
          {trouble.slice(0, 12).map((w, i) => (
            <span
              key={`${w.word}-${i}`}
              title={`${w.expected_ipa ? `/${w.expected_ipa}/ ` : ''}${w.status}${
                w.heard_as ? ` · 听到 ${w.heard_as}` : ''
              } · ${w.score.toFixed(0)}`}
              className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 ${STATUS_TONE[w.status]}`}
            >
              <span className="line-through decoration-slate-300">{w.word}</span>
              {w.heard_as && <span>{`→ ${w.heard_as}`}</span>}
              {STATUS_LABEL[w.status] && (
                <span className="text-[10px] opacity-70">{STATUS_LABEL[w.status]}</span>
              )}
            </span>
          ))}
        </div>
      )}
      {trouble.length === 0 && (
        <p className="border-t border-slate-100 pt-2 text-emerald-600">每个词都听清了。</p>
      )}

      {pronunciation.note && (
        <p className="text-[10px] leading-snug text-slate-400">{pronunciation.note}</p>
      )}

      {content && (
        <div className="grid grid-cols-3 gap-3 border-t border-slate-100 pt-2">
          <Meter label="词汇" value={content.vocabulary_range} />
          <Meter label="句式" value={content.sentence_diversity} />
          <Meter label="地道" value={content.nativeness} />
        </div>
      )}
    </div>
  );
}
