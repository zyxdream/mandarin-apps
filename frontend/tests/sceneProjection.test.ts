import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeSceneRenderRect,
  projectNormalizedPoint,
} from '../src/engine/sceneProjection.js';

test('contain fit keeps full scene visible with pillarbox on wide viewport', () => {
  const rect = computeSceneRenderRect({
    containerWidth: 1920,
    containerHeight: 1080,
    sceneWidth: 1448,
    sceneHeight: 1086,
    fitMode: 'contain',
  });

  assert.equal(Math.round(rect.height), 1080);
  assert.ok(rect.width < 1920);
  assert.ok(rect.x > 0);
  assert.equal(Math.round(rect.y), 0);
});

test('contain fit keeps full scene visible with letterbox on tall viewport', () => {
  const rect = computeSceneRenderRect({
    containerWidth: 390,
    containerHeight: 844,
    sceneWidth: 1448,
    sceneHeight: 1086,
    fitMode: 'contain',
  });

  assert.equal(Math.round(rect.width), 390);
  assert.ok(rect.height < 844);
  assert.equal(Math.round(rect.x), 0);
  assert.ok(rect.y > 0);
});

test('normalized projection maps corners and center into render rect', () => {
  const rect = computeSceneRenderRect({
    containerWidth: 1366,
    containerHeight: 768,
    sceneWidth: 1448,
    sceneHeight: 1086,
    fitMode: 'contain',
  });

  const topLeft = projectNormalizedPoint(rect, { x: 0, y: 0 });
  const center = projectNormalizedPoint(rect, { x: 0.5, y: 0.5 });
  const bottomRight = projectNormalizedPoint(rect, { x: 1, y: 1 });

  assert.equal(topLeft.x, rect.x);
  assert.equal(topLeft.y, rect.y);
  assert.equal(center.x, rect.x + rect.width / 2);
  assert.equal(center.y, rect.y + rect.height / 2);
  assert.equal(bottomRight.x, rect.x + rect.width);
  assert.equal(bottomRight.y, rect.y + rect.height);
});
