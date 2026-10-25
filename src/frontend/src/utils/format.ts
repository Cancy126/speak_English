import { topicName, type Translate } from '../i18n';

/**
 * Time ago, localised. `t` is a parameter rather than an import of the store so this
 * stays a pure function: it is called from list renders, and the English it used to
 * return (`5m ago`, `never`) leaked into an otherwise Chinese interface.
 */
export function relativeTime(iso: string | null, t: Translate): string {
  if (!iso) return t('time.never');
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return t('time.unknown');
  const diff = Date.now() - then;
  const minutes = Math.round(diff / 60000);
  if (minutes < 1) return t('time.justNow');
  if (minutes < 60) return t('time.minutesAgo', { n: minutes });
  const hours = Math.round(minutes / 60);
  if (hours < 24) return t('time.hoursAgo', { n: hours });
  const days = Math.round(hours / 24);
  if (days < 30) return t('time.daysAgo', { n: days });
  return new Date(iso).toLocaleDateString();
}

export function parseFeedback(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function scoreTone(value: number): string {
  if (value >= 80) return 'text-emerald-600';
  if (value >= 60) return 'text-amber-600';
  return 'text-rose-600';
}

/**
 * How a conversation is labelled: the learner's own name wins, then the topic it was
 * started from. One chain for every screen, so renaming actually renames it everywhere
 * instead of leaving "Travel" behind in one corner (产品规划 3.4.2).
 *
 * The stored topic is the English label the server sent, so it goes through
 * `topicName` — display is localised while the saved value and the prompt stay English.
 */
export function conversationLabel(
  c: { title?: string | null; topic?: string | null; scene?: string | null },
  t: Translate,
): string {
  return c.title || topicName(c.topic, t) || c.scene || t('chat.unnamed');
}
