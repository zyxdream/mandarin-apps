import { useCallback, useEffect, useRef } from 'react';
import type { GameState } from '../types/game';
import { GAME_AUDIO } from '../audio/gameAudioCatalog';

type SfxKey = keyof typeof GAME_AUDIO.sfx;

const BGM_FADE_MS = 120;
const COLLECT_SFX_DELAY_MS = 220;

function clampVolume(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function getTargetBgmVolume(state: GameState | null): number {
  if (!state) return GAME_AUDIO.volume.bgmBase;

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
  const collectDelayRef = useRef<number | null>(null);

  const lastAnimStateRef = useRef<string | null>(null);
  const lastHitCountRef = useRef(0);
  const targetBgmVolume = getTargetBgmVolume(gameState);

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

  const playSfx = useCallback((key: SfxKey) => {
    const url = GAME_AUDIO.sfx[key];
    let template = sfxTemplatesRef.current[url];
    if (!template) {
      template = new Audio(url);
      template.preload = 'auto';
      sfxTemplatesRef.current[url] = template;
    }

    const instance = template.cloneNode(true) as HTMLAudioElement;
    instance.volume = GAME_AUDIO.volume.sfx;
    void instance.play().catch(error => {
      console.warn('[audio] sfx play failed', { key, error });
    });
  }, []);

  useEffect(() => {
    if (!enabled) {
      cancelBgmFade();
      const bgm = bgmRef.current;
      if (bgm) {
        bgm.pause();
        bgm.currentTime = 0;
        bgm.volume = 0;
      }
      return;
    }

    const bgm = ensureBgm();
    void bgm.play().catch(error => {
      console.warn('[audio] bgm play blocked', error);
    });
  }, [enabled, cancelBgmFade, ensureBgm]);

  useEffect(() => {
    if (!enabled) return;

    const bgm = ensureBgm();
    if (bgm.paused) {
      void bgm.play().catch(() => {
        // Ignore. Autoplay policy can still block if browser decides there's no valid gesture.
      });
    }

    fadeBgmTo(targetBgmVolume);
  }, [enabled, targetBgmVolume, ensureBgm, fadeBgmTo]);

  useEffect(() => {
    if (!enabled || !gameState) return;

    const animState = gameState.activeMole?.animState ?? null;
    if (animState === 'hit' && lastAnimStateRef.current !== 'hit') {
      playSfx('whack');
    }
    if (
      (animState === 'retry' || animState === 'escaping') &&
      lastAnimStateRef.current !== animState
    ) {
      playSfx('miss');
    }
    lastAnimStateRef.current = animState;

    const hitCount = gameState.wordsHit.length;
    if (hitCount > lastHitCountRef.current) {
      playSfx('success');
      if (collectDelayRef.current !== null) {
        window.clearTimeout(collectDelayRef.current);
      }
      collectDelayRef.current = window.setTimeout(() => {
        collectDelayRef.current = null;
        playSfx('collect');
      }, COLLECT_SFX_DELAY_MS);
    }
    lastHitCountRef.current = hitCount;
  }, [enabled, gameState?.activeMole?.animState, gameState?.wordsHit.length, gameState?.combo, gameState, playSfx]);

  useEffect(() => () => {
    cancelBgmFade();
    if (collectDelayRef.current !== null) {
      window.clearTimeout(collectDelayRef.current);
      collectDelayRef.current = null;
    }

    const bgm = bgmRef.current;
    if (bgm) {
      bgm.pause();
      bgm.currentTime = 0;
      bgm.volume = 0;
    }
    bgmRef.current = null;
    sfxTemplatesRef.current = {};
  }, [cancelBgmFade]);
}
