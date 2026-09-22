import test from 'node:test';
import assert from 'node:assert/strict';
import { canPlayRewardArrival } from '../src/audio/rewardAudio.js';

test('collection sound is allowed only for an active unpaused game', () => {
  assert.equal(canPlayRewardArrival(true, { screen: 'game', isPaused: false }), true);
  assert.equal(canPlayRewardArrival(true, { screen: 'game', isPaused: true }), false);
  assert.equal(canPlayRewardArrival(false, { screen: 'game', isPaused: false }), false);
  assert.equal(canPlayRewardArrival(true, { screen: 'result', isPaused: false }), false);
  assert.equal(canPlayRewardArrival(true, null), false);
});
