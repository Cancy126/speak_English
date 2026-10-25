import { useCallback, useEffect, useRef, useState } from 'react';
import { translate, type MessageKey } from '../i18n';

export type MicFailure = 'insecure' | 'denied' | 'no-device' | 'busy' | 'unsupported' | 'unknown';

/**
 * Chrome refuses getUserMedia on any non-secure origin and reports it as
 * NotAllowedError — identical to a user pressing "block". So the origin has to
 * be checked before blaming the permission prompt, otherwise a dev server opened
 * through a LAN IP (http://192.168.x.x:5173) looks like a denied permission.
 */
export function classifyMicError(err: unknown): MicFailure {
  if (!window.isSecureContext) return 'insecure';
  const name = err instanceof DOMException ? err.name : '';
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') return 'denied';
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') return 'no-device';
  if (name === 'NotReadableError' || name === 'TrackStartError') return 'busy';
  if (name === 'SecurityError') return 'insecure';
  return 'unknown';
}

/**
 * Each hint is resolved from the i18n table **on access**, not at import time. The old
 * table held finished Chinese sentences, so a module-level constant was frozen in one
 * language and the 中文/EN switch never changed it — the same defect `ScoreCard`'s
 * `STATUS_LABEL` had (产品规划 3.2.10). Keeping the accessors means every existing
 * `MIC_HINTS.denied` call site stays valid.
 *
 * Resolving happens when the failure occurs, so a learner who switches language while a
 * banner is already on screen sees the old wording until the next failure. That is
 * accepted for a transient error rather than threading keys through eight call sites.
 */
const MIC_HINT_KEYS: Record<MicFailure, MessageKey> = {
  insecure: 'mic.insecure',
  denied: 'mic.denied',
  'no-device': 'mic.noDevice',
  busy: 'mic.busy',
  unsupported: 'mic.unsupported',
  unknown: 'mic.unknown',
};

export const MIC_HINTS = {
  get insecure() {
    return translate(MIC_HINT_KEYS.insecure);
  },
  get denied() {
    return translate(MIC_HINT_KEYS.denied);
  },
  get 'no-device'() {
    return translate(MIC_HINT_KEYS['no-device']);
  },
  get busy() {
    return translate(MIC_HINT_KEYS.busy);
  },
  get unsupported() {
    return translate(MIC_HINT_KEYS.unsupported);
  },
  get unknown() {
    return translate(MIC_HINT_KEYS.unknown);
  },
} as Record<MicFailure, string>;

/**
 * How long to wait for `MediaRecorder.onstop` after `stop()` before declaring the take
 * over. Chrome fires it within ~100ms normally; the wait exists only for the case where
 * the browser handed the gesture to the system and the callback never arrives at all.
 */
const STOP_TIMEOUT_MS = 3000;

function pickMime(): string | undefined {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
  if (typeof MediaRecorder === 'undefined') return undefined;
  return candidates.find((c) => MediaRecorder.isTypeSupported(c));
}

export function useRecorder() {
  const supported =
    typeof navigator !== 'undefined' &&
    Boolean(navigator.mediaDevices?.getUserMedia) &&
    typeof MediaRecorder !== 'undefined';

  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);

  const streamRef = useRef<MediaStream | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const mimeRef = useRef<string | undefined>(undefined);
  const startedAtRef = useRef(0);

  const release = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  /**
   * The one place that hands the microphone back and clears `recording`. Every exit from
   * a take goes through here, so no path can leave the flag set — that stale flag is what
   * used to disable the push-to-talk button for the rest of the session.
   */
  const finishReset = useCallback(() => {
    release();
    recRef.current = null;
    setRecording(false);
  }, [release]);

  const start = useCallback(async () => {
    if (!supported) {
      setError(MIC_HINTS.unsupported);
      return false;
    }
    if (!window.isSecureContext) {
      setError(MIC_HINTS.insecure);
      return false;
    }
    setError(null);
    setElapsedMs(0);
    chunksRef.current = [];
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      streamRef.current = stream;
      const mime = pickMime();
      mimeRef.current = mime;
      const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      rec.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.start();
      recRef.current = rec;
      startedAtRef.current = Date.now();
      setRecording(true);
      return true;
    } catch (err) {
      finishReset();
      setError(MIC_HINTS[classifyMicError(err)]);
      return false;
    }
  }, [supported, finishReset]);

  /**
   * Resolves to the recorded blob, or null when nothing usable was captured.
   *
   * The old version resolved *only* inside `rec.onstop`. When Android hands the press
   * over to the system (long-press menu, notification, backgrounding) that callback never
   * arrives, so the promise hung, `recording` stayed true, and `ChatInput`'s
   * `if (recorder.recording) return` guard turned the push-to-talk button into a
   * permanent no-op until a page reload. A lost take is survivable; a stuck microphone
   * and a dead button are not.
   *
   * So `stop()` always settles: either `onstop` fires, or STOP_TIMEOUT_MS elapses and the
   * chunks already received are salvaged (a missing tail is far better than a lost take).
   */
  const stop = useCallback(
    () =>
      new Promise<{ blob: Blob; durationMs: number; mime: string } | null>((resolve) => {
        const rec = recRef.current;
        if (!rec || rec.state === 'inactive') {
          finishReset();
          resolve(null);
          return;
        }
        const durationMs = Date.now() - startedAtRef.current;
        let settled = false;
        const settle = () => {
          if (settled) return; // whichever of the two wins, it wins once
          settled = true;
          window.clearTimeout(timer);
          rec.onstop = null;
          finishReset();
          const blob = new Blob(chunksRef.current, { type: mimeRef.current ?? 'audio/webm' });
          resolve(blob.size > 0 ? { blob, durationMs, mime: blob.type } : null);
        };
        const timer = window.setTimeout(settle, STOP_TIMEOUT_MS);
        rec.onstop = settle;
        rec.stop();
      }),
    [finishReset],
  );

  const cancel = useCallback(() => {
    if (recRef.current && recRef.current.state !== 'inactive') recRef.current.stop();
    chunksRef.current = [];
    finishReset();
  }, [finishReset]);

  useEffect(() => {
    return () => {
      if (recRef.current && recRef.current.state !== 'inactive') recRef.current.stop();
      release();
    };
  }, [release]);

  return { supported, recording, error, elapsedMs, start, stop, cancel, setError };
}
