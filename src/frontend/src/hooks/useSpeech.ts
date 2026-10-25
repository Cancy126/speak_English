import { useCallback, useEffect, useRef, useState } from 'react';
import { synthesizeSpeech } from '../api/speech';
import { silentWav } from '../utils/silentWav';
import { MIC_HINTS } from './useRecorder';
import { translate } from '../i18n';

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
              ? translate('stt.network')
              : kind === 'no-speech'
                ? translate('stt.noSpeech')
                : translate('stt.failed'),
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

/** `TTSRequest.text` is capped at 2000 chars server-side (routers/speech.py). */
const MAX_SERVER_TTS = 2000;

/**
 * Speaks a reply out loud.
 *
 * Order matters and is the fix for "no sound on the phone" (产品规划 3.2.9): the
 * server's edge-tts mp3 comes first, browser SpeechSynthesis is the fallback. The
 * old code always used SpeechSynthesis because nothing ever passed an audio URL, and
 * a phone with no English voice pack fails silently — `speak()` returns, no error,
 * no sound. So every path here now ends either in audible playback or in a message.
 */
export function useSpeak() {
  const [speaking, setSpeaking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  /** Guards against a slow synthesis arriving after the learner already moved on. */
  const generation = useRef(0);
  const unlocked = useRef(false);
  /** text -> server URL, so tapping Listen twice does not synthesize twice. */
  const urls = useRef(new Map<string, string>());
  const canSynthesize = useRef<boolean>(
    typeof window !== 'undefined' && 'speechSynthesis' in window,
  ).current;

  const stop = useCallback(() => {
    generation.current += 1;
    audioRef.current?.pause();
    audioRef.current = null;
    if (canSynthesize) window.speechSynthesis.cancel();
    setSpeaking(false);
  }, [canSynthesize]);

  const speakLocally = useCallback(
    (text: string, gen: number) => {
      if (!canSynthesize) {
        setSpeaking(false);
        setError(translate('tts.noEngine'));
        return;
      }
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'en-US';
      utterance.rate = 0.95;
      utterance.onend = () => {
        if (generation.current === gen) setSpeaking(false);
      };
      // Not silent any more: this is the branch the phone was hitting.
      utterance.onerror = () => {
        if (generation.current !== gen) return;
        setSpeaking(false);
        setError(translate('tts.noSound'));
      };
      setSpeaking(true);
      window.speechSynthesis.speak(utterance);
    },
    [canSynthesize],
  );

  const play = useCallback(
    async (url: string, text: string, gen: number) => {
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => {
        if (generation.current === gen) setSpeaking(false);
      };
      audio.onerror = () => {
        if (generation.current === gen) speakLocally(text, gen);
      };
      setSpeaking(true);
      try {
        await audio.play();
      } catch (err) {
        if (generation.current !== gen) return;
        // Autoplay was blocked, or the clip will not decode in this browser.
        if (unlocked.current && err instanceof DOMException && err.name === 'NotAllowedError') {
          unlocked.current = false; // retry priming on the next gesture
        }
        speakLocally(text, gen);
      }
    },
    [speakLocally],
  );

  const speak = useCallback(
    async (text: string) => {
      stop();
      const clean = text.trim();
      if (!clean) return;
      const gen = generation.current;
      setError(null);

      if (clean.length > MAX_SERVER_TTS) {
        speakLocally(clean, gen);
        return;
      }
      const hit = urls.current.get(clean);
      if (hit) {
        void play(hit, clean, gen);
        return;
      }
      try {
        const { audio_url } = await synthesizeSpeech(clean);
        if (generation.current !== gen) return; // the learner already moved on
        if (!audio_url) {
          speakLocally(clean, gen);
          return;
        }
        urls.current.set(clean, audio_url);
        void play(audio_url, clean, gen);
      } catch (err) {
        if (generation.current !== gen) return;
        setError(
          err instanceof Error
            ? translate('tts.failedReason', { reason: err.message })
            : translate('tts.failed'),
        );
        speakLocally(clean, gen);
      }
    },
    [play, speakLocally, stop],
  );

  /**
   * iOS only lets audio start from inside a real touch, so the first Listen tap primes
   * the element with 10ms of silence; the reply can then be spoken when it lands.
   */
  const unlock = useCallback(() => {
    if (unlocked.current) return;
    unlocked.current = true;
    const audio = new Audio(silentWav());
    audio.volume = 0;
    audio.play().catch(() => {
      unlocked.current = false;
    });
  }, []);

  useEffect(() => stop, [stop]);

  return { speak, stop, unlock, speaking, error, ttsSupported: canSynthesize };
}
