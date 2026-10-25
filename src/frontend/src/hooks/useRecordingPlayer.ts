import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchRecordingUrl } from '../api/pronunciation';
import { translate } from '../i18n';

// One clip may play at a time across the whole page: scores hang under every
// message, so two open cards must be able to talk over each other.
let silence: (() => void) | null = null;

const clips = new Map<number, Promise<string>>();

function clipUrl(assetId: number): Promise<string> {
  const hit = clips.get(assetId);
  if (hit) return hit;
  const next = fetchRecordingUrl(assetId);
  clips.set(assetId, next);
  // A failed fetch must stay retryable (the file may still be on its way from disk).
  next.catch(() => clips.delete(assetId));
  return next;
}

export interface ClipState {
  loading: boolean;
  /** Identifies which control is currently sounding, e.g. `all` or a word key. */
  playing: string | null;
  error: string | null;
}

/**
 * Plays the learner's own take back, whole or per word.
 *
 * `from`/`to` come from the ASR word timestamps already stored with each score,
 * which is what turns the replay into a diagnostic tool: the learner hears the
 * exact moment a word went wrong instead of guessing from a number.
 */
export function useRecordingPlayer(assetId: number | null | undefined) {
  const [state, setState] = useState<ClipState>({ loading: false, playing: null, error: null });
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const stopAtRef = useRef<number | null>(null);
  const urlRef = useRef<string | null>(null);

  const stop = useCallback(() => {
    audioRef.current?.pause();
    stopAtRef.current = null;
    setState((prev) => ({ ...prev, playing: null }));
  }, []);

  const play = useCallback(
    async (key: string, from?: number | null, to?: number | null) => {
      if (!assetId) return;
      // Same clip, second click on the same control = stop.
      if (state.playing === key) {
        stop();
        return;
      }
      silence?.();
      silence = stop;
      setState((prev) => ({ ...prev, error: null }));
      try {
        if (!urlRef.current) {
          setState((prev) => ({ ...prev, loading: true }));
          urlRef.current = await clipUrl(assetId);
          setState((prev) => ({ ...prev, loading: false }));
        }
        const audio = audioRef.current ?? new Audio();
        audioRef.current = audio;
        if (audio.src !== urlRef.current) audio.src = urlRef.current;
        audio.ontimeupdate = () => {
          if (stopAtRef.current !== null && audio.currentTime >= stopAtRef.current) {
            stop();
          }
        };
        audio.onended = stop;
        audio.currentTime = Math.max(0, from ?? 0);
        stopAtRef.current = to != null ? to + 0.15 : null;
        setState((prev) => ({ ...prev, playing: key }));
        await audio.play();
      } catch (err) {
        setState({
          loading: false,
          playing: null,
          error: err instanceof Error ? err.message : translate('replay.failed'),
        });
      }
    },
    [assetId, state.playing, stop],
  );

  useEffect(
    () => () => {
      audioRef.current?.pause();
      audioRef.current = null;
      if (silence === stop) silence = null;
    },
    // `stop` is stable; re-subscribing on every render would unmount the element.
    [stop],
  );

  return { ...state, play, stop, hasClip: Boolean(assetId) };
}
