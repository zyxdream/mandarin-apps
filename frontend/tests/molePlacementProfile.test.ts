import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FEASTING_MOLE_PLACEMENT_PROFILE,
  GAMEPLAY_MOLE_PLACEMENT_PROFILE,
  resolveGameplaySlotPlacementOverride,
  resolveMoleAnchoredPosition,
  resolveMoleLeftOverhangPx,
} from '../src/engine/molePlacementProfile.js';

test('left overhang is clamped to profile min/max bounds', () => {
  const tiny = resolveMoleLeftOverhangPx(24, GAMEPLAY_MOLE_PLACEMENT_PROFILE);
  const wide = resolveMoleLeftOverhangPx(320, GAMEPLAY_MOLE_PLACEMENT_PROFILE);

  assert.equal(tiny, 2);
  assert.equal(wide, 6);
});

test('rendered body-left contact stays stable across animated scales', () => {
  const darkLeftX = 300;
  const openingWidth = 150;
  const baseBodyBottomY = 580;
  const bodyBBoxLeft = 220;
  const bodyBBoxBottom = 1004;
  const canvasWidth = 1254;
  const canvasHeight = 1254;

  const smallScale = resolveMoleAnchoredPosition({
    darkLeftX,
    baseBodyBottomY,
    openingWidth,
    canvasWidth,
    canvasHeight,
    bodyBBoxLeft,
    bodyBBoxBottom,
    renderScaleX: 0.25,
    renderScaleY: 0.25,
    profile: GAMEPLAY_MOLE_PLACEMENT_PROFILE,
  });

  const largeScale = resolveMoleAnchoredPosition({
    darkLeftX,
    baseBodyBottomY,
    openingWidth,
    canvasWidth,
    canvasHeight,
    bodyBBoxLeft,
    bodyBBoxBottom,
    renderScaleX: 0.38,
    renderScaleY: 0.38,
    profile: GAMEPLAY_MOLE_PLACEMENT_PROFILE,
  });

  const renderedLeftAtSmallScale = smallScale.x + (bodyBBoxLeft - canvasWidth / 2) * 0.25;
  const renderedLeftAtLargeScale = largeScale.x + (bodyBBoxLeft - canvasWidth / 2) * 0.38;

  assert.equal(renderedLeftAtSmallScale, renderedLeftAtLargeScale);
  assert.equal(renderedLeftAtSmallScale, darkLeftX - 4.5);
});

test('gameplay slot overrides apply strict rightmost-size matching for slots 0-4', () => {
  const slotZero = resolveGameplaySlotPlacementOverride(0);
  const slotOne = resolveGameplaySlotPlacementOverride(1);
  const slotTwo = resolveGameplaySlotPlacementOverride(2);
  const slotThree = resolveGameplaySlotPlacementOverride(3);
  const slotFour = resolveGameplaySlotPlacementOverride(4);
  const slotFive = resolveGameplaySlotPlacementOverride(5);

  assert.deepEqual(slotZero, { scaleMultiplier: 1.18, extraLeftNudgePx: 0 });
  assert.deepEqual(slotOne, { scaleMultiplier: 1.29, extraLeftNudgePx: 0 });
  assert.deepEqual(slotTwo, { scaleMultiplier: 1.41, extraLeftNudgePx: 0 });
  assert.deepEqual(slotThree, { scaleMultiplier: 1.33, extraLeftNudgePx: 0 });
  assert.deepEqual(slotFour, { scaleMultiplier: 1.31, extraLeftNudgePx: 0 });
  assert.deepEqual(slotFive, { scaleMultiplier: 1, extraLeftNudgePx: 0 });
});

test('extra left nudge changes x anchor without affecting y anchor', () => {
  const base = resolveMoleAnchoredPosition({
    darkLeftX: 300,
    baseBodyBottomY: 580,
    openingWidth: 150,
    canvasWidth: 1254,
    canvasHeight: 1254,
    bodyBBoxLeft: 220,
    bodyBBoxBottom: 1004,
    renderScaleX: 0.3,
    renderScaleY: 0.32,
    profile: GAMEPLAY_MOLE_PLACEMENT_PROFILE,
  });

  const nudged = resolveMoleAnchoredPosition({
    darkLeftX: 300,
    baseBodyBottomY: 580,
    openingWidth: 150,
    canvasWidth: 1254,
    canvasHeight: 1254,
    bodyBBoxLeft: 220,
    bodyBBoxBottom: 1004,
    renderScaleX: 0.3,
    renderScaleY: 0.32,
    profile: GAMEPLAY_MOLE_PLACEMENT_PROFILE,
    extraLeftNudgePx: 3,
  });

  assert.equal(base.y, nudged.y);
  assert.equal(base.x - nudged.x, 3);
});

test('left nudge is additive to base overhang and does not alter stable contact math', () => {
  const darkLeftX = 320;
  const openingWidth = 150;
  const bodyBBoxLeft = 220;
  const canvasWidth = 1254;
  const base = resolveMoleAnchoredPosition({
    darkLeftX,
    baseBodyBottomY: 580,
    openingWidth,
    canvasWidth,
    canvasHeight: 1254,
    bodyBBoxLeft,
    bodyBBoxBottom: 1004,
    renderScaleX: 0.3,
    renderScaleY: 0.32,
    profile: GAMEPLAY_MOLE_PLACEMENT_PROFILE,
  });

  const nudged = resolveMoleAnchoredPosition({
    darkLeftX,
    baseBodyBottomY: 580,
    openingWidth,
    canvasWidth,
    canvasHeight: 1254,
    bodyBBoxLeft,
    bodyBBoxBottom: 1004,
    renderScaleX: 0.3,
    renderScaleY: 0.32,
    profile: GAMEPLAY_MOLE_PLACEMENT_PROFILE,
    extraLeftNudgePx: 3,
  });

  const renderedLeftBase = base.x + (bodyBBoxLeft - canvasWidth / 2) * 0.3;
  const renderedLeftNudged = nudged.x + (bodyBBoxLeft - canvasWidth / 2) * 0.3;
  assert.equal(renderedLeftBase - renderedLeftNudged, 3);
  assert.equal(base.y, nudged.y);
});

test('feasting profile adds down nudge while gameplay profile does not', () => {
  const gameplay = resolveMoleAnchoredPosition({
    darkLeftX: 300,
    baseBodyBottomY: 580,
    openingWidth: 140,
    canvasWidth: 1254,
    canvasHeight: 1254,
    bodyBBoxLeft: 222,
    bodyBBoxBottom: 1004,
    renderScaleX: 0.3,
    renderScaleY: 0.32,
    profile: GAMEPLAY_MOLE_PLACEMENT_PROFILE,
  });

  const feasting = resolveMoleAnchoredPosition({
    darkLeftX: 300,
    baseBodyBottomY: 580,
    openingWidth: 140,
    canvasWidth: 1254,
    canvasHeight: 1254,
    bodyBBoxLeft: 222,
    bodyBBoxBottom: 1004,
    renderScaleX: 0.3,
    renderScaleY: 0.32,
    profile: FEASTING_MOLE_PLACEMENT_PROFILE,
  });

  assert.equal(feasting.x, gameplay.x);
  assert.equal(feasting.y - gameplay.y, 2);
});
