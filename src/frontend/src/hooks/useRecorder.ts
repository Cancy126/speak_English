import { useCallback, useEffect, useRef, useState } from 'react';

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

export const MIC_HINTS: Record<MicFailure, string> = {
  insecure:
    '此页面不是安全上下文，浏览器已禁用麦克风。请改用 http://localhost:5173 或 https 访问（局域网 IP 的 http 会被拒）。',
  denied:
    '麦克风权限被拒绝。点击地址栏左侧图标 → 允许麦克风，或在系统隐私设置里放行浏览器。',
  'no-device': '没有可用的麦克风输入设备。',
  busy: '麦克风被其它程序占用，请关闭后重试。',
  unsupported: '该浏览器不支持录音（MediaRecorder / getUserMedia）。',
  unknown: '无法访问麦克风。',
};

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
      release();
      setError(MIC_HINTS[classifyMicError(err)]);
      setRecording(false);
      return false;
    }
  }, [supported, release]);

  /** Resolves to the recorded blob, or null when nothing usable was captured. */
  const stop = useCallback(
    () =>
      new Promise<{ blob: Blob; durationMs: number; mime: string } | null>((resolve) => {
        const rec = recRef.current;
        if (!rec || rec.state === 'inactive') {
          release();
          setRecording(false);
          resolve(null);
          return;
        }
        const durationMs = Date.now() - startedAtRef.current;
        rec.onstop = () => {
          const blob = new Blob(chunksRef.current, { type: mimeRef.current ?? 'audio/webm' });
          release();
          setRecording(false);
          resolve(blob.size > 0 ? { blob, durationMs, mime: blob.type } : null);
        };
        rec.stop();
      }),
    [release],
  );

  const cancel = useCallback(() => {
    if (recRef.current && recRef.current.state !== 'inactive') recRef.current.stop();
    chunksRef.current = [];
    release();
    setRecording(false);
  }, [release]);

  useEffect(() => {
    return () => {
      if (recRef.current && recRef.current.state !== 'inactive') recRef.current.stop();
      release();
    };
  }, [release]);

  return { supported, recording, error, elapsedMs, start, stop, cancel, setError };
}
