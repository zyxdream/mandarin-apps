import type { MoleAnimState } from '../types/game.js';

export const HAMMER_REVEAL_DURATION_MS = 160;
export const HAMMER_SUCCESS_REVEAL_END_MS = 120;
export const HAMMER_SUCCESS_WINDUP_END_MS = 190;
export const HAMMER_SUCCESS_IMPACT_MS = 300;
export const HAMMER_SUCCESS_IMPACT_HOLD_END_MS = 350;
export const HAMMER_SUCCESS_RECOVERY_END_MS = 640;
export const HAMMER_SUCCESS_HIDE_MS = 780;

export interface SuccessHammerTimeline {
  revealProgress: number;
  windupProgress: number;
  strikeProgress: number;
  recoveryProgress: number;
  hasImpacted: boolean;
  impactActive: boolean;
  fadeProgress: number;
  visible: boolean;
}

export interface HammerActivationState {
  wordId: string | null;
  activated: boolean;
}

function isHammerActivationState(animState: MoleAnimState | null): boolean {
  return animState === 'hit' || animState === 'retry';
}

function progressBetween(elapsedMs: number, startMs: number, endMs: number): number {
  return Math.max(0, Math.min(1, (elapsedMs - startMs) / (endMs - startMs)));
}

export function advanceSuccessHammerElapsed(
  elapsedMs: number,
  deltaMs: number,
  isPaused: boolean,
): number {
  const elapsed = Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) : 0;
  const delta = Number.isFinite(deltaMs) ? Math.max(0, deltaMs) : 0;
  return isPaused ? elapsed : elapsed + delta;
}

/** One clock drives the reveal, swing, impact, recovery, and fade. */
export function getSuccessHammerTimeline(
  elapsedMs: number,
  reducedMotion = false,
): SuccessHammerTimeline {
  const elapsed = Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) : 0;
  const impactAt = reducedMotion ? 0 : HAMMER_SUCCESS_IMPACT_MS;

  return {
    revealProgress: reducedMotion
      ? 1
      : progressBetween(elapsed, 0, HAMMER_SUCCESS_REVEAL_END_MS),
    windupProgress: reducedMotion
      ? 0
      : progressBetween(elapsed, HAMMER_SUCCESS_REVEAL_END_MS, HAMMER_SUCCESS_WINDUP_END_MS),
    strikeProgress: reducedMotion
      ? 1
      : progressBetween(elapsed, HAMMER_SUCCESS_WINDUP_END_MS, HAMMER_SUCCESS_IMPACT_MS),
    recoveryProgress: reducedMotion
      ? 1
      : progressBetween(elapsed, HAMMER_SUCCESS_IMPACT_HOLD_END_MS, HAMMER_SUCCESS_RECOVERY_END_MS),
    hasImpacted: elapsed >= impactAt,
    impactActive: elapsed >= impactAt && elapsed < HAMMER_SUCCESS_IMPACT_HOLD_END_MS,
    fadeProgress: progressBetween(elapsed, HAMMER_SUCCESS_RECOVERY_END_MS, HAMMER_SUCCESS_HIDE_MS),
    visible: elapsed < HAMMER_SUCCESS_HIDE_MS,
  };
}

export function shouldEmitHammerImpact(
  strikeId: number,
  lastEmittedStrikeId: number | null,
  hasImpacted: boolean,
  isPaused: boolean,
): boolean {
  return Number.isFinite(strikeId) && strikeId > 0 &&
    strikeId !== lastEmittedStrikeId && hasImpacted && !isPaused;
}

export function acknowledgeHammerImpact(
  strikeId: number,
  lastEmittedStrikeId: number | null,
  hasImpacted: boolean,
  isPaused: boolean,
  playImpact: (strikeId: number) => boolean,
): number | null {
  if (!shouldEmitHammerImpact(strikeId, lastEmittedStrikeId, hasImpacted, isPaused)) {
    return lastEmittedStrikeId;
  }
  return playImpact(strikeId) ? strikeId : lastEmittedStrikeId;
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
