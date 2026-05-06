import test from 'node:test';
import assert from 'node:assert/strict';
import { computeGameplayLaneHeight } from '../src/engine/uiDockLayout.js';

test('gameplay lane shrinks as dock grows', () => {
  const smallDockLane = computeGameplayLaneHeight({
    viewportHeightPx: 900,
    dock: { dockHeightPx: 130, safeBottomPx: 0 },
  });
  const largeDockLane = computeGameplayLaneHeight({
    viewportHeightPx: 900,
    dock: { dockHeightPx: 250, safeBottomPx: 0 },
  });

  assert.ok(largeDockLane < smallDockLane);
  assert.equal(smallDockLane, 770);
  assert.equal(largeDockLane, 650);
});

test('gameplay lane respects safe area reserve', () => {
  const lane = computeGameplayLaneHeight({
    viewportHeightPx: 844,
    dock: { dockHeightPx: 168, safeBottomPx: 24 },
  });

  assert.equal(lane, 652);
});

test('gameplay lane enforces minimum height floor', () => {
  const lane = computeGameplayLaneHeight({
    viewportHeightPx: 300,
    dock: { dockHeightPx: 160, safeBottomPx: 20 },
    minGameplayHeightPx: 200,
  });

  assert.equal(lane, 200);
});
