import { create } from 'zustand';
import { en } from './en';
import { zh, type MessageKey } from './zh';

export type { MessageKey } from './zh';

export type Lang = 'zh' | 'en';

const STRINGS: Record<Lang, Record<MessageKey, string>> = { zh, en };

/**
 * Deliberately no i18n library: the string count is small, the project already ships
 * zustand, and `src/frontend/.npmrc` exists only because this network cannot reach
 * registry.npmjs.org reliably — every added dependency is a future install failure.
 */

// Language lives in localStorage, which is per-origin: a 花生壳 free-plan hostname that
// rotates resets this preference to browser detection. Accepted — it is a preference, not
// a session (credentials have their own, bigger version of this problem).
const STORAGE_KEY = 'lang';

function detect(): Lang {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved === 'zh' || saved === 'en') return saved;
  return navigator.language?.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

export type Translate = (key: MessageKey, vars?: Record<string, string | number>) => string;

function format(lang: Lang, key: MessageKey, vars?: Record<string, string | number>): string {
  const table = STRINGS[lang];
  const raw = table[key] ?? zh[key] ?? key;
  if (!vars) return raw;
  return raw.replace(/\{(\w+)\}/g, (_match, name: string) =>
    name in vars ? String(vars[name]) : `{${name}}`,
  );
}

interface I18nState {
  lang: Lang;
  setLang: (lang: Lang) => void;
  toggleLang: () => void;
  t: Translate;
}

export const useI18n = create<I18nState>((set, get) => ({
  lang: detect(),
  setLang: (lang) => {
    localStorage.setItem(STORAGE_KEY, lang);
    set({ lang, t: (key, vars) => format(lang, key, vars) });
  },
  toggleLang: () => get().setLang(get().lang === 'zh' ? 'en' : 'zh'),
  // Recreated on setLang so components re-render with the new strings.
  t: (key, vars) => format(get().lang, key, vars),
}));

/**
 * Translate outside a React render — module-level getters and error strings built inside
 * event handlers, where the `useI18n()` hook cannot be called.
 *
 * Resolution happens at access time, so the wording follows whichever language is current
 * then. A string already parked in a component's state (an error banner, say) keeps the
 * language it was written in until the next failure — the accepted trade-off in 产品规划
 * 3.2.10, chosen over threading keys through every call site.
 */
export function translate(key: MessageKey, vars?: Record<string, string | number>): string {
  return useI18n.getState().t(key, vars);
}

/**
 * Topic bubbles: `Topic.label` arrives from the API in English (`ai_service.TOPICS`),
 * so the translated name is looked up by the stable `Topic.key`. Unknown keys — a topic
 * added later, or a topic string saved on an older conversation — fall back to the
 * label from the server instead of rendering a raw `topic.foo`.
 */
const TOPIC_KEYS: Record<string, MessageKey> = {
  travel: 'topic.travel',
  food: 'topic.food',
  interview: 'topic.interview',
  movies: 'topic.movies',
  sports: 'topic.sports',
  shopping: 'topic.shopping',
  weather: 'topic.weather',
  tech: 'topic.tech',
};

export function topicLabel(key: string, fallback: string, t: Translate): string {
  const known = TOPIC_KEYS[key];
  return known ? t(known) : fallback;
}

/**
 * Older rows store the **English** label (`conversations.topic` is written from
 * `Topic.label`), so the history list and chat header resolve the display name the
 * other way round. Unknown labels pass through untouched rather than showing a key.
 */
const TOPIC_BY_LABEL: Record<string, MessageKey> = {
  Travel: 'topic.travel',
  'Ordering food': 'topic.food',
  'Job interview': 'topic.interview',
  Movies: 'topic.movies',
  Sports: 'topic.sports',
  Shopping: 'topic.shopping',
  'Small talk': 'topic.weather',
  Tech: 'topic.tech',
};

export function topicName(label: string | null | undefined, t: Translate): string | null {
  if (!label) return null;
  const known = TOPIC_BY_LABEL[label];
  return known ? t(known) : label;
}
