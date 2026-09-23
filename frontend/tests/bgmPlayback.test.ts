import test from 'node:test';
import assert from 'node:assert/strict';
import { syncGameBgmPlayback } from '../src/audio/bgmPlayback.js';

class FakeBgmAudio {
  private pausedState: boolean;
  currentTime: number;
  volume: number;
  pauseCalls = 0;
  playCalls = 0;

  constructor({ paused = false, currentTime = 0, volume = 0.14 } = {}) {
    this.pausedState = paused;
    this.currentTime = currentTime;
    this.volume = volume;
  }

  get paused(): boolean {
    return this.pausedState;
  }

  pause(): void {
    this.pauseCalls += 1;
    this.pausedState = true;
  }

  play(): Promise<void> {
    this.playCalls += 1;
    this.pausedState = false;
    return Promise.resolve();
  }
}

test('pausing BGM preserves playback position and volume', () => {
  const audio = new FakeBgmAudio({ currentTime: 42.5, volume: 0.04 });

  syncGameBgmPlayback(audio, 'paused');

  assert.equal(audio.paused, true);
  assert.equal(audio.pauseCalls, 1);
  assert.equal(audio.playCalls, 0);
  assert.equal(audio.currentTime, 42.5);
  assert.equal(audio.volume, 0.04);
});

test('resuming BGM immediately plays the same element from its preserved position', () => {
  const audio = new FakeBgmAudio({ paused: true, currentTime: 42.5, volume: 0.04 });

  syncGameBgmPlayback(audio, 'playing');

  assert.equal(audio.paused, false);
  assert.equal(audio.playCalls, 1);
  assert.equal(audio.currentTime, 42.5);
  assert.equal(audio.volume, 0.04);
});

test('updates while paused cannot restart BGM', () => {
  const audio = new FakeBgmAudio({ paused: true, currentTime: 18 });

  syncGameBgmPlayback(audio, 'paused');
  syncGameBgmPlayback(audio, 'paused');

  assert.equal(audio.playCalls, 0);
  assert.equal(audio.pauseCalls, 0);
  assert.equal(audio.currentTime, 18);
});

test('repeated pause and resume transitions are idempotent', () => {
  const audio = new FakeBgmAudio({ currentTime: 9 });

  syncGameBgmPlayback(audio, 'paused');
  syncGameBgmPlayback(audio, 'paused');
  syncGameBgmPlayback(audio, 'playing');
  syncGameBgmPlayback(audio, 'playing');

  assert.equal(audio.pauseCalls, 1);
  assert.equal(audio.playCalls, 1);
  assert.equal(audio.currentTime, 9);
});

test('disabling BGM preserves the existing leave-game reset behavior', () => {
  const audio = new FakeBgmAudio({ currentTime: 61, volume: 0.14 });

  syncGameBgmPlayback(audio, 'disabled');

  assert.equal(audio.paused, true);
  assert.equal(audio.currentTime, 0);
  assert.equal(audio.volume, 0);
});
