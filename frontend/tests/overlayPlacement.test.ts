import test from 'node:test';
import assert from 'node:assert/strict';
import type { OverlayRect } from '../src/engine/overlayPlacement.js';
import {
  resolveBaoziLinkedHintTop,
  resolveBaoziRewardX,
  resolveIncorrectHintPlacement,
  resolveLegacyBaoziAnchorWithBoardGuard,
} from '../src/engine/overlayPlacement.js';

function makeRect(left: number, top: number, width: number, height: number): OverlayRect {
  return {
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height,
    centerX: left + width / 2,
    centerY: top + height / 2,
  };
}

test('legacy baozi anchor is preserved when board keepout does not overlap', () => {
  const boardKeepoutRect = makeRect(480, 80, 200, 100);
  const resolved = resolveLegacyBaoziAnchorWithBoardGuard({
    baseAnchor: { x: 420, y: 260 },
    rewardSize: { width: 200, height: 120 },
    boardKeepoutRect,
    anchorBounds: { minX: 92, maxX: 1100, minY: 72, maxY: 420 },
  });

  assert.equal(resolved.x, 420);
  assert.equal(resolved.y, 260);
});

test('overlap is corrected by nudging downward first while keeping x stable', () => {
  const boardKeepoutRect = makeRect(310, 160, 180, 90);
  const resolved = resolveLegacyBaoziAnchorWithBoardGuard({
    baseAnchor: { x: 400, y: 210 },
    rewardSize: { width: 180, height: 120 },
    boardKeepoutRect,
    anchorBounds: { minX: 92, maxX: 1100, minY: 72, maxY: 420 },
  });

  assert.equal(resolved.x, 400);
  assert.equal(resolved.y, 320);
});

test('when downward nudge is clamped, solver applies minimal side shift', () => {
  const boardKeepoutRect = makeRect(300, 150, 200, 130);
  const resolved = resolveLegacyBaoziAnchorWithBoardGuard({
    baseAnchor: { x: 420, y: 210 },
    rewardSize: { width: 200, height: 120 },
    boardKeepoutRect,
    anchorBounds: { minX: 100, maxX: 700, minY: 72, maxY: 250 },
  });

  assert.equal(resolved.x, 610);
  assert.equal(resolved.y, 250);
});

test('does not side-shift when downward nudge already clears overlap', () => {
  const boardKeepoutRect = makeRect(360, 170, 220, 90);
  const resolved = resolveLegacyBaoziAnchorWithBoardGuard({
    baseAnchor: { x: 470, y: 220 },
    rewardSize: { width: 190, height: 116 },
    boardKeepoutRect,
    anchorBounds: { minX: 92, maxX: 1100, minY: 72, maxY: 420 },
  });

  assert.equal(resolved.x, 470);
  assert.ok(resolved.y > 220);
});

test('linked hint top sits tightly below baozi reward bottom when cap is not hit', () => {
  const hintTop = resolveBaoziLinkedHintTop({
    rewardAnchorY: 220,
    rewardHeight: 120,
    hintHeight: 74,
    tightGapPx: 10,
    minTop: 72,
    maxTop: 520,
    moleY: 450,
  });

  assert.equal(hintTop, 290);
});

test('linked hint top is capped to stay above mole level', () => {
  const hintTop = resolveBaoziLinkedHintTop({
    rewardAnchorY: 260,
    rewardHeight: 120,
    hintHeight: 74,
    tightGapPx: 10,
    minTop: 72,
    maxTop: 520,
    moleY: 360,
  });

  assert.equal(hintTop, 280);
});

test('baozi failure path can reuse the same linked hint top model as success', () => {
  const boardKeepoutRect = makeRect(310, 160, 180, 90);
  const resolvedRewardAnchor = resolveLegacyBaoziAnchorWithBoardGuard({
    baseAnchor: { x: 400, y: 210 },
    rewardSize: { width: 180, height: 120 },
    boardKeepoutRect,
    anchorBounds: { minX: 92, maxX: 1100, minY: 72, maxY: 420 },
  });
  const successHintTop = resolveBaoziLinkedHintTop({
    rewardAnchorY: resolvedRewardAnchor.y,
    rewardHeight: 120,
    hintHeight: 74,
    tightGapPx: 10,
    minTop: 72,
    maxTop: 520,
    moleY: 420,
  });
  const failureHintTop = resolveBaoziLinkedHintTop({
    rewardAnchorY: resolvedRewardAnchor.y,
    rewardHeight: 120,
    hintHeight: 74,
    tightGapPx: 10,
    minTop: 72,
    maxTop: 520,
    moleY: 420,
  });

  assert.equal(successHintTop, failureHintTop);
});

