import type { MoleAnimState } from '../types/game.js';

export const HAMMER_REVEAL_DURATION_MS = 160;

export interface HammerActivationState {
  wordId: string | null;
  activated: boolean;
}

function isHammerActivationState(animState: MoleAnimState | null): boolean {
  return animState === 'listening' || animState === 'hit' || animState === 'retry';
}

export function resolveHammerActivation(
  current: HammerActivationState,
  wordId: string | null,
  animState: MoleAnimState | null,
): HammerActivationState {
  if (!wordId) {
    return { wordId: null, activated: false };
  }

  if (animState === 'emerging' || animState === 'hidden') {
    return { wordId, activated: false };
  }

  if (current.wordId !== wordId) {
    return {
      wordId,
      activated: isHammerActivationState(animState),
    };
  }

  if (current.activated || !isHammerActivationState(animState)) {
    return current;
  }

  return { wordId, activated: true };
}

export function advanceHammerRevealElapsed(
  elapsedMs: number,
  deltaMs: number,
  activated: boolean,
): number {
  if (!activated) return 0;

  const safeElapsed = Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) : 0;
  const safeDelta = Number.isFinite(deltaMs) ? Math.max(0, deltaMs) : 0;
  return Math.min(HAMMER_REVEAL_DURATION_MS, safeElapsed + safeDelta);
}

export function getHammerRevealProgress(elapsedMs: number): number {
  if (!Number.isFinite(elapsedMs)) return 0;
  return Math.max(0, Math.min(1, elapsedMs / HAMMER_REVEAL_DURATION_MS));
}
