import { useState } from 'react';
import type { Topic } from '../types';

/**
 * Interest bubbles on the landing page (产品规划 3.1.2): pick a bubble, roll the
 * random button, or ignore both and just start typing.
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
  const [shuffleKey, setShuffleKey] = useState(0);
  const shown = shuffleKey === 0 ? topics : [...topics].sort(() => Math.random() - 0.5);

  return (
    <section className="space-y-5">
      <p className="text-center text-lg text-slate-600">What do you want to talk about?</p>

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
              <span>{topic.label}</span>
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
          🔀 Shuffle
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => onPick(topics[Math.floor(Math.random() * topics.length)] ?? null)}
          className="rounded-full bg-brand-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-700"
        >
          🎲 Surprise me
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => onPick(null)}
          className="rounded-full px-4 py-2 text-sm text-slate-500 underline-offset-4 hover:underline"
        >
          Just chat freely
        </button>
      </div>
    </section>
  );
}
