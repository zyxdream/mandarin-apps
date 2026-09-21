import test from 'node:test';
import assert from 'node:assert/strict';
import { formatTeachingHint } from '../src/engine/hintTextFormat.js';

test('keeps desired retroflex hint shape', () => {
  const output = formatTeachingHint({
    code: 'initial_curl',
    text: 'curl tongue',
    confidence: 0.25,
  });

  assert.equal(output, 'zh/ch/sh/r: curl tongue');
});

test('deduplicates generic retry tip prefix and keeps replacement bodies', () => {
  const cases = [
    ['Tip: Try again', 'Try again'],
    ['Tip: So close', 'So close'],
  ] as const;

  for (const [text, expected] of cases) {
    assert.equal(formatTeachingHint({
      code: 'nice_try_again',
      text,
      confidence: 0.31,
    }), expected);
  }
});

test('missing beat keeps concise label only', () => {
  const output = formatTeachingHint({
    code: 'missing_beat',
    text: 'Beats: say every beat',
    confidence: 0.18,
  });

  assert.equal(output, 'Missing beat');
});

test('keeps each supported positive feedback phrase unchanged', () => {
  for (const text of ['Amazing', '太棒了']) {
    assert.equal(formatTeachingHint({
      code: 'heard_correct',
      text,
      confidence: 0.95,
    }), text);
  }
});
