import { useCallback, useEffect, useRef, useState } from 'react';
import { MIC_HINTS } from './useRecorder';

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((event: any) => void) | null;
  onerror: ((event: any) => void) | null;
  onend: (() => void) | null;
};

function createRecognition(): SpeechRecognitionLike | null {
  const w = window as any;
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  if (!Ctor) return null;
  const rec: SpeechRecognitionLike = new Ctor();
  rec.lang = 'en-US';
  rec.continuous = false;
  rec.interimResults = true;
  return rec;
}

export function useNativeSTT(onFinalText: (text: string) => void) {
  const supported = useRef<boolean>(Boolean(createRecognition())).current;
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  const [error, setError] = useState<string | null>(null);
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const finalRef = useRef(onFinalText);
  finalRef.current = onFinalText;

  const stop = useCallback(() => {
    recRef.current?.stop();
    setListening(false);
  }, []);

  const start = useCallback(() => {
    if (!supported) {
      setError(MIC_HINTS.unsupported);
      return;
    }
    // Chrome blocks the mic on http://<LAN-IP> and reports it as `not-allowed`,
    // which would otherwise be misread as "the user denied permission".
    if (!window.isSecureContext) {
      setError(MIC_HINTS.insecure);
      return;
    }
    const rec = createRecognition();
    if (!rec) return;
    setError(null);
    rec.onresult = (event: any) => {
      let live = '';
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        if (result.isFinal) finalRef.current(result[0].transcript.trim());
        else live += result[0].transcript;
      }
      setInterim(live);
    };
    rec.onerror = (event: any) => {
      const kind = event?.error;
      setError(
        kind === 'not-allowed' || kind === 'service-not-allowed'
          ? MIC_HINTS.denied
          : kind === 'audio-capture'
            ? MIC_HINTS['no-device']
            : kind === 'network'
              ? '语音识别需联网（Chrome 将音频送往 Google 服务），请检查网络后重试。'
              : kind === 'no-speech'
                ? '没听清，请靠近麦克风再说一次。'
                : '识别失败，请重试或直接输入。',
      );
      setListening(false);
      setInterim('');
    };
    rec.onend = () => {
      setListening(false);
      setInterim('');
    };
    recRef.current = rec;
    rec.start();
    setListening(true);
  }, [supported]);

  useEffect(() => () => recRef.current?.stop(), []);

  return { supported, listening, interim, error, start, stop };
}

/**
 * Playback prefers the server mp3 (edge-tts); when TTS is unavailable we use
 * SpeechSynthesis so the learner still hears the reply (技术方案 3.2.4).
 */
export function useSpeak() {
  const [speaking, setSpeaking] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const canSynthesize = useRef<boolean>(
    typeof window !== 'undefined' && 'speechSynthesis' in window,
  ).current;

  const stop = useCallback(() => {
    audioRef.current?.pause();
    audioRef.current = null;
    if (canSynthesize) window.speechSynthesis.cancel();
    setSpeaking(false);
  }, [canSynthesize]);

  const speak = useCallback(
    async (text: string, audioUrl?: string | null) => {
      stop();
      if (!text.trim()) return;

      if (audioUrl) {
        const audio = new Audio(audioUrl);
        audioRef.current = audio;
        audio.onended = () => setSpeaking(false);
        audio.onerror = () => fallbackSynthesize(text, canSynthesize, setSpeaking);
        setSpeaking(true);
        await audio.play().catch(() => fallbackSynthesize(text, canSynthesize, setSpeaking));
        return;
      }
      fallbackSynthesize(text, canSynthesize, setSpeaking);
    },
    [stop, canSynthesize],
  );

  useEffect(() => stop, [stop]);

  return { speak, stop, speaking, ttsSupported: canSynthesize };
}

function fallbackSynthesize(
  text: string,
  canSynthesize: boolean,
  setSpeaking: (v: boolean) => void,
) {
  if (!canSynthesize) {
    setSpeaking(false);
    return;
  }
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'en-US';
  utterance.rate = 0.95;
  utterance.onend = () => setSpeaking(false);
  utterance.onerror = () => setSpeaking(false);
  setSpeaking(true);
  window.speechSynthesis.speak(utterance);
}