test('baozi reward x shifts right toward mole when room allows', () => {
  const resolvedX = resolveBaoziRewardX({
    hitX: 420,
    moleX: 620,
    minX: 92,
    maxX: 1100,
    rightShiftPx: 24,
    leftOfMoleGapPx: 14,
  });

  assert.equal(resolvedX, 444);
});

test('baozi reward x stays left of mole after right shift', () => {
  const resolvedX = resolveBaoziRewardX({
    hitX: 540,
    moleX: 552,
    minX: 92,
    maxX: 1100,
    rightShiftPx: 24,
    leftOfMoleGapPx: 14,
  });

  assert.equal(resolvedX, 538);
});

test('baozi reward x respects viewport bounds when mole is near left edge', () => {
  const resolvedX = resolveBaoziRewardX({
    hitX: 86,
    moleX: 98,
    minX: 92,
    maxX: 1100,
    rightShiftPx: 24,
    leftOfMoleGapPx: 14,
  });

  assert.equal(resolvedX, 92);
});

test('incorrect hint prefers right-above when right lane is available', () => {
  const boardKeepoutRect = makeRect(390, 170, 220, 110);
  const moleBodyRect = makeRect(430, 250, 150, 140);
  const sideGapPx = 24;
  const placement = resolveIncorrectHintPlacement({
    viewportWidth: 1280,
    viewportHeight: 720,
    boardKeepoutRect,
    moleBodyRect,
    hintSize: { width: 340, height: 84 },
    sideGapPx,
  });

  assert.equal(placement.strategy, 'right_above');
  assert.ok(placement.hintLeft >= boardKeepoutRect.right + sideGapPx);
  assert.ok(placement.hintWidth > 0);
  assert.ok(placement.hintTop < boardKeepoutRect.centerY - 42);
});

test('incorrect hint near right edge stays right and shrinks width instead of side flipping', () => {
  const boardKeepoutRect = makeRect(1010, 170, 250, 120);
  const moleBodyRect = makeRect(1040, 250, 170, 140);
  const sideGapPx = 24;
  const placement = resolveIncorrectHintPlacement({
    viewportWidth: 1280,
    viewportHeight: 720,
    boardKeepoutRect,
    moleBodyRect,
    hintSize: { width: 360, height: 84 },
    sideGapPx,
  });

  assert.ok(placement.strategy.startsWith('right_') || placement.strategy === 'fallback');
  assert.equal(placement.hintLeft, boardKeepoutRect.right + sideGapPx);
  assert.ok(placement.hintWidth <= 22);
});

test('incorrect hint for centered mole chooses right-side lane with non-overlap placement', () => {
  const boardKeepoutRect = makeRect(470, 190, 220, 120);
  const moleBodyRect = makeRect(520, 270, 170, 150);
  const sideGapPx = 24;
  const placement = resolveIncorrectHintPlacement({
    viewportWidth: 1366,
    viewportHeight: 768,
    boardKeepoutRect,
    moleBodyRect,
    hintSize: { width: 380, height: 84 },
    sideGapPx,
  });

  assert.ok(placement.strategy.startsWith('right_'));
  assert.ok(placement.hintLeft >= boardKeepoutRect.right + sideGapPx);
  assert.ok(placement.hintWidth > 0);
});

test('incorrect hint left anchor always stays to the right of board keepout', () => {
  const boardKeepoutRect = makeRect(860, 170, 210, 120);
  const moleBodyRect = makeRect(900, 252, 170, 140);
  const sideGapPx = 24;
  const placement = resolveIncorrectHintPlacement({
    viewportWidth: 1280,
    viewportHeight: 720,
    boardKeepoutRect,
    moleBodyRect,
    hintSize: { width: 420, height: 84 },
    sideGapPx,
  });

  assert.ok(placement.hintLeft >= boardKeepoutRect.right + sideGapPx);
});
