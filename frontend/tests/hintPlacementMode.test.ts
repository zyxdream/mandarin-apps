import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPedagogyHintClassName,
  resolveHintPlacementMode,
} from '../src/engine/hintPlacementMode.js';

test('incorrect hint mode wins over stale baozi-linked placement', () => {
  const mode = resolveHintPlacementMode({
    hasIncorrectPlacement: true,
    hasBaoziLinkedPlacement: true,
  });

  assert.equal(mode, 'incorrect_right_lane');
});

test('baozi linked mode is selected for success-linked flow when incorrect hint is absent', () => {
  const mode = resolveHintPlacementMode({
    hasIncorrectPlacement: false,
    hasBaoziLinkedPlacement: true,
  });

  assert.equal(mode, 'baozi_linked');
});

test('incorrect fallback path still resolves to incorrect mode', () => {
  const mode = resolveHintPlacementMode({
    hasIncorrectPlacement: true,
    hasBaoziLinkedPlacement: false,
  });

  assert.equal(mode, 'incorrect_right_lane');
});

test('default mode is selected when neither incorrect nor linked placement is available', () => {
  const mode = resolveHintPlacementMode({
    hasIncorrectPlacement: false,
    hasBaoziLinkedPlacement: false,
  });

  assert.equal(mode, 'default_mole_anchor');
});

test('class mapping never combines linked and incorrect classes', () => {
  const incorrectClass = buildPedagogyHintClassName('incorrect_right_lane');
  assert.match(incorrectClass, /\bhint-overlay--incorrect\b/);
  assert.doesNotMatch(incorrectClass, /\bhint-overlay--linked\b/);

  const linkedClass = buildPedagogyHintClassName('baozi_linked');
  assert.match(linkedClass, /\bhint-overlay--linked\b/);
  assert.doesNotMatch(linkedClass, /\bhint-overlay--incorrect\b/);
});
