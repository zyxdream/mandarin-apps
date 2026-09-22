export const REWARD_FLIGHT_LAUNCH_DELAY_MS = 640;
export const REWARD_FLIGHT_DURATION_MS = 340;
export const REWARD_FLIGHT_MIN_LAUNCH_INTERVAL_MS = 140;
export const REWARD_FLIGHT_LANDING_MS = REWARD_FLIGHT_LAUNCH_DELAY_MS + REWARD_FLIGHT_DURATION_MS;

export type RewardFlightPhase = 'waiting' | 'flying' | 'landed';

export interface RewardFlightPoint {
  x: number;
  y: number;
}

export interface RewardFlightPath {
  start: RewardFlightPoint;
  control: RewardFlightPoint;
  end: RewardFlightPoint;
}

export interface RewardFlightTargetRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function scheduleRewardFlightLaunch(
  nowMs: number,
  lastLaunchAtMs: number | null,
): { launchAtMs: number; delayMs: number } {
  const safeNow = Number.isFinite(nowMs) ? nowMs : 0;
  const desiredLaunchAt = safeNow + REWARD_FLIGHT_LAUNCH_DELAY_MS;
  const launchAtMs = lastLaunchAtMs === null || !Number.isFinite(lastLaunchAtMs)
    ? desiredLaunchAt
    : Math.max(desiredLaunchAt, lastLaunchAtMs + REWARD_FLIGHT_MIN_LAUNCH_INTERVAL_MS);

  return {
    launchAtMs,
    delayMs: Math.max(0, launchAtMs - safeNow),
  };
}

export function advanceRewardFlightElapsed(
  elapsedMs: number,
  deltaMs: number,
  isPaused: boolean,
): number {
  const safeElapsed = Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) : 0;
  if (isPaused) return safeElapsed;
  const safeDelta = Number.isFinite(deltaMs) ? Math.max(0, deltaMs) : 0;
  return safeElapsed + safeDelta;
}

export function getRewardFlightPhase(
  elapsedMs: number,
  launchDelayMs: number,
  durationMs = REWARD_FLIGHT_DURATION_MS,
): RewardFlightPhase {
  const safeElapsed = Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) : 0;
  const safeDelay = Number.isFinite(launchDelayMs) ? Math.max(0, launchDelayMs) : 0;
  const safeDuration = Number.isFinite(durationMs) ? Math.max(0, durationMs) : 0;
  if (safeElapsed < safeDelay) return 'waiting';
  if (safeElapsed < safeDelay + safeDuration) return 'flying';
  return 'landed';
}

export function getRewardFlightProgress(
  elapsedMs: number,
  launchDelayMs: number,
  durationMs = REWARD_FLIGHT_DURATION_MS,
): number {
  const safeDuration = Number.isFinite(durationMs) ? Math.max(1, durationMs) : 1;
  const progress = (elapsedMs - Math.max(0, launchDelayMs)) / safeDuration;
  return Math.max(0, Math.min(1, progress));
}

export function resolveRewardFlightTarget(
  rect: RewardFlightTargetRect | null | undefined,
): RewardFlightPoint | null {
  if (!rect) return null;
  const values = [rect.left, rect.top, rect.width, rect.height];
  if (!values.every(Number.isFinite) || rect.width <= 0 || rect.height <= 0) return null;
  return {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
  };
}

export function createRewardFlightPath(
  start: RewardFlightPoint,
  end: RewardFlightPoint,
): RewardFlightPath {
  const distance = Math.hypot(end.x - start.x, end.y - start.y);
  const lift = Math.max(70, Math.min(150, distance * 0.24));
  return {
    start,
    control: {
      x: start.x + (end.x - start.x) * 0.48,
      y: Math.min(start.y, end.y) - lift,
    },
    end,
  };
}

export function pointOnRewardFlightPath(
  path: RewardFlightPath,
  progress: number,
): RewardFlightPoint {
  const t = Math.max(0, Math.min(1, progress));
  const inverse = 1 - t;
  return {
    x: inverse * inverse * path.start.x + 2 * inverse * t * path.control.x + t * t * path.end.x,
    y: inverse * inverse * path.start.y + 2 * inverse * t * path.control.y + t * t * path.end.y,
  };
}

export function headingOnRewardFlightPath(
  path: RewardFlightPath,
  progress: number,
): number {
  const t = Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 0));
  const inverse = 1 - t;
  let dx = 2 * inverse * (path.control.x - path.start.x) + 2 * t * (path.end.x - path.control.x);
  let dy = 2 * inverse * (path.control.y - path.start.y) + 2 * t * (path.end.y - path.control.y);

  if (!Number.isFinite(dx) || !Number.isFinite(dy) || Math.hypot(dx, dy) < 0.0001) {
    dx = path.end.x - path.start.x;
    dy = path.end.y - path.start.y;
  }
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || Math.hypot(dx, dy) < 0.0001) {
    return 0;
  }

  const heading = Math.atan2(dy, dx) * (180 / Math.PI);
  return Number.isFinite(heading) ? heading : 0;
}

export function claimRewardFlightSettlement(settledIds: Set<number>, id: number): boolean {
  if (settledIds.has(id)) return false;
  settledIds.add(id);
  return true;
}

export function advanceDisplayedCorrectCount(currentCount: number, arrivedCount: number): number {
  const safeCurrent = Number.isFinite(currentCount) ? Math.max(0, Math.floor(currentCount)) : 0;
  const safeArrived = Number.isFinite(arrivedCount) ? Math.max(0, Math.floor(arrivedCount)) : 0;
  return Math.max(safeCurrent, safeArrived);
}
