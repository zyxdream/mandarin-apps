import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeBodyAnchoredMoleTransform,
  computeBodyOpeningShadowBounds,
  computeAttachedMoleTransform,
} from '../src/engine/moleAttachment.js';

const SAMPLE_META = {
  canvasWidth: 1254,
  canvasHeight: 1254,
  visibleBBox: {
    left: 172,
    top: 113,
    right: 1071,
    bottom: 992,
    width: 899,
    height: 879,
  },
  rimContactX: 624,
  rimContactY: 944,
  fitWidthPx: 730,
};

const SAMPLE_BODY_META = {
  ...SAMPLE_META,
  bodyBBox: {
    left: 222,
    top: 334,
    right: 692,
    bottom: 1004,
    width: 470,
    height: 670,
  },
  bodyLeftBottomX: 222,
  bodyBottomY: 1004,
};

test('attachment places rim contact exactly on hole rim line', () => {
  const hole = { centerX: 500, rimY: 700, openingWidth: 146 };
  const transform = computeAttachedMoleTransform(hole, SAMPLE_META, 1);

  const contactX = transform.x + (SAMPLE_META.rimContactX - SAMPLE_META.canvasWidth / 2) * transform.scale;
  const contactY = transform.y - (SAMPLE_META.canvasHeight - SAMPLE_META.rimContactY) * transform.scale;

  assert.ok(Math.abs(contactX - hole.centerX) < 1e-6);
  assert.ok(Math.abs(contactY - hole.rimY) < 1e-6);
});

test('attachment scale tracks hole opening width', () => {
  const small = computeAttachedMoleTransform({ centerX: 0, rimY: 0, openingWidth: 100 }, SAMPLE_META, 1);
  const large = computeAttachedMoleTransform({ centerX: 0, rimY: 0, openingWidth: 180 }, SAMPLE_META, 1);

  const expectedRatio = 180 / 100;
  const actualRatio = large.scale / small.scale;

  assert.ok(Math.abs(actualRatio - expectedRatio) < 1e-9);
});

test('body fit width can enlarge visual scale without moving the contact anchor', () => {
  const hole = { centerX: 500, rimY: 700, openingWidth: 146 };
  const bodyFitMeta = { ...SAMPLE_META, bodyFitWidthPx: 470 };
  const base = computeAttachedMoleTransform(hole, SAMPLE_META, 1);
  const bodyFit = computeAttachedMoleTransform(hole, bodyFitMeta, 1);

  assert.ok(bodyFit.scale > base.scale);
  assert.ok(bodyFit.scale <= base.scale * 1.35 + 1e-9);

  const contactX = bodyFit.x + (bodyFitMeta.rimContactX - bodyFitMeta.canvasWidth / 2) * bodyFit.scale;
  const contactY = bodyFit.y - (bodyFitMeta.canvasHeight - bodyFitMeta.rimContactY) * bodyFit.scale;

  assert.ok(Math.abs(contactX - hole.centerX) < 1e-6);
  assert.ok(Math.abs(contactY - hole.rimY) < 1e-6);
});

test('scale bias applies proportionally without changing contact anchoring', () => {
  const hole = { centerX: 640, rimY: 510, openingWidth: 140 };
  const base = computeAttachedMoleTransform(hole, SAMPLE_META, 1);
  const biased = computeAttachedMoleTransform(hole, SAMPLE_META, 1.2);

  assert.ok(Math.abs(biased.scale - base.scale * 1.2) < 1e-9);

  const baseContactX = base.x + (SAMPLE_META.rimContactX - SAMPLE_META.canvasWidth / 2) * base.scale;
  const baseContactY = base.y - (SAMPLE_META.canvasHeight - SAMPLE_META.rimContactY) * base.scale;
  const biasedContactX = biased.x + (SAMPLE_META.rimContactX - SAMPLE_META.canvasWidth / 2) * biased.scale;
  const biasedContactY = biased.y - (SAMPLE_META.canvasHeight - SAMPLE_META.rimContactY) * biased.scale;

  assert.ok(Math.abs(baseContactX - hole.centerX) < 1e-6);
  assert.ok(Math.abs(baseContactY - hole.rimY) < 1e-6);
  assert.ok(Math.abs(biasedContactX - hole.centerX) < 1e-6);
  assert.ok(Math.abs(biasedContactY - hole.rimY) < 1e-6);
});

test('body anchoring lands left-bottom body anchor on dark opening lip', () => {
  const hole = {
    darkLeftX: 240,
    darkRightX: 340,
    darkBackY: 500,
    darkFrontY: 550,
  };
  const transform = computeBodyAnchoredMoleTransform(hole, SAMPLE_BODY_META, 1);

  assert.ok(Math.abs(transform.bodyLeftX - hole.darkLeftX) < 1e-6);
  assert.ok(transform.bodyBottomY >= hole.darkFrontY);
  assert.ok(Math.abs(transform.scale - ((hole.darkRightX - hole.darkLeftX) * 1.08) / SAMPLE_BODY_META.bodyBBox.width) < 1e-9);
});

test('body-derived shadow stays inside dark opening bounds', () => {
  const hole = {
    darkLeftX: 240,
    darkRightX: 340,
    darkBackY: 500,
    darkFrontY: 550,
  };
  const transform = computeBodyAnchoredMoleTransform(hole, SAMPLE_BODY_META, 1);
  const shadow = computeBodyOpeningShadowBounds(hole, transform, 1);

  assert.ok(shadow.left >= hole.darkLeftX - 1e-6);
  assert.ok(shadow.right <= hole.darkRightX + 1e-6);
  assert.ok(shadow.top >= hole.darkBackY - 1e-6);
  assert.ok(shadow.bottom <= hole.darkFrontY + 1e-6);
});
