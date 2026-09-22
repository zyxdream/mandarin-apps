import test from 'node:test';
import assert from 'node:assert/strict';
import {
  advanceDisplayedCorrectCount,
  advanceRewardFlightElapsed,
  claimRewardFlightSettlement,
  createRewardFlightPath,
  getRewardFlightPhase,
  getRewardFlightProgress,
  headingOnRewardFlightPath,
  pointOnRewardFlightPath,
  REWARD_FLIGHT_DURATION_MS,
  REWARD_FLIGHT_LANDING_MS,
  REWARD_FLIGHT_LAUNCH_DELAY_MS,
  REWARD_FLIGHT_MIN_LAUNCH_INTERVAL_MS,
  resolveRewardFlightTarget,
  scheduleRewardFlightLaunch,
} from '../src/engine/rewardFlight.js';

test('reward flight launches near the end of the unchanged popup timing', () => {
  const scheduled = scheduleRewardFlightLaunch(1_000, null);
  assert.equal(scheduled.delayMs, REWARD_FLIGHT_LAUNCH_DELAY_MS);
  assert.equal(scheduled.launchAtMs, 1_000 + REWARD_FLIGHT_LAUNCH_DELAY_MS);
  assert.equal(REWARD_FLIGHT_DURATION_MS, 340);
  assert.equal(REWARD_FLIGHT_LANDING_MS, 980);
  assert.equal(
    REWARD_FLIGHT_LANDING_MS,
    REWARD_FLIGHT_LAUNCH_DELAY_MS + REWARD_FLIGHT_DURATION_MS,
  );
});

test('rapid reward flights keep a small launch gap without serializing the animations', () => {
  const first = scheduleRewardFlightLaunch(1_000, null);
  const second = scheduleRewardFlightLaunch(1_040, first.launchAtMs);

  assert.equal(second.launchAtMs - first.launchAtMs, REWARD_FLIGHT_MIN_LAUNCH_INTERVAL_MS);
  assert.equal(second.delayMs, 740);
});

test('a later reward still uses the normal launch delay', () => {
  const scheduled = scheduleRewardFlightLaunch(2_000, 1_200);
  assert.equal(scheduled.delayMs, REWARD_FLIGHT_LAUNCH_DELAY_MS);
});

test('pause freezes pending and active reward-flight time', () => {
  assert.equal(advanceRewardFlightElapsed(320, 500, true), 320);
  assert.equal(advanceRewardFlightElapsed(320, 20, false), 340);
});

test('flight phases and progress meet at the launch and landing boundaries', () => {
  const delay = REWARD_FLIGHT_LAUNCH_DELAY_MS;
  assert.equal(getRewardFlightPhase(delay - 1, delay), 'waiting');
  assert.equal(getRewardFlightPhase(delay, delay), 'flying');
  assert.equal(getRewardFlightPhase(delay + REWARD_FLIGHT_DURATION_MS - 1, delay), 'flying');
  assert.equal(getRewardFlightPhase(delay + REWARD_FLIGHT_DURATION_MS, delay), 'landed');
  assert.equal(getRewardFlightProgress(delay, delay), 0);
  assert.equal(getRewardFlightProgress(delay + REWARD_FLIGHT_DURATION_MS, delay), 1);
});

test('flight target uses the measured center and rejects unavailable geometry', () => {
  assert.deepEqual(resolveRewardFlightTarget({ left: 20, top: 30, width: 40, height: 60 }), {
    x: 40,
    y: 60,
  });
  assert.equal(resolveRewardFlightTarget(null), null);
  assert.equal(resolveRewardFlightTarget({ left: 0, top: 0, width: 0, height: 10 }), null);
});

test('curved flight starts and ends exactly at its anchors', () => {
  const path = createRewardFlightPath({ x: 400, y: 500 }, { x: 200, y: 80 });
  assert.deepEqual(pointOnRewardFlightPath(path, 0), { x: 400, y: 500 });
  assert.deepEqual(pointOnRewardFlightPath(path, 1), { x: 200, y: 80 });

  const midpoint = pointOnRewardFlightPath(path, 0.5);
  const linearMidpointY = (500 + 80) / 2;
  assert.ok(midpoint.y < linearMidpointY);
});

test('flight heading follows the quadratic curve from either direction', () => {
  const leftToRight = {
    start: { x: 0, y: 40 },
    control: { x: 50, y: 0 },
    end: { x: 100, y: 40 },
  };
  const rightToLeft = {
    start: { x: 100, y: 40 },
    control: { x: 50, y: 0 },
    end: { x: 0, y: 40 },
  };

  assert.ok(headingOnRewardFlightPath(leftToRight, 0) < 0);
  assert.ok(headingOnRewardFlightPath(leftToRight, 1) > 0);
  assert.ok(Math.abs(headingOnRewardFlightPath(leftToRight, 0.5)) < 0.0001);
  assert.ok(headingOnRewardFlightPath(rightToLeft, 0) < -90);
  assert.ok(headingOnRewardFlightPath(rightToLeft, 1) > 90);
});

test('flight heading remains finite for invalid progress and degenerate paths', () => {
  const point = { x: 12, y: 18 };
  const degenerate = { start: point, control: point, end: point };
  assert.equal(headingOnRewardFlightPath(degenerate, 0.5), 0);
  assert.equal(headingOnRewardFlightPath(degenerate, Number.NaN), 0);
  assert.equal(Number.isFinite(headingOnRewardFlightPath(
    { start: { x: 0, y: 0 }, control: { x: 0, y: 0 }, end: { x: 20, y: 10 } },
    0,
  )), true);
});

test('each arrival can settle only once', () => {
  const settled = new Set<number>();
  assert.equal(claimRewardFlightSettlement(settled, 7), true);
  assert.equal(claimRewardFlightSettlement(settled, 7), false);
  assert.equal(claimRewardFlightSettlement(settled, 8), true);
});

test('visible count advances monotonically even if callbacks arrive out of order', () => {
  assert.equal(advanceDisplayedCorrectCount(2, 3), 3);
  assert.equal(advanceDisplayedCorrectCount(3, 2), 3);
  assert.equal(advanceDisplayedCorrectCount(Number.NaN, 1), 1);
});
