import assert from 'node:assert/strict';
import test from 'node:test';
import {
  acknowledgeHammerImpact,
  advanceHammerRevealElapsed,
  advanceSuccessHammerElapsed,
  getHammerRevealProgress,
  getSuccessHammerTimeline,
  HAMMER_REVEAL_DURATION_MS,
  HAMMER_SUCCESS_HIDE_MS,
  HAMMER_SUCCESS_IMPACT_MS,
  HAMMER_SUCCESS_RECOVERY_END_MS,
  HAMMER_SUCCESS_REVEAL_END_MS,
  HAMMER_SUCCESS_WINDUP_END_MS,
  resolveHammerActivation,
  shouldEmitHammerImpact,
  type HammerActivationState,
} from '../src/engine/hammerPresentation.js';

const inactive: HammerActivationState = { wordId: null, activated: false };

test('a new word stays inactive throughout pronunciation checking', () => {
  const emerging = resolveHammerActivation(inactive, 'word-1', 'emerging');
  assert.deepEqual(emerging, { wordId: 'word-1', activated: false });

  const active = resolveHammerActivation(emerging, 'word-1', 'active');
  assert.equal(active, emerging);

  assert.equal(resolveHammerActivation(active, 'word-1', 'listening'), active);
  assert.deepEqual(resolveHammerActivation(active, 'word-1', 'hit'), {
    wordId: 'word-1',
    activated: true,
  });
});

test('activation persists through retry, recovery, and a later result for the same word', () => {
  const activated = resolveHammerActivation(inactive, 'word-1', 'retry');

  for (const animState of ['active', 'listening', 'hit', 'escaping'] as const) {
    assert.equal(resolveHammerActivation(activated, 'word-1', animState), activated);
  }
});

test('a new word or missing mole resets activation', () => {
  const activated = resolveHammerActivation(inactive, 'word-1', 'hit');

  assert.deepEqual(resolveHammerActivation(activated, 'word-2', 'active'), {
    wordId: 'word-2',
    activated: false,
  });
  assert.deepEqual(resolveHammerActivation(activated, null, null), inactive);
});

test('an emerging mole resets activation even when the word id is reused', () => {
  const activated = resolveHammerActivation(inactive, 'word-1', 'retry');
  assert.deepEqual(resolveHammerActivation(activated, 'word-1', 'emerging'), {
    wordId: 'word-1',
    activated: false,
  });
  assert.deepEqual(resolveHammerActivation(activated, 'word-1', 'hidden'), {
    wordId: 'word-1',
    activated: false,
  });
});

test('a fast result can activate before checking is rendered', () => {
  assert.deepEqual(resolveHammerActivation(inactive, 'word-1', 'hit'), {
    wordId: 'word-1',
    activated: true,
  });
});

test('fast success or failure activates even if checking was not rendered', () => {
  for (const animState of ['hit', 'retry'] as const) {
    assert.deepEqual(resolveHammerActivation(inactive, 'word-1', animState), {
      wordId: 'word-1',
      activated: true,
    });
  }
});

test('an evaluator error that returns to active never activates an unseen hammer', () => {
  const checking = resolveHammerActivation(inactive, 'word-1', 'listening');
  assert.deepEqual(checking, { wordId: 'word-1', activated: false });
  assert.equal(resolveHammerActivation(checking, 'word-1', 'active'), checking);
});

test('success timeline reveals, winds up, impacts, recovers, and hides in order', () => {
  const start = getSuccessHammerTimeline(0);
  assert.equal(start.visible, true);
  assert.equal(start.revealProgress, 0);
  assert.equal(start.hasImpacted, false);

  const revealed = getSuccessHammerTimeline(HAMMER_SUCCESS_REVEAL_END_MS);
  assert.equal(revealed.revealProgress, 1);
  assert.equal(revealed.windupProgress, 0);

  const wound = getSuccessHammerTimeline(HAMMER_SUCCESS_WINDUP_END_MS);
  assert.equal(wound.windupProgress, 1);
  assert.equal(wound.strikeProgress, 0);

  const beforeImpact = getSuccessHammerTimeline(HAMMER_SUCCESS_IMPACT_MS - 1);
  assert.equal(beforeImpact.hasImpacted, false);
  assert.ok(beforeImpact.strikeProgress < 1);

  const impact = getSuccessHammerTimeline(HAMMER_SUCCESS_IMPACT_MS);
  assert.equal(impact.hasImpacted, true);
  assert.equal(impact.impactActive, true);
  assert.equal(impact.strikeProgress, 1);

  const recovered = getSuccessHammerTimeline(HAMMER_SUCCESS_RECOVERY_END_MS);
  assert.equal(recovered.recoveryProgress, 1);
  assert.equal(recovered.fadeProgress, 0);

  const hidden = getSuccessHammerTimeline(HAMMER_SUCCESS_HIDE_MS);
  assert.equal(hidden.fadeProgress, 1);
  assert.equal(hidden.visible, false);
});

