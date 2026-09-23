import { useCallback, useEffect, useRef } from 'react';
import type { GameState } from '../types/game';
import { GAME_AUDIO, HINT_VOICE_AUDIO_BY_TEXT } from '../audio/gameAudioCatalog';
import type { HintVoiceAudioClip } from '../audio/gameAudioCatalog';
import { syncGameBgmPlayback, type GameBgmPlaybackMode } from '../audio/bgmPlayback';
import { canPlayRewardArrival } from '../audio/rewardAudio';
import { formatTeachingHint } from '../engine/hintTextFormat';

type SfxKey = keyof typeof GAME_AUDIO.sfx;

const BGM_FADE_MS = 120;
const HINT_VOICE_DELAY_MS = 360;

function clampVolume(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function getTargetBgmVolume(state: GameState | null, isSpeechDucking: boolean): number {
  if (!state) return GAME_AUDIO.volume.bgmBase;
  if (isSpeechDucking) return GAME_AUDIO.volume.bgmSpeaking;

  const animState = state.activeMole?.animState;
  if (state.isEvaluating || animState === 'listening') {
    return GAME_AUDIO.volume.bgmEvaluating;
  }
  if (animState === 'emerging' || animState === 'active') {
    return GAME_AUDIO.volume.bgmGuard;
  }
  return GAME_AUDIO.volume.bgmBase;
}

export function useGameAudio(gameState: GameState | null, enabled: boolean) {
  const bgmRef = useRef<HTMLAudioElement | null>(null);
  const bgmFadeRafRef = useRef<number | null>(null);
  const sfxTemplatesRef = useRef<Record<string, HTMLAudioElement>>({});
  const hintVoiceDelayRef = useRef<number | null>(null);
  const activeHintVoiceRef = useRef<HTMLAudioElement | null>(null);
  const speechDuckingRef = useRef(false);
  const enabledRef = useRef(enabled);
  const gameStateRef = useRef<GameState | null>(gameState);

  const lastAnimStateRef = useRef<string | null>(null);
  const lastHitCountRef = useRef(0);
  const lastHammerImpactStrikeIdRef = useRef<number | null>(null);
  const lastHintVoiceSourceRef = useRef<GameState['lastHint'] | null>(null);
  const baselineBgmVolume = getTargetBgmVolume(gameState, false);
  const bgmPlaybackMode: GameBgmPlaybackMode = !enabled
    ? 'disabled'
    : gameState?.isPaused
      ? 'paused'
      : 'playing';

  const clearDelayedAudio = useCallback(() => {
    if (hintVoiceDelayRef.current !== null) {
      window.clearTimeout(hintVoiceDelayRef.current);
      hintVoiceDelayRef.current = null;
    }
  }, []);

  const stopActiveHintVoice = useCallback(() => {
    const activeHintVoice = activeHintVoiceRef.current;
    if (!activeHintVoice) return;

    activeHintVoice.pause();
    activeHintVoice.currentTime = 0;
    activeHintVoiceRef.current = null;
  }, []);

  const cancelBgmFade = useCallback(() => {
    if (bgmFadeRafRef.current !== null) {
      cancelAnimationFrame(bgmFadeRafRef.current);
      bgmFadeRafRef.current = null;
    }
  }, []);

  const ensureBgm = useCallback(() => {
    if (!bgmRef.current) {
      const bgm = new Audio(GAME_AUDIO.bgm);
      bgm.loop = true;
      bgm.preload = 'auto';
      bgm.volume = 0;
      bgmRef.current = bgm;
    }
    return bgmRef.current;
  }, []);

  const ensureAudioTemplate = useCallback((url: string) => {
    let template = sfxTemplatesRef.current[url];
    if (!template) {
      template = new Audio(url);
      template.preload = 'auto';
      sfxTemplatesRef.current[url] = template;
    }
    return template;
  }, []);

  const fadeBgmTo = useCallback((targetVolume: number) => {
    const bgm = bgmRef.current;
    if (!bgm) return;

    const to = clampVolume(targetVolume);
    const from = clampVolume(bgm.volume);
    if (Math.abs(from - to) < 0.001) {
      bgm.volume = to;
      return;
    }

    cancelBgmFade();

    const startedAt = performance.now();
    const tick = (now: number) => {
      const progress = Math.max(0, Math.min(1, (now - startedAt) / BGM_FADE_MS));
      bgm.volume = clampVolume(from + (to - from) * progress);
      if (progress < 1) {
        bgmFadeRafRef.current = requestAnimationFrame(tick);
      } else {
        bgmFadeRafRef.current = null;
      }
    };

    bgmFadeRafRef.current = requestAnimationFrame(tick);
  }, [cancelBgmFade]);

  const updateSpeechDucking = useCallback((shouldDuck: boolean) => {
    if (speechDuckingRef.current === shouldDuck) return;

    speechDuckingRef.current = shouldDuck;
    if (!enabledRef.current || gameStateRef.current?.isPaused) return;

    fadeBgmTo(getTargetBgmVolume(gameStateRef.current, shouldDuck));
  }, [fadeBgmTo]);

  const playAudioUrl = useCallback((
    url: string,
    volume: number,
    label: string,
    playbackRate = 1,
  ) => {
    const template = ensureAudioTemplate(url);
    const instance = template.cloneNode(true) as HTMLAudioElement;
    instance.volume = volume;
    instance.playbackRate = playbackRate;
    instance.preservesPitch = true;
    void instance.play().catch(error => {
      console.warn('[audio] play failed', { label, error });
    });
    return instance;
  }, [ensureAudioTemplate]);

  const playSfx = useCallback((key: SfxKey) => {
    playAudioUrl(GAME_AUDIO.sfx[key], GAME_AUDIO.volume.sfx, `sfx:${key}`);
  }, [playAudioUrl]);

  const playRewardArrival = useCallback(() => {
    const currentState = gameStateRef.current;
    if (!canPlayRewardArrival(enabledRef.current, currentState)) return;
    playSfx('collect');
  }, [playSfx]);

  const playHammerImpact = useCallback((strikeId: number) => {
    if (!enabledRef.current || gameStateRef.current?.isPaused) return false;
    if (lastHammerImpactStrikeIdRef.current === strikeId) return true;
    lastHammerImpactStrikeIdRef.current = strikeId;
    playSfx('whack');
    return true;
  }, [playSfx]);

  const playHintVoice = useCallback((clip: HintVoiceAudioClip) => {
    stopActiveHintVoice();

    const instance = playAudioUrl(
      clip.url,
      GAME_AUDIO.volume.hintVoice,
      `hint-voice:${clip.id}`,
      clip.playbackRate,
    );
    activeHintVoiceRef.current = instance;
    const clearActiveHintVoice = () => {
      if (activeHintVoiceRef.current === instance) {
        activeHintVoiceRef.current = null;
      }
    };
    instance.addEventListener('ended', clearActiveHintVoice, { once: true });
    instance.addEventListener('error', clearActiveHintVoice, { once: true });
  }, [playAudioUrl, stopActiveHintVoice]);

  const scheduleHintVoice = useCallback((hint: GameState['lastHint']) => {
    if (!hint) return;

    const visibleHintText = formatTeachingHint(hint);
    const clip = HINT_VOICE_AUDIO_BY_TEXT[visibleHintText];
    if (!clip) return;

    if (hintVoiceDelayRef.current !== null) {
      window.clearTimeout(hintVoiceDelayRef.current);
      hintVoiceDelayRef.current = null;
    }
    stopActiveHintVoice();
    hintVoiceDelayRef.current = window.setTimeout(() => {
      hintVoiceDelayRef.current = null;
      playHintVoice(clip);
    }, HINT_VOICE_DELAY_MS);
  }, [playHintVoice, stopActiveHintVoice]);

  useEffect(() => {
    enabledRef.current = enabled;
    gameStateRef.current = gameState;
  }, [enabled, gameState]);

  useEffect(() => {
    if (bgmPlaybackMode === 'disabled') {
      speechDuckingRef.current = false;
      cancelBgmFade();
      clearDelayedAudio();
      stopActiveHintVoice();
      const bgm = bgmRef.current;
      if (bgm) {
        syncGameBgmPlayback(bgm, 'disabled');
      }
      return;
    }

    const bgm = ensureBgm();
    if (bgmPlaybackMode === 'paused') {
      cancelBgmFade();
      syncGameBgmPlayback(bgm, 'paused');
      return;
    }

    syncGameBgmPlayback(bgm, 'playing', error => {
      console.warn('[audio] bgm play blocked', error);
    });
    fadeBgmTo(speechDuckingRef.current ? GAME_AUDIO.volume.bgmSpeaking : baselineBgmVolume);
  }, [
    bgmPlaybackMode,
    baselineBgmVolume,
    cancelBgmFade,
    clearDelayedAudio,
    ensureBgm,
    fadeBgmTo,
    stopActiveHintVoice,
  ]);

  useEffect(() => {
    if (!enabled) return;

    const urls = new Set([
      ...Object.values(GAME_AUDIO.sfx),
      ...GAME_AUDIO.hintVoice.map(clip => clip.url),
    ]);
    urls.forEach(url => ensureAudioTemplate(url));
  }, [enabled, ensureAudioTemplate]);

  useEffect(() => {
    if (!gameState) return;

    const animState = gameState.activeMole?.animState ?? null;
    const hitCount = gameState.wordsHit.length;
    const currentHint = gameState.lastHint;

    if (!enabled) {
      lastAnimStateRef.current = animState;
      lastHitCountRef.current = hitCount;
      lastHintVoiceSourceRef.current = currentHint;
      return;
    }

    if (
      (animState === 'retry' || animState === 'escaping') &&
      lastAnimStateRef.current !== animState
    ) {
      playSfx('miss');
    }
    lastAnimStateRef.current = animState;

    if (hitCount > lastHitCountRef.current) {
      playSfx('success');
      clearDelayedAudio();
      stopActiveHintVoice();
    }
    lastHitCountRef.current = hitCount;

    if (!currentHint) {
      lastHintVoiceSourceRef.current = null;
      if (hintVoiceDelayRef.current !== null) {
        window.clearTimeout(hintVoiceDelayRef.current);
        hintVoiceDelayRef.current = null;
      }
      return;
    }

    if (!gameState.isEvaluating && currentHint !== lastHintVoiceSourceRef.current) {
      lastHintVoiceSourceRef.current = currentHint;
      scheduleHintVoice(currentHint);
    }
  }, [
    enabled,
    gameState?.activeMole?.animState,
    gameState?.wordsHit.length,
    gameState?.combo,
    gameState,
    clearDelayedAudio,
    playSfx,
    scheduleHintVoice,
    stopActiveHintVoice,
  ]);

  useEffect(() => () => {
    cancelBgmFade();
    clearDelayedAudio();
    stopActiveHintVoice();

    const bgm = bgmRef.current;
    if (bgm) {
      bgm.pause();
      bgm.currentTime = 0;
      bgm.volume = 0;
    }
    bgmRef.current = null;
    sfxTemplatesRef.current = {};
  }, [cancelBgmFade, clearDelayedAudio, stopActiveHintVoice]);

  return { updateSpeechDucking, playRewardArrival, playHammerImpact };
}
