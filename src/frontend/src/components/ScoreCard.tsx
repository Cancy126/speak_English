import { scoreTone } from '../utils/format';
import { useRecordingPlayer } from '../hooks/useRecordingPlayer';
import { useI18n, type Translate } from '../i18n';
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

/**
 * A function, not a module-level table: a constant built from English (or Chinese)
 * literals is frozen at import time and cannot follow the language switch.
 */
function statusLabel(status: WordScore['status'], t: Translate): string {
  switch (status) {
    case 'substituted':
      return '→';
    case 'missing':
      return t('score.statusMissing');
    case 'unclear':
      return t('score.statusUnclear');
    default:
      return '';
  }
}

const STATUS_TONE: Record<WordScore['status'], string> = {
  matched: 'border-slate-200 bg-white text-slate-600',
  substituted: 'border-amber-200 bg-amber-50 text-amber-800',
  missing: 'border-rose-200 bg-rose-50 text-rose-700',
  unclear: 'border-amber-200 bg-amber-50 text-amber-800',
};

function ReplayRow({
  player,
  labelKey,
}: {
  player: ReturnType<typeof useRecordingPlayer>;
  labelKey: 'score.myTake' | 'score.myWords';
}) {
  const { t } = useI18n();
  if (!player.hasClip) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-2">
      <button
        type="button"
        onClick={() => player.play('all')}
        className="rounded-md border border-slate-300 px-2 py-0.5 text-[11px] text-slate-600 hover:bg-slate-50"
      >
        {player.playing === 'all' ? t('score.stopClip') : t('score.playClip', { label: t(labelKey) })}
      </button>
      {player.loading && <span className="text-[11px] text-slate-400">{t('score.loadingClip')}</span>}
      {player.error && <span className="text-[11px] text-rose-600">{player.error}</span>}
      {!player.loading && !player.error && player.playing === null && (
        <span className="text-[11px] text-slate-400">{t('score.tapWordHint')}</span>
      )}
    </div>
  );
}

