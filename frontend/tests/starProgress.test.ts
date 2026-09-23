import assert from 'node:assert/strict';
import test from 'node:test';
import { getEarnedStarCount } from '../src/engine/starProgress.js';

test('awards the third star at ninety percent for a ten-word session', () => {
  assert.equal(getEarnedStarCount(0, 10), 0);
  assert.equal(getEarnedStarCount(3, 10), 0);
  assert.equal(getEarnedStarCount(4, 10), 1);
  assert.equal(getEarnedStarCount(6, 10), 1);
  assert.equal(getEarnedStarCount(7, 10), 2);
  assert.equal(getEarnedStarCount(8, 10), 2);
  assert.equal(getEarnedStarCount(9, 10), 3);
  assert.equal(getEarnedStarCount(10, 10), 3);
});

test('rounds non-divisible session thresholds up', () => {
  assert.equal(getEarnedStarCount(1, 5), 0);
  assert.equal(getEarnedStarCount(2, 5), 1);
  assert.equal(getEarnedStarCount(3, 5), 1);
  assert.equal(getEarnedStarCount(4, 5), 2);
  assert.equal(getEarnedStarCount(5, 5), 3);
});

test('rounds the ninety-percent threshold up for longer sessions', () => {
  assert.equal(getEarnedStarCount(17, 20), 2);
  assert.equal(getEarnedStarCount(18, 20), 3);
});

test('handles zero, invalid, negative, and overflowing inputs', () => {
  assert.equal(getEarnedStarCount(0, 0), 0);
  assert.equal(getEarnedStarCount(4, -2), 0);
  assert.equal(getEarnedStarCount(Number.NaN, 6), 0);
  assert.equal(getEarnedStarCount(4, Number.POSITIVE_INFINITY), 0);
  assert.equal(getEarnedStarCount(-3, 6), 0);
  assert.equal(getEarnedStarCount(99, 6), 3);
});

test('handles one-word and two-word sessions', () => {
  assert.equal(getEarnedStarCount(0, 1), 0);
  assert.equal(getEarnedStarCount(1, 1), 3);
  assert.equal(getEarnedStarCount(1, 2), 1);
  assert.equal(getEarnedStarCount(2, 2), 3);
});
