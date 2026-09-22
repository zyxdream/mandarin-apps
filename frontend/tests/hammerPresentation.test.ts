import assert from 'node:assert/strict';
import test from 'node:test';
import {
  advanceHammerRevealElapsed,
  getHammerRevealProgress,
  HAMMER_REVEAL_DURATION_MS,
  resolveHammerActivation,
  type HammerActivationState,
} from '../src/engine/hammerPresentation.js';

const inactive: HammerActivationState = { wordId: null, activated: false };

test('a new word stays inactive until pronunciation checking begins', () => {
  const emerging = resolveHammerActivation(inactive, 'word-1', 'emerging');
  assert.deepEqual(emerging, { wordId: 'word-1', activated: false });

  const active = resolveHammerActivation(emerging, 'word-1', 'active');
  assert.equal(active, emerging);

  assert.deepEqual(resolveHammerActivation(active, 'word-1', 'listening'), {
    wordId: 'word-1',
    activated: true,
  });
});

test('activation persists through every later state for the same word', () => {
  const activated = resolveHammerActivation(inactive, 'word-1', 'listening');

  for (const animState of ['hit', 'retry', 'active', 'escaping'] as const) {
    assert.equal(resolveHammerActivation(activated, 'word-1', animState), activated);
  }
});

test('a new word or missing mole resets activation', () => {
  const activated = resolveHammerActivation(inactive, 'word-1', 'listening');

  assert.deepEqual(resolveHammerActivation(activated, 'word-2', 'active'), {
    wordId: 'word-2',
    activated: false,
  });
  assert.deepEqual(resolveHammerActivation(activated, null, null), inactive);
});

test('an emerging mole resets activation even when the word id is reused', () => {
  const activated = resolveHammerActivation(inactive, 'word-1', 'listening');
  assert.deepEqual(resolveHammerActivation(activated, 'word-1', 'emerging'), {
    wordId: 'word-1',
    activated: false,
  });
  assert.deepEqual(resolveHammerActivation(activated, 'word-1', 'hidden'), {
    wordId: 'word-1',
    activated: false,
  });
});

test('a new word can activate immediately if checking has already begun', () => {
  assert.deepEqual(resolveHammerActivation(inactive, 'word-1', 'listening'), {
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
