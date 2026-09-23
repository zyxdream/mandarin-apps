export const FINAL_REWARD_HOLD_MS = 1000;

export interface RewardArrivalSnapshot {
  targetCorrectCount: number;
  arrivedAtMs: number;
}

export function latestRewardArrival(
  previous: RewardArrivalSnapshot | null,
  arrival: RewardArrivalSnapshot,
): RewardArrivalSnapshot {
  return !previous || arrival.targetCorrectCount > previous.targetCorrectCount
    ? arrival
    : previous;
}

interface FinalRewardHoldInput {
  nowMs: number;
  finalCorrectCount: number;
  displayedCorrectCount: number;
  pendingRewardCount: number;
  lastRewardArrival: RewardArrivalSnapshot | null;
}

export type FinalRewardHoldDecision =
  | { status: 'waiting' }
  | { status: 'ready'; delayMs: number };

export function resolveFinalRewardHold({
  nowMs,
  finalCorrectCount,
  displayedCorrectCount,
  pendingRewardCount,
  lastRewardArrival,
}: FinalRewardHoldInput): FinalRewardHoldDecision {
  const normalizedFinalCount = Number.isFinite(finalCorrectCount)
    ? Math.max(0, Math.floor(finalCorrectCount))
    : 0;
  const normalizedDisplayedCount = Number.isFinite(displayedCorrectCount)
    ? Math.max(0, Math.floor(displayedCorrectCount))
    : 0;
  const normalizedPendingCount = Number.isFinite(pendingRewardCount)
    ? Math.max(0, Math.floor(pendingRewardCount))
    : 0;

  if (normalizedPendingCount > 0) {
    return { status: 'waiting' };
  }

  // A lagging counter with no remaining flight cannot settle by waiting. If the
  // final reward did arrive, its arrival timestamp still anchors the hold below.
  if (
    normalizedDisplayedCount < normalizedFinalCount &&
    lastRewardArrival?.targetCorrectCount !== normalizedFinalCount
  ) {
    return { status: 'ready', delayMs: 0 };
  }

  if (
    normalizedFinalCount === 0 ||
    !lastRewardArrival ||
    lastRewardArrival.targetCorrectCount !== normalizedFinalCount
  ) {
    return { status: 'ready', delayMs: 0 };
  }

  const safeNowMs = Number.isFinite(nowMs) ? nowMs : lastRewardArrival.arrivedAtMs;
  const safeArrivalMs = Number.isFinite(lastRewardArrival.arrivedAtMs)
    ? lastRewardArrival.arrivedAtMs
    : safeNowMs;
  const elapsedSinceArrivalMs = Math.max(0, safeNowMs - safeArrivalMs);

  return {
    status: 'ready',
    delayMs: Math.max(0, FINAL_REWARD_HOLD_MS - elapsedSinceArrivalMs),
  };
}

type TimerHandle = unknown;
type ScheduleTimeout = (callback: () => void, delayMs: number) => TimerHandle;
type CancelTimeout = (handle: TimerHandle) => void;

const defaultScheduleTimeout: ScheduleTimeout = (callback, delayMs) => (
  globalThis.setTimeout(callback, delayMs)
);
const defaultCancelTimeout: CancelTimeout = handle => {
  globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>);
};

export class OneShotTransitionTimer {
  private handle: TimerHandle | null = null;
  private hasFired = false;
  private readonly scheduleTimeout: ScheduleTimeout;
  private readonly cancelTimeout: CancelTimeout;

  constructor(
    schedule: ScheduleTimeout = defaultScheduleTimeout,
    cancel: CancelTimeout = defaultCancelTimeout,
  ) {
    this.scheduleTimeout = schedule;
    this.cancelTimeout = cancel;
  }

  arm(delayMs: number, callback: () => void): void {
    if (this.hasFired) return;
    this.cancelPending();

    const normalizedDelayMs = Number.isFinite(delayMs) ? Math.max(0, delayMs) : 0;
    if (normalizedDelayMs === 0) {
      this.hasFired = true;
      callback();
      return;
    }

    this.handle = this.scheduleTimeout(() => {
      this.handle = null;
      if (this.hasFired) return;
      this.hasFired = true;
      callback();
    }, normalizedDelayMs);
  }

  cancelPending(): void {
    if (this.handle === null) return;
    this.cancelTimeout(this.handle);
    this.handle = null;
  }
}
