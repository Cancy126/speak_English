import { api } from './request';
import type { ContentScore, ScoreCard, WordScore } from '../types';

/**
 * A persisted evaluation from `pronunciation_scores`. Deliberately not a ScoreCard:
 * stored rows carry no content score and no raw audio size, and the collapsed card
 * only needs the numbers to redraw itself after a reload.
 */
export interface StoredScore {
  id: number;
  message_id: number;
  audio_asset_id: number | null;
  mode: 'read_aloud' | 'free';
  reference_text: string;
  heard_text: string | null;
  accuracy: number | null;
  fluency: number | null;
  completeness: number | null;
  overall: number;
  wer: number | null;
  engine: string;
  created_at: string;
  words: WordScore[];
}

export async function listStoredScores(messageId: number): Promise<StoredScore[]> {
  const { data } = await api.get<StoredScore[]>(`/pronunciation/scores/${messageId}`);
  return data;
}

/** One request for the whole conversation, so hydrating collapsed cards is not N+1. */
export async function listConversationScores(conversationId: number): Promise<StoredScore[]> {
  const { data } = await api.get<StoredScore[]>('/pronunciation/scores', {
    params: { conversation_id: conversationId },
  });
  return data;
}

/**
 * The learner's own take, as a playable object URL.
 *
 * Fetched through axios on purpose: the recording route requires the JWT header,
 * and a plain `<audio src="/api/...">` would send none — the request would 401 and
 * the card would look broken. The object URL then supports seeking, which is what
 * makes per-word replay possible.
 */
export async function fetchRecordingUrl(assetId: number): Promise<string> {
  const { data } = await api.get<Blob>(`/pronunciation/recordings/${assetId}`, {
    responseType: 'blob',
  });
  return URL.createObjectURL(data);
}

export function storedToCard(s: StoredScore): ScoreCard {
  return {
    pronunciation: {
      accuracy: s.accuracy ?? 0,
      fluency: s.fluency ?? 0,
      completeness: s.completeness ?? 0,
      overall: s.overall,
      words: s.words ?? [],
      engine: s.engine,
      available: true,
      note: `历史评测（${new Date(s.created_at).toLocaleString()}）`,
      transcript: s.heard_text,
      wer: s.wer,
      // Only judged takes are stored, so a row read back is by definition scored.
      attempt_ok: true,
      reject_code: null,
    },
    content: null,
    audio_bytes: 0,
    audio_asset_id: s.audio_asset_id,
    score_id: s.id,
    mode: s.mode,
  };
}

export interface EngineStatus {
  engine: string;
  available: boolean;
  content_scoring: boolean;
}

export async function fetchEngineStatus(): Promise<EngineStatus> {
  const { data } = await api.get<EngineStatus>('/pronunciation/engine');
  return data;
}

export interface RecordingResult {
  blob: Blob;
  durationMs: number;
  mime: string;
}

/**
 * The backend hangs every recording off a message the caller owns, so messageId
 * is required — it is also what makes the score reviewable later.
 */
export async function scorePronunciation(
  recording: RecordingResult,
  referenceText: string,
  messageId: number,
  mode: 'read_aloud' | 'free' = 'read_aloud',
): Promise<ScoreCard> {
  const form = new FormData();
  const ext = recording.mime.includes('mp4') ? 'm4a' : recording.mime.includes('ogg') ? 'ogg' : 'webm';
  form.append('audio', recording.blob, `recording.${ext}`);
  form.append('reference_text', referenceText);
  form.append('message_id', String(messageId));
  form.append('mode', mode);
  form.append('duration_ms', String(recording.durationMs));
  const { data } = await api.post<ScoreCard>('/pronunciation/score', form);
  return data;
}

/** Text-only scoring, available before the acoustic engine lands in Phase 2. */
export async function scoreContent(transcript: string): Promise<ContentScore> {
  const form = new FormData();
  form.append('transcript', transcript);
  const { data } = await api.post<ContentScore>('/pronunciation/content', form);
  return data;
}

// TTS lives in api/speech.ts (`synthesizeSpeech`) — one client per endpoint, so the
// playback path cannot end up pointing at a stale copy of this call.
