import test from 'node:test';
import assert from 'node:assert/strict';
import {
  HINT_VOICE_AUDIO_BY_TEXT,
  HINT_VOICE_AUDIO_CLIPS,
  pickPositiveFeedbackText,
} from '../src/audio/gameAudioCatalog.js';

test('positive feedback catalog contains only matching visible text and voice clips', () => {
  assert.deepEqual(HINT_VOICE_AUDIO_CLIPS, [
    {
      id: 'amazing',
      text: 'Amazing',
      url: '/audio/sound_effects/hint_voice/amazing-reference-24k-mono.wav',
      playbackRate: 1,
    },
    {
      id: 'taibangle',
      text: '太棒了',
      url: '/audio/sound_effects/hint_voice/taibangle.wav',
      playbackRate: 2,
    },
  ]);
  assert.equal(HINT_VOICE_AUDIO_BY_TEXT['Try again'], undefined);
  assert.equal(HINT_VOICE_AUDIO_BY_TEXT['So close'], undefined);
});

test('positive feedback selection gives each phrase half of the random range', () => {
  assert.equal(pickPositiveFeedbackText(0), 'Amazing');
  assert.equal(pickPositiveFeedbackText(0.499999), 'Amazing');
  assert.equal(pickPositiveFeedbackText(0.5), '太棒了');
  assert.equal(pickPositiveFeedbackText(0.999999), '太棒了');
});