test('pause freezes the success clock and impact stays pending until resume', () => {
  let elapsed = advanceSuccessHammerElapsed(250, 200, true);
  assert.equal(elapsed, 250);
  assert.equal(getSuccessHammerTimeline(elapsed).hasImpacted, false);

  elapsed = advanceSuccessHammerElapsed(elapsed, 49, false);
  assert.equal(getSuccessHammerTimeline(elapsed).hasImpacted, false);
  elapsed = advanceSuccessHammerElapsed(elapsed, 1, false);
  assert.equal(elapsed, HAMMER_SUCCESS_IMPACT_MS);
  assert.equal(getSuccessHammerTimeline(elapsed).hasImpacted, true);
});

test('success timing is bounded for invalid or out-of-range elapsed values', () => {
  for (const elapsed of [Number.NaN, Number.POSITIVE_INFINITY, -100]) {
    assert.deepEqual(getSuccessHammerTimeline(elapsed), getSuccessHammerTimeline(0));
  }

  const late = getSuccessHammerTimeline(10_000);
  assert.equal(late.visible, false);
  assert.equal(late.hasImpacted, true);
  for (const key of ['revealProgress', 'windupProgress', 'strikeProgress', 'recoveryProgress', 'fadeProgress'] as const) {
    assert.ok(late[key] >= 0 && late[key] <= 1);
  }
});

test('reduced motion exposes an immediate impact without entrance or windup', () => {
  const start = getSuccessHammerTimeline(0, true);
  assert.equal(start.visible, true);
  assert.equal(start.revealProgress, 1);
  assert.equal(start.windupProgress, 0);
  assert.equal(start.strikeProgress, 1);
  assert.equal(start.recoveryProgress, 1);
  assert.equal(start.hasImpacted, true);
  assert.equal(start.impactActive, true);
});

test('impact event waits for the strike, defers through pause, and fires once', () => {
  assert.equal(shouldEmitHammerImpact(3, null, false, false), false);
  assert.equal(shouldEmitHammerImpact(3, null, true, true), false);
  assert.equal(shouldEmitHammerImpact(3, null, true, false), true);
  assert.equal(shouldEmitHammerImpact(3, 3, true, false), false);
  assert.equal(shouldEmitHammerImpact(4, 3, true, false), true);
  assert.equal(shouldEmitHammerImpact(0, null, true, false), false);
});

test('a paused audio callback can retry after resume without duplicating the whack', () => {
  const calls: number[] = [];
  let lastEmitted: number | null = null;
  const playImpact = (strikeId: number) => {
    calls.push(strikeId);
    return calls.length > 1;
  };

  lastEmitted = acknowledgeHammerImpact(3, lastEmitted, true, false, playImpact);
  assert.equal(lastEmitted, null);
  lastEmitted = acknowledgeHammerImpact(3, lastEmitted, true, false, playImpact);
  assert.equal(lastEmitted, 3);
  lastEmitted = acknowledgeHammerImpact(3, lastEmitted, true, false, playImpact);
  assert.equal(lastEmitted, 3);
  assert.deepEqual(calls, [3, 3]);
});

test('reveal progress reaches full visibility in 160 ms and stays bounded', () => {
  let elapsed = advanceHammerRevealElapsed(0, 80, true);
  assert.equal(elapsed, 80);
  assert.equal(getHammerRevealProgress(elapsed), 0.5);

  elapsed = advanceHammerRevealElapsed(elapsed, 100, true);
  assert.equal(elapsed, HAMMER_REVEAL_DURATION_MS);
  assert.equal(getHammerRevealProgress(elapsed), 1);
  assert.equal(advanceHammerRevealElapsed(elapsed, 100, true), HAMMER_REVEAL_DURATION_MS);
  assert.equal(getHammerRevealProgress(-20), 0);
  assert.equal(getHammerRevealProgress(Number.NaN), 0);
});

test('inactive and invalid reveal values reset safely', () => {
  assert.equal(advanceHammerRevealElapsed(80, 16, false), 0);
  assert.equal(advanceHammerRevealElapsed(Number.NaN, 16, true), 16);
  assert.equal(advanceHammerRevealElapsed(20, Number.NaN, true), 20);
});
