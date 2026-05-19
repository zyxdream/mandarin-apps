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

test('deduplicates try-again style tip prefix and keeps concise body', () => {
  const output = formatTeachingHint({
    code: 'nice_try_again',
    text: 'Tip: Nice-try - again!',
    confidence: 0.31,
  });

  assert.equal(output, 'Nice-try - again!');
});

test('missing beat keeps concise label only', () => {
  const output = formatTeachingHint({
    code: 'missing_beat',
    text: 'Beats: say every beat',
    confidence: 0.18,
  });

  assert.equal(output, 'Missing beat');
});