/**
 * 产品规划 3.2.2 / 3.2.3 / 3.2.7 / 3.2.8. Word-level only; phoneme detail arrives with GOP.
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
  // Called before the branches below: a hook must not sit behind an early return.
  const { t } = useI18n();
  const player = useRecordingPlayer(card?.audio_asset_id);

  if (!card) {
    return (
      <p className="rounded-lg border border-dashed border-slate-300 p-3 text-xs text-slate-500">
        {pendingReason ?? t('score.pendingDefault')}
      </p>
    );
  }

  const { pronunciation, content, audio_bytes: audioBytes, mode } = card;
  const free = mode === 'free';

  // A take that could not be judged (silence / not the reference sentence). Showing
  // `overall` here would read as "my pronunciation scored 0", which is a different
  // claim than "there is nothing to score" — so the number is withheld entirely.
  if (!pronunciation.attempt_ok) {
    return (
      <div className="space-y-2 text-xs">
        {reference && (
          <p className="text-slate-500">
            <span className="text-[10px] uppercase tracking-wide text-slate-400">
              {t('score.source')}{' '}
            </span>
            {reference}
          </p>
        )}
        <p className="rounded-lg border border-amber-200 bg-amber-50 p-2 leading-snug text-amber-900">
          {pronunciation.note ?? t('score.noPronunciation')}
          {audioBytes
            ? t('score.clipKept', { kb: (audioBytes / 1024).toFixed(0) })
            : ''}
        </p>
        <ReplayRow player={player} labelKey="score.myWords" />
        <p className="text-[10px] leading-snug text-slate-400">{t('score.notRecorded')}</p>
      </div>
    );
  }

  if (!pronunciation.available) {
    return (
      <div className="space-y-2 text-xs">
        <p className="text-slate-500">
          {t('score.saved')}
          {audioBytes ? `（${(audioBytes / 1024).toFixed(0)} KB）` : ''}
        </p>
        <p className="rounded-lg bg-slate-50 p-2 text-slate-500">
          {pronunciation.note ?? t('score.engineUnavailable')}
        </p>
        <ReplayRow player={player} labelKey="score.myTake" />
        {content && (
          <div className="grid grid-cols-3 gap-3 border-t border-slate-100 pt-2">
            <Meter label={t('score.vocab')} value={content.vocabulary_range} />
            <Meter label={t('score.syntax')} value={content.sentence_diversity} />
            <Meter label={t('score.native')} value={content.nativeness} />
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
          <span className="text-[10px] uppercase tracking-wide text-slate-400">
            {t('score.source')}{' '}
          </span>
          {reference}
        </p>
      )}

      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[10px] uppercase tracking-wide text-slate-400">
          {free ? t('score.modeFree') : t('score.modeRead')}
          {pronunciation.wer !== null && ` · ${t('score.wer', { value: pronunciation.wer.toFixed(0) })}`}
        </span>
        <span className={`text-lg font-bold leading-none ${scoreTone(pronunciation.overall)}`}>
          {pronunciation.overall.toFixed(0)}
        </span>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Meter
          label={t('score.pronunciation')}
          value={pronunciation.accuracy}
          hint={free ? t('score.hintPronFree') : t('score.hintPron')}
        />
        <Meter label={t('score.fluency')} value={pronunciation.fluency} hint={t('score.hintFluency')} />
        <Meter
          label={free ? t('score.speechShare') : t('score.completeness')}
          value={pronunciation.completeness}
          hint={free ? t('score.hintSpeechShare') : t('score.hintCompleteness')}
        />
      </div>

      {pronunciation.transcript && (
        <p className="truncate text-slate-500" title={pronunciation.transcript}>
          <span className="text-[10px] uppercase tracking-wide text-slate-400">
            {t('score.heard')}{' '}
          </span>
          {pronunciation.transcript}
        </p>
      )}

      <ReplayRow player={player} labelKey="score.myTake" />

      {trouble.length > 0 && (
        <div className="flex flex-wrap gap-1 border-t border-slate-100 pt-2">
          {trouble.slice(0, 12).map((w, i) => {
            const key = `${w.word}-${i}`;
            const seekable = player.hasClip && w.start !== null && w.status !== 'missing';
            const hint = `${w.expected_ipa ? `/${w.expected_ipa}/ ` : ''}${statusLabel(w.status, t)}${
              w.heard_as ? ` · ${t('score.heardWord', { word: w.heard_as })}` : ''
            } · ${w.score.toFixed(0)}`;
            const body = (
              <>
                <span className="line-through decoration-slate-300">{w.word}</span>
                {w.heard_as && <span>{`→ ${w.heard_as}`}</span>}
                {statusLabel(w.status, t) && (
                  <span className="text-[10px] opacity-70">{statusLabel(w.status, t)}</span>
                )}
                {seekable && (
                  <span className="text-[10px] opacity-60">
                    {player.playing === key ? '■' : '▶'}
                  </span>
                )}
              </>
            );
            if (!seekable) {
              return (
                <span
                  key={key}
                  title={hint}
                  className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 ${STATUS_TONE[w.status]}`}
                >
                  {body}
                </span>
              );
            }
            return (
              <button
                key={key}
                type="button"
                title={`${hint} · ${t('score.replaySegment')}`}
                onClick={() => player.play(key, w.start, w.end)}
                className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 ${
                  STATUS_TONE[w.status]
                } ${player.playing === key ? 'ring-1 ring-brand-400' : 'hover:ring-1 hover:ring-slate-300'}`}
              >
                {body}
              </button>
            );
          })}
        </div>
      )}
      {trouble.length === 0 && (
        <p className="border-t border-slate-100 pt-2 text-emerald-600">{t('score.allClear')}</p>
      )}

      {pronunciation.note && (
        <p className="text-[10px] leading-snug text-slate-400">{pronunciation.note}</p>
      )}

      {content && (
        <div className="grid grid-cols-3 gap-3 border-t border-slate-100 pt-2">
          <Meter label={t('score.vocab')} value={content.vocabulary_range} />
          <Meter label={t('score.syntax')} value={content.sentence_diversity} />
          <Meter label={t('score.native')} value={content.nativeness} />
        </div>
      )}
    </div>
  );
}
