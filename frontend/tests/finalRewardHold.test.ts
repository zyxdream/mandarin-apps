import assert from 'node:assert/strict';
import test from 'node:test';
import {
  FINAL_REWARD_HOLD_MS,
  latestRewardArrival,
  OneShotTransitionTimer,
  resolveFinalRewardHold,
} from '../src/engine/finalRewardHold.js';

test('waits for the final reward flight and visible counter to settle', () => {
  assert.deepEqual(resolveFinalRewardHold({
    nowMs: 2000,
    finalCorrectCount: 10,
    displayedCorrectCount: 9,
    pendingRewardCount: 1,
    lastRewardArrival: null,
  }), { status: 'waiting' });

  assert.deepEqual(resolveFinalRewardHold({
    nowMs: 2000,
    finalCorrectCount: 10,
    displayedCorrectCount: 9,
    pendingRewardCount: 0,
    lastRewardArrival: null,
  }), { status: 'ready', delayMs: 0 });
});

test('does not hang when the visible counter trails with no flights left', () => {
  assert.deepEqual(resolveFinalRewardHold({
    nowMs: 2200,
    finalCorrectCount: 10,
    displayedCorrectCount: 9,
    pendingRewardCount: 0,
    lastRewardArrival: { targetCorrectCount: 9, arrivedAtMs: 1900 },
  }), { status: 'ready', delayMs: 0 });

  assert.deepEqual(resolveFinalRewardHold({
    nowMs: 2200,
    finalCorrectCount: 10,
    displayedCorrectCount: 9,
    pendingRewardCount: 0,
    lastRewardArrival: { targetCorrectCount: 10, arrivedAtMs: 2000 },
  }), { status: 'ready', delayMs: 800 });
});

test('a late older flight cannot replace the final arrival timestamp', () => {
  const finalArrival = { targetCorrectCount: 10, arrivedAtMs: 2000 };
  const retained = latestRewardArrival(
    finalArrival,
    { targetCorrectCount: 9, arrivedAtMs: 2200 },
  );
  assert.equal(retained, finalArrival);
  assert.deepEqual(resolveFinalRewardHold({
    nowMs: 2200,
    finalCorrectCount: 10,
    displayedCorrectCount: 10,
    pendingRewardCount: 0,
    lastRewardArrival: retained,
  }), { status: 'ready', delayMs: 800 });

  assert.deepEqual(latestRewardArrival(
    { targetCorrectCount: 9, arrivedAtMs: 1900 },
    finalArrival,
  ), finalArrival);
});

test('holds for one second beginning at the final reward arrival', () => {
  assert.deepEqual(resolveFinalRewardHold({
    nowMs: 2000,
    finalCorrectCount: 10,
    displayedCorrectCount: 10,
    pendingRewardCount: 0,
    lastRewardArrival: { targetCorrectCount: 10, arrivedAtMs: 2000 },
  }), { status: 'ready', delayMs: FINAL_REWARD_HOLD_MS });
});

test('uses only the remaining hold when the reward arrived before game over', () => {
  assert.deepEqual(resolveFinalRewardHold({
    nowMs: 2750,
    finalCorrectCount: 10,
    displayedCorrectCount: 10,
    pendingRewardCount: 0,
    lastRewardArrival: { targetCorrectCount: 10, arrivedAtMs: 2500 },
  }), { status: 'ready', delayMs: 750 });

  assert.deepEqual(resolveFinalRewardHold({
    nowMs: 4000,
    finalCorrectCount: 10,
    displayedCorrectCount: 10,
    pendingRewardCount: 0,
    lastRewardArrival: { targetCorrectCount: 10, arrivedAtMs: 2500 },
  }), { status: 'ready', delayMs: 0 });
});

test('does not delay endings without a matching final reward arrival', () => {
  assert.deepEqual(resolveFinalRewardHold({
    nowMs: 2000,
    finalCorrectCount: 8,
    displayedCorrectCount: 8,
    pendingRewardCount: 0,
    lastRewardArrival: null,
  }), { status: 'ready', delayMs: 0 });

  assert.deepEqual(resolveFinalRewardHold({
    nowMs: 2000,
    finalCorrectCount: 8,
    displayedCorrectCount: 8,
    pendingRewardCount: 0,
    lastRewardArrival: { targetCorrectCount: 7, arrivedAtMs: 1900 },
  }), { status: 'ready', delayMs: 0 });
});

test('one-shot transition timer fires once and cancellation prevents a stale callback', () => {
  let nextHandle = 1;
  const callbacks = new Map<number, () => void>();
  const cancelled: number[] = [];
  const timer = new OneShotTransitionTimer(
    callback => {
      const handle = nextHandle;
      nextHandle += 1;
      callbacks.set(handle, callback);
      return handle;
    },
    handle => {
      const numericHandle = handle as number;
      cancelled.push(numericHandle);
      callbacks.delete(numericHandle);
    },
  );
  let completionCount = 0;

  timer.arm(1000, () => {
    completionCount += 1;
  });
  timer.cancelPending();
  assert.deepEqual(cancelled, [1]);
  assert.equal(completionCount, 0);

  timer.arm(500, () => {
    completionCount += 1;
  });
  callbacks.get(2)?.();
  timer.arm(0, () => {
    completionCount += 1;
  });

  assert.equal(completionCount, 1);
});
