export interface User {
  id: number;
  username: string;
  email: string;
  is_admin: boolean;
  is_active: boolean;
  created_at: string;
  last_login: string | null;
}

export interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

export interface Conversation {
  id: number;
  topic: string | null;
  scene: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  /** Set while the conversation sits in the trash; null means live. */
  deleted_at: string | null;
}

export type Role = 'user' | 'assistant' | 'system';

export interface MessageFeedback {
  corrections?: { original: string; fixed: string; reason: string }[];
  natural?: { original: string; better: string } | null;
  vocab?: { from: string; to: string; why: string } | null;
}

export interface Message {
  id: number;
  conversation_id: number;
  role: Role;
  content: string;
  feedback: string | null;
  sequence: number;
  created_at: string;
}

export interface ChatReply {
  user_message: Message;
  assistant_message: Message;
  tts_url: string | null;
}

export interface Topic {
  key: string;
  label: string;
  emoji: string;
  opener: string;
}

export interface PhonemeScore {
  phoneme: string;
  expected_ipa: string;
  score: number;
  status: 'good' | 'near' | 'wrong';
  syllable: string | null;
}

export interface WordScore {
  word: string;
  score: number;
  /** unclear: transcribed with low confidence — a clarity proxy, not a phoneme verdict. */
  status: 'matched' | 'substituted' | 'missing' | 'unclear';
  expected_ipa: string | null;
  heard_as: string | null;
  start: number | null;
  end: number | null;
  phonemes: PhonemeScore[];
}

export interface PronunciationResult {
  accuracy: number;
  fluency: number;
  completeness: number;
  overall: number;
  words: WordScore[];
  engine: string;
  available: boolean;
  note: string | null;
  /** What the STT engine heard; word-level scoring has no phoneme detail yet. */
  transcript: string | null;
  wer: number | null;
}

export interface ContentScore {
  vocabulary_range: number;
  sentence_diversity: number;
  nativeness: number;
  notes: string[];
}

export interface ScoreCard {
  pronunciation: PronunciationResult;
  content: ContentScore | null;
  audio_bytes: number;
  audio_asset_id: number | null;
  /** Set once the evaluation is persisted; keys the collapsed card across reloads. */
  score_id: number | null;
  /** free carries no pronunciation score by design, only content. */
  mode: 'read_aloud' | 'free';
}

export interface ApiError {
  detail: string;
}
