import { useState } from 'react';
import { topicLabel, useI18n } from '../i18n';
import type { Topic } from '../types';

/**
 * Interest bubbles on the landing page (产品规划 3.1.2): pick a bubble, roll the
 * random button, or ignore both and just start typing.
 *
 * The Chinese bubble name comes from the frontend dictionary keyed on `Topic.key`.
 * `Topic.label` stays English on purpose: it is what gets stored as
 * `conversations.topic` and what the scenario prompt feeds to the model, so
 * localising it here keeps the conversation content untouched (产品规划 3.1.7).
 */
export function BubbleSelector({
  topics,
  onPick,
  disabled,
}: {
  topics: Topic[];
  onPick: (topic: Topic | null) => void;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  const [shuffleKey, setShuffleKey] = useState(0);
  const shown = shuffleKey === 0 ? topics : [...topics].sort(() => Math.random() - 0.5);

  return (
    <section className="space-y-5">
      <p className="text-center text-lg text-slate-600">{t('bubble.question')}</p>

      <ul className="flex flex-wrap justify-center gap-3">
        {shown.map((topic, index) => (
          <li key={topic.key} className="animate-float" style={{ animationDelay: `${index * 0.25}s` }}>
            <button
              type="button"
              disabled={disabled}
              onClick={() => onPick(topic)}
              className="flex items-center gap-2 rounded-full border border-brand-50 bg-white px-4 py-2 text-sm shadow-sm transition hover:border-brand-500 hover:shadow disabled:opacity-50"
            >
              <span aria-hidden className="text-base">
                {topic.emoji}
              </span>
              <span>{topicLabel(topic.key, topic.label, t)}</span>
            </button>
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap items-center justify-center gap-3">
        <button
          type="button"
          disabled={disabled}
          onClick={() => setShuffleKey((k) => k + 1)}
          className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm text-slate-600 transition hover:bg-slate-50"
        >
          {t('bubble.shuffle')}
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => onPick(topics[Math.floor(Math.random() * topics.length)] ?? null)}
          className="rounded-full bg-brand-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-700"
        >
          {t('bubble.surprise')}
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => onPick(null)}
          className="rounded-full px-4 py-2 text-sm text-slate-500 underline-offset-4 hover:underline"
        >
          {t('bubble.freely')}
        </button>
      </div>
    </section>
  );
}
