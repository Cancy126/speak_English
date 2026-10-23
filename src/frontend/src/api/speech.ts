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
