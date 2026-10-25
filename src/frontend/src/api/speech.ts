import { api } from './request';
import type { RecordingResult } from './pronunciation';

export interface Transcript {
  text: string;
  duration: number;
  words: { word: string; start: number; end: number; confidence: number }[];
  client_duration_ms: number | null;
}

export interface SpeechCapabilities {
  server_tts: boolean;
  server_stt: boolean;
  stt_engine: string;
  note: string;
}

/** Push-to-talk transcription on the server's local model; costs nothing upstream. */
export async function transcribe(recording: RecordingResult): Promise<Transcript> {
  const form = new FormData();
  const ext = recording.mime.includes('mp4') ? 'm4a' : recording.mime.includes('ogg') ? 'ogg' : 'webm';
  form.append('audio', recording.blob, `recording.${ext}`);
  form.append('duration_ms', String(recording.durationMs));
  const { data } = await api.post<Transcript>('/speech/transcribe', form);
  return data;
}

export async function fetchCapabilities(): Promise<SpeechCapabilities> {
  const { data } = await api.get<SpeechCapabilities>('/speech/capabilities');
  return data;
}

export interface TtsReply {
  audio_url: string | null;
  fallback: string | null;
  text: string;
}

/**
 * Ask the server to synthesize the reply with edge-tts.
 *
 * Free of charge, but it is an outbound request to Microsoft and it can legitimately
 * come back with `audio_url: null` — the caller must then fall through to browser
 * synthesis instead of going silent. That silent path is exactly what made 🔊 Listen
 * look broken on phones (产品规划 3.2.9).
 */
export async function synthesizeSpeech(text: string): Promise<TtsReply> {
  const { data } = await api.post<TtsReply>('/speech/tts', { text });
  return data;
}
