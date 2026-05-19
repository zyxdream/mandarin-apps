import { Application, useApplication, useTick } from '@pixi/react';
import { Assets, Container, Graphics, Sprite, Texture } from 'pixi.js';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { GameState } from '../types/game';
import { foodUnitsForCorrectWords, getRewardFoodOption, type RewardFood } from '../data/rewards';
import { CELEBRATION_MOLE_STYLES } from '../engine/celebrationMoles';
import { computeBodyAnchoredMoleTransform, computeBodyOpeningShadowBounds } from '../engine/moleAttachment';
import { getMoleSlots, getSceneRenderRect } from '../engine/moleLayout';
import {
  FEASTING_MOLE_PLACEMENT_PROFILE,
  resolveMoleAnchoredPosition,
} from '../engine/molePlacementProfile';
import { DEFAULT_SCENE_FIT_MODE } from '../engine/sceneProjection';

interface CelebrationScreenProps {
  finalState: GameState;
  selectedFood: RewardFood;
  onComplete: () => void;
}

interface CelebrationCanvasProps {
  selectedFood: RewardFood;
  foodUnits: number;
}

interface FoodDropState {
  sprite: Sprite;
  slotIndex: number;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  delay: number;
  duration: number;
  baseScale: number;
  settleScale: number;
  spin: number;
  bounce: number;
  flipPhase: number;
  landedRotation: number;
}

interface SparkleState {
  sprite: Sprite;
  slotIndex: number;
  offsetX: number;
  offsetY: number;
  delay: number;
  duration: number;
  baseScale: number;
  pulseScale: number;
  spin: number;
}

const CELEBRATION_MS = 10_000;
const BACKGROUND_TEXTURE = '/assets/backgrounds/grass_world_with_holes_expand.v2.webp';
const SPARKLE_TEXTURE = '/assets/effects/sparkle.v2.webp';
const MOLE_SHADOW_ALPHA = 0.18;
const RIM_SHADOW_ALPHA = 0.46;
const RIM_HIGHLIGHT_ALPHA = 0.2;
const GLOBAL_FEASTING_LEFT_NUDGE_PX = 3;
const MAX_FOOD_DROPS = 150;
const MAX_SPARKLES = 44;
const CONFETTI_COUNT = 72;
const PARTY_BURST_FRAMES = 210;
const PARTY_SECOND_BURST_DELAY = 72;
const WIGGLE_FLOWERS = [
  { x: 0.47, y: 0.55, size: 10, petal: 0xffb6d5, center: 0xffe066, phase: 0.2 },
  { x: 0.53, y: 0.52, size: 8, petal: 0xffd2e4, center: 0xffb347, phase: 1.1 },
  { x: 0.61, y: 0.58, size: 11, petal: 0xff8fb8, center: 0xffe066, phase: 2.4 },
  { x: 0.78, y: 0.54, size: 12, petal: 0xffc3dc, center: 0xffe066, phase: 0.8 },
  { x: 0.86, y: 0.58, size: 10, petal: 0xffe6f2, center: 0xffc04a, phase: 1.9 },
  { x: 0.91, y: 0.52, size: 9, petal: 0xff9fc5, center: 0xffe066, phase: 2.8 },
];

function seededValue(seed: number) {
  const value = Math.sin(seed * 12.9898) * 43758.5453;
  return value - Math.floor(value);
}

function easeOutCubic(value: number) {
  return 1 - Math.pow(1 - value, 3);
}

function drawStar(layer: Graphics, x: number, y: number, outerRadius: number, innerRadius: number, points: number, rotation: number) {
  for (let point = 0; point < points * 2; point += 1) {
    const radius = point % 2 === 0 ? outerRadius : innerRadius;
    const angle = rotation + point * Math.PI / points;
    const px = x + Math.cos(angle) * radius;
    const py = y + Math.sin(angle) * radius;
    if (point === 0) {
      layer.moveTo(px, py);
    } else {
      layer.lineTo(px, py);
    }
  }
  layer.closePath();
}

function drawTriangle(layer: Graphics, x: number, y: number, radius: number, rotation: number) {
  for (let point = 0; point < 3; point += 1) {
    const angle = rotation + point * Math.PI * 2 / 3;
    const px = x + Math.cos(angle) * radius;
    const py = y + Math.sin(angle) * radius;
    if (point === 0) {
      layer.moveTo(px, py);
    } else {
      layer.lineTo(px, py);
    }
  }
  layer.closePath();
}

function drawPartyBurst(
  layer: Graphics,
  originX: number,
  originY: number,
  direction: number,
  frame: number,
  startFrame: number,
  height: number,
  seedOffset: number,
  strength: number,
) {
  const colors = [0xffe066, 0xff6b6b, 0x68d8ff, 0x9cff6e, 0xff9f1c, 0xffc2e2];
  const elapsed = frame - startFrame;
  if (elapsed < 0 || elapsed > PARTY_BURST_FRAMES) return;

  const burstProgress = Math.min(1, elapsed / PARTY_BURST_FRAMES);
  const live = Math.max(0, 1 - burstProgress);
  const pieceCount = Math.round(34 * strength);

  for (let i = 0; i < pieceCount; i += 1) {
    const seed = seedOffset + i;
    const pieceDelay = i * 1.4;
    const localProgress = Math.max(0, Math.min(1, (elapsed - pieceDelay) / PARTY_BURST_FRAMES));
    const distance = (90 + seededValue(seed + 13) * 320) * easeOutCubic(localProgress) * strength;
    const angle = (-0.88 - seededValue(seed + 17) * 1.18) * direction;
    const x = originX + Math.cos(angle) * distance * direction;
    const gravity = Math.pow(localProgress, 2) * height * 0.16;
    const y = originY + Math.sin(Math.abs(angle)) * distance - localProgress * height * 0.18 + gravity;
    const color = colors[i % colors.length];
    const alpha = live * (0.54 + seededValue(seed + 31) * 0.4);
    const rotation = localProgress * (2.2 + seededValue(seed + 41) * 4.8) * direction;
    const size = 5 + seededValue(seed + 23) * 13;

    switch (i % 5) {
      case 0:
        layer.rect(x, y, size * 2.1, size * 0.34);
        layer.fill({ color, alpha });
        break;
      case 1:
        layer.circle(x, y, size * 0.42);
        layer.fill({ color, alpha: alpha * 0.88 });
        break;
      case 2:
        drawStar(layer, x, y, size * 0.7, size * 0.32, 5, rotation);
        layer.fill({ color, alpha });
        break;
      case 3:
        drawTriangle(layer, x, y, size * 0.72, rotation);
        layer.fill({ color, alpha: alpha * 0.9 });
        break;
      default:
        layer.moveTo(x, y);
        layer.quadraticCurveTo(
          x + direction * size * (1.4 + seededValue(seed + 53)),
          y - size * (1.8 + seededValue(seed + 59)),
          x + direction * size * (3 + seededValue(seed + 61)),
          y + size * (0.2 + seededValue(seed + 67)),
        );
        layer.stroke({ color, alpha, width: Math.max(1.2, size * 0.22) });
        break;
    }
  }

  layer.circle(originX, originY, 18 + Math.sin(frame * 0.16) * 2);
  layer.fill({ color: 0x6b3415, alpha: 0.78 });
  layer.circle(originX + direction * 14, originY - 8, 9);
  layer.fill({ color: 0xffe066, alpha: 0.9 });
}

function CelebrationCanvas({ selectedFood, foodUnits }: CelebrationCanvasProps) {
  const { app } = useApplication();
  const food = getRewardFoodOption(selectedFood);
  const backgroundRef = useRef<Sprite | null>(null);
  const flowerLayerRef = useRef<Graphics | null>(null);
  const glowLayerRef = useRef<Graphics | null>(null);
  const shadowLayerRef = useRef<Graphics | null>(null);
  const rimLayerRef = useRef<Graphics | null>(null);
  const highlightLayerRef = useRef<Graphics | null>(null);
  const partyLayerRef = useRef<Graphics | null>(null);
  const confettiLayerRef = useRef<Graphics | null>(null);
  const moleLayerRef = useRef<Container | null>(null);
  const foodLayerRef = useRef<Container | null>(null);
  const sparkleLayerRef = useRef<Container | null>(null);
  const moleSpritesRef = useRef<Sprite[]>([]);
  const foodDropsRef = useRef<FoodDropState[]>([]);
  const sparklesRef = useRef<SparkleState[]>([]);
  const frameRef = useRef(0);
  const stageSizeRef = useRef({ width: 0, height: 0 });

  useEffect(() => {
    let disposed = false;

    async function setup() {
      await Assets.load([
        BACKGROUND_TEXTURE,
        SPARKLE_TEXTURE,
        food.baseImage,
        ...CELEBRATION_MOLE_STYLES.map(style => style.texture),
      ]);
      if (disposed) return;

      const background = new Sprite(Texture.from(BACKGROUND_TEXTURE));
      const flowerLayer = new Graphics();
      const glowLayer = new Graphics();
      const shadowLayer = new Graphics();
      const rimLayer = new Graphics();
      const moleLayer = new Container();
      const highlightLayer = new Graphics();
      const foodLayer = new Container();
      const sparkleLayer = new Container();
      const partyLayer = new Graphics();
      const confettiLayer = new Graphics();

      app.stage.addChild(
        background,
        flowerLayer,
        glowLayer,
        shadowLayer,
        moleLayer,
        highlightLayer,
        rimLayer,
        foodLayer,
        sparkleLayer,
        partyLayer,
        confettiLayer,
      );
      backgroundRef.current = background;
      flowerLayerRef.current = flowerLayer;
      glowLayerRef.current = glowLayer;
      shadowLayerRef.current = shadowLayer;
      rimLayerRef.current = rimLayer;
      moleLayerRef.current = moleLayer;
      highlightLayerRef.current = highlightLayer;
      foodLayerRef.current = foodLayer;
      sparkleLayerRef.current = sparkleLayer;
      partyLayerRef.current = partyLayer;
      confettiLayerRef.current = confettiLayer;
      stageSizeRef.current = { width: 0, height: 0 };
    }

    void setup();

    return () => {
      disposed = true;
      foodDropsRef.current = [];
      sparklesRef.current = [];
      moleSpritesRef.current = [];
      app.stage?.removeChildren().forEach(child => child.destroy({ children: true }));
      backgroundRef.current = null;
      flowerLayerRef.current = null;
      glowLayerRef.current = null;
      shadowLayerRef.current = null;
      rimLayerRef.current = null;
      highlightLayerRef.current = null;
      moleLayerRef.current = null;
      foodLayerRef.current = null;
      sparkleLayerRef.current = null;
      partyLayerRef.current = null;
      confettiLayerRef.current = null;
    };
  }, [app, food.baseImage]);

  useTick(() => {
    const background = backgroundRef.current;
    const flowerLayer = flowerLayerRef.current;
    const glowLayer = glowLayerRef.current;
    const shadowLayer = shadowLayerRef.current;
    const rimLayer = rimLayerRef.current;
    const highlightLayer = highlightLayerRef.current;
    const partyLayer = partyLayerRef.current;
    const confettiLayer = confettiLayerRef.current;
    const moleLayer = moleLayerRef.current;
    const foodLayer = foodLayerRef.current;
    const sparkleLayer = sparkleLayerRef.current;
    if (
      !background ||
      !flowerLayer ||
      !glowLayer ||
      !shadowLayer ||
      !rimLayer ||
      !highlightLayer ||
      !partyLayer ||
      !confettiLayer ||
      !moleLayer ||
      !foodLayer ||
      !sparkleLayer
    ) return;

    frameRef.current += 1;
    const frame = frameRef.current;
    const width = app.renderer.width;
    const height = app.renderer.height;

    if (stageSizeRef.current.width !== width || stageSizeRef.current.height !== height) {
      stageSizeRef.current = { width, height };
      const renderRect = getSceneRenderRect({ canvasWidth: width, canvasHeight: height }, DEFAULT_SCENE_FIT_MODE);
      background.position.set(renderRect.x, renderRect.y);
      background.width = renderRect.width;
      background.height = renderRect.height;
      moleLayer.removeChildren().forEach(child => child.destroy());
      foodLayer.removeChildren().forEach(child => child.destroy());
      sparkleLayer.removeChildren().forEach(child => child.destroy());
      moleSpritesRef.current = [];
      foodDropsRef.current = [];
      sparklesRef.current = [];
    }

    const slots = getMoleSlots({ canvasWidth: width, canvasHeight: height }, DEFAULT_SCENE_FIT_MODE);
    if (moleSpritesRef.current.length !== slots.length) {
      moleLayer.removeChildren().forEach(child => child.destroy());
      moleSpritesRef.current = slots.map((_, index) => {
        const style = CELEBRATION_MOLE_STYLES[index % CELEBRATION_MOLE_STYLES.length];
        const sprite = new Sprite(Texture.from(style.texture));
        sprite.anchor.set(0.5, 1);
        moleLayer.addChild(sprite);
        return sprite;
      });
    }

    if (foodDropsRef.current.length === 0 && slots.length > 0) {
      const count = Math.min(MAX_FOOD_DROPS, Math.max(foodUnits > 0 ? 36 : 14, Math.round(foodUnits * 1.7)));
      foodDropsRef.current = Array.from({ length: count }, (_, index) => {
        const slot = slots[index % slots.length];
        const sprite = new Sprite(Texture.from(food.baseImage));
        const openingWidth = Math.max(1, slot.darkRightX - slot.darkLeftX);
        const startX = width * (0.08 + seededValue(index + 31) * 0.84);
        const startY = -openingWidth * (1.6 + seededValue(index + 39) * 2.2);
        const endX = slot.darkCenterX + (seededValue(index + 47) - 0.5) * openingWidth * 1.95;
        const endY = slot.darkFrontY + openingWidth * (0.52 + seededValue(index + 53) * 1.1);
        const maxSize = openingWidth * (0.78 + seededValue(index + 67) * 0.3);
        const textureMax = Math.max(sprite.texture.width || 1, sprite.texture.height || 1);
        sprite.anchor.set(0.5);
        sprite.scale.set(maxSize / textureMax);
        sprite.alpha = 0;
        foodLayer.addChild(sprite);
        return {
          sprite,
          slotIndex: index % slots.length,
          startX,
          startY,
          endX,
          endY,
          delay: index * 3.2 + seededValue(index + 73) * 165,
          duration: 215 + seededValue(index + 89) * 165,
          baseScale: maxSize / textureMax,
          settleScale: 0.92 + seededValue(index + 97) * 0.24,
          spin: (seededValue(index + 107) - 0.5) * 3.6,
          bounce: 6 + seededValue(index + 113) * 13,
          flipPhase: seededValue(index + 127) * Math.PI * 2,
          landedRotation: (seededValue(index + 131) - 0.5) * 0.45,
        };
      });
    }

    if (sparklesRef.current.length === 0 && slots.length > 0) {
      const count = Math.min(MAX_SPARKLES, Math.max(18, Math.round(foodUnits * 0.5)));
      sparklesRef.current = Array.from({ length: count }, (_, index) => {
        const slot = slots[index % slots.length];
        const sprite = new Sprite(Texture.from(SPARKLE_TEXTURE));
        const openingWidth = Math.max(1, slot.darkRightX - slot.darkLeftX);
        const maxSize = openingWidth * (0.28 + seededValue(index + 211) * 0.18);
        const textureMax = Math.max(sprite.texture.width || 1, sprite.texture.height || 1);
        sprite.anchor.set(0.5);
        sprite.alpha = 0;
        sprite.scale.set(maxSize / textureMax);
        sparkleLayer.addChild(sprite);
        return {
          sprite,
          slotIndex: index % slots.length,
          offsetX: (seededValue(index + 223) - 0.5) * openingWidth * 2.15,
          offsetY: -openingWidth * (0.45 + seededValue(index + 229) * 0.7),
          delay: 38 + seededValue(index + 233) * 420,
          duration: 55 + seededValue(index + 239) * 42,
          baseScale: maxSize / textureMax,
          pulseScale: 0.7 + seededValue(index + 241) * 0.55,
          spin: (seededValue(index + 251) - 0.5) * 1.8,
        };
      });
    }

    glowLayer.clear();
    flowerLayer.clear();
    shadowLayer.clear();
    rimLayer.clear();
    highlightLayer.clear();
    partyLayer.clear();
    confettiLayer.clear();

    const lookUpProgress = Math.max(0, 1 - frame / 270);
    const renderRect = getSceneRenderRect({ canvasWidth: width, canvasHeight: height }, DEFAULT_SCENE_FIT_MODE);

    WIGGLE_FLOWERS.forEach((flower, index) => {
      const baseX = renderRect.x + renderRect.width * flower.x;
      const baseY = renderRect.y + renderRect.height * flower.y;
      const sceneScale = Math.min(renderRect.width, renderRect.height) / 900;
      const size = flower.size * sceneScale;
      const sway = Math.sin(frame * 0.045 + flower.phase) * size * 0.42;
      const lean = Math.sin(frame * 0.052 + flower.phase) * 0.28;
      const stemTopX = baseX + sway;
      const stemTopY = baseY - size * 2.2;

      flowerLayer.moveTo(baseX, baseY + size * 1.2);
      flowerLayer.quadraticCurveTo(baseX + sway * 0.55, baseY - size * 0.8, stemTopX, stemTopY);
      flowerLayer.stroke({ color: 0x4f8f2f, alpha: 0.58, width: Math.max(1.2, size * 0.18) });

      for (let petalIndex = 0; petalIndex < 5; petalIndex += 1) {
        const angle = lean + petalIndex * (Math.PI * 2 / 5);
        flowerLayer.ellipse(
          stemTopX + Math.cos(angle) * size * 0.64,
          stemTopY + Math.sin(angle) * size * 0.48,
          size * 0.44,
          size * 0.28,
        );
        flowerLayer.fill({ color: flower.petal, alpha: 0.68 });
      }

      flowerLayer.circle(stemTopX, stemTopY, size * (0.28 + (index % 2) * 0.04));
      flowerLayer.fill({ color: flower.center, alpha: 0.82 });
    });

    slots.forEach((slot, index) => {
      const style = CELEBRATION_MOLE_STYLES[index % CELEBRATION_MOLE_STYLES.length];
      const sprite = moleSpritesRef.current[index];
      if (!sprite) return;

      const transform = computeBodyAnchoredMoleTransform(
        {
          darkLeftX: slot.darkLeftX,
          darkRightX: slot.darkRightX,
          darkBackY: slot.darkBackY,
          darkFrontY: slot.darkFrontY,
        },
        style.meta,
        style.scaleBias ?? 1,
      );
      const bodyBBox = style.meta.bodyBBox ?? style.meta.visibleBBox;
      const wiggle = Math.sin(frame * 0.08 + index * 0.7);
      const bounce = Math.sin(frame * 0.11 + index * 0.55);
      const lookLean = Math.sin(index * 1.3) * lookUpProgress;
      const motionBodyWidth = transform.bodyWidth * FEASTING_MOLE_PLACEMENT_PROFILE.sizeMultiplier;
      const motionBodyHeight = transform.bodyHeight * FEASTING_MOLE_PLACEMENT_PROFILE.sizeMultiplier;
      const renderScaleX = (
        transform.scale * (1 + wiggle * 0.028 + lookUpProgress * 0.028)
      ) * FEASTING_MOLE_PLACEMENT_PROFILE.sizeMultiplier;
      const renderScaleY = (
        transform.scale * (1 - wiggle * 0.018 - lookUpProgress * 0.045 + Math.max(0, bounce) * 0.018)
      ) * FEASTING_MOLE_PLACEMENT_PROFILE.sizeMultiplier;
      const anchored = resolveMoleAnchoredPosition({
        darkLeftX: slot.darkLeftX,
        baseBodyBottomY: transform.bodyBottomY,
        openingWidth: slot.openingWidth,
        canvasWidth: style.meta.canvasWidth,
        canvasHeight: style.meta.canvasHeight,
        bodyBBoxLeft: bodyBBox.left,
        bodyBBoxBottom: bodyBBox.bottom,
        bodyLeftBottomX: style.meta.bodyLeftBottomX,
        bodyBottomY: style.meta.bodyBottomY,
        renderScaleX,
        renderScaleY,
        profile: FEASTING_MOLE_PLACEMENT_PROFILE,
        extraLeftNudgePx: GLOBAL_FEASTING_LEFT_NUDGE_PX,
      });
      const animatedX = anchored.x + wiggle * 3.6 + lookLean * motionBodyWidth * 0.02;
      const animatedY = anchored.y - Math.max(0, bounce) * 7.5 - lookUpProgress * motionBodyHeight * 0.035;
      const bodyLeftX = animatedX + (bodyBBox.left - style.meta.canvasWidth / 2) * renderScaleX;
      const bodyRightX = animatedX + (bodyBBox.right - style.meta.canvasWidth / 2) * renderScaleX;
      const bodyTopY = animatedY - (style.meta.canvasHeight - bodyBBox.top) * renderScaleY;
      const bodyBottomY = animatedY - (style.meta.canvasHeight - bodyBBox.bottom) * renderScaleY;
      const bodyWidth = bodyRightX - bodyLeftX;
      const bodyHeight = bodyBottomY - bodyTopY;
      const bodyCenterX = bodyLeftX + bodyWidth / 2;
      const bodyCenterY = bodyTopY + bodyHeight / 2;
      const renderedBody = {
        x: animatedX,
        y: animatedY,
        scale: (renderScaleX + renderScaleY) / 2,
        bodyLeftX,
        bodyRightX,
        bodyTopY,
        bodyBottomY,
        bodyWidth,
        bodyHeight,
      };

      sprite.texture = Texture.from(style.texture);
      sprite.position.set(animatedX, animatedY);
      sprite.scale.set(renderScaleX, renderScaleY);
      sprite.rotation = wiggle * 0.035 + lookLean * 0.045;
      sprite.alpha = 1;

      const glowPulse = (Math.sin(frame * 0.09 + index * 1.2) + 1) / 2;
      glowLayer.ellipse(
        slot.darkCenterX,
        slot.darkFrontY + slot.openingHeight * 0.28,
        slot.openingWidth * (0.95 + glowPulse * 0.18),
        slot.openingHeight * (0.68 + glowPulse * 0.1),
      );
      glowLayer.fill({ color: 0xffda7a, alpha: (0.12 + glowPulse * 0.08) * (1 - lookUpProgress * 0.35) });

      const shadowBounds = computeBodyOpeningShadowBounds(
        {
          darkLeftX: slot.darkLeftX,
          darkRightX: slot.darkRightX,
          darkBackY: slot.darkBackY,
          darkFrontY: slot.darkFrontY,
        },
        renderedBody,
        1.04 + wiggle * 0.025,
      );
      shadowLayer.ellipse(shadowBounds.centerX, shadowBounds.centerY, shadowBounds.width * 0.42, shadowBounds.height * 0.4);
      shadowLayer.fill({ color: 0x070301, alpha: MOLE_SHADOW_ALPHA * 0.52 });
      shadowLayer.ellipse(bodyCenterX + bodyWidth * 0.13, renderedBody.bodyBottomY - bodyHeight * 0.12, bodyWidth * 0.35, bodyHeight * 0.15);
      shadowLayer.fill({ color: 0x030100, alpha: MOLE_SHADOW_ALPHA * 0.42 });

      highlightLayer.ellipse(bodyCenterX - bodyWidth * 0.22, bodyCenterY - bodyHeight * 0.22, bodyWidth * 0.18, bodyHeight * 0.14);
      highlightLayer.fill({ color: 0xffe4b8, alpha: 0.13 });

      const rimRx = slot.openingWidth * 0.62;
      const rimRy = slot.openingHeight * 0.34;
      const frontLipY = slot.darkFrontY - slot.openingHeight * 0.04;
      rimLayer.ellipse(slot.darkCenterX, frontLipY, rimRx, rimRy);
      rimLayer.fill({ color: 0x2a160c, alpha: RIM_SHADOW_ALPHA });
      rimLayer.ellipse(slot.darkCenterX, frontLipY - rimRy * 0.26, rimRx * 0.92, rimRy * 0.46);
      rimLayer.fill({ color: 0x8a5a32, alpha: RIM_HIGHLIGHT_ALPHA });
      rimLayer.ellipse(slot.darkCenterX - rimRx * 0.18, frontLipY - rimRy * 0.36, rimRx * 0.34, rimRy * 0.2);
      rimLayer.fill({ color: 0xd7a15d, alpha: RIM_HIGHLIGHT_ALPHA * 0.48 });
    });

    for (let side = 0; side < 2; side += 1) {
      const direction = side === 0 ? 1 : -1;
      const originX = side === 0 ? width * 0.08 : width * 0.92;
      const originY = height * 0.86;
      drawPartyBurst(partyLayer, originX, originY, direction, frame, 0, height, side * 200, 1);
      drawPartyBurst(
        partyLayer,
        originX + direction * width * 0.035,
        originY - height * 0.05,
        direction,
        frame,
        PARTY_SECOND_BURST_DELAY,
        height,
        side * 200 + 100,
        0.68,
      );
    }

    for (let i = 0; i < CONFETTI_COUNT; i += 1) {
      const seed = i + 311;
      const drift = (frame * (0.35 + seededValue(seed) * 0.65) + seededValue(seed + 7) * height) % (height + 70);
      const x = width * (0.08 + seededValue(seed + 11) * 0.84) + Math.sin(frame * 0.025 + i) * 18;
      const y = drift - 35;
      const size = 4 + seededValue(seed + 19) * 8;
      const color = [0xffe066, 0xff8a5b, 0x78e08f, 0x8ec5ff, 0xffc2e2][i % 5];
      confettiLayer.rect(x, y, size, size * 0.42);
      confettiLayer.fill({ color, alpha: 0.34 + seededValue(seed + 23) * 0.34 });
    }

    foodDropsRef.current.forEach((drop, index) => {
      const age = frame - drop.delay;
      const progress = Math.max(0, Math.min(1, age / drop.duration));
      const eased = easeOutCubic(progress);
      const arc = Math.sin(progress * Math.PI) * -34;
      const landing = progress >= 1 ? Math.min(1, (age - drop.duration) / 20) : 0;
      const groundProgress = Math.max(0, Math.min(1, (progress - 0.72) / 0.28));
      const flip = Math.cos(progress * Math.PI * 3.2 + drop.flipPhase);
      const fakeDepthX = 1 + Math.abs(flip) * 0.16;
      const fakeDepthY = 1 - Math.abs(flip) * 0.09;
      drop.sprite.visible = age >= 0;
      drop.sprite.alpha = progress <= 0 ? 0 : Math.min(1, progress * 4);
      drop.sprite.x = drop.startX + (drop.endX - drop.startX) * eased;
      drop.sprite.y = drop.startY + (drop.endY - drop.startY) * eased + arc;
      if (progress >= 1) {
        drop.sprite.y = drop.endY - Math.sin((age - drop.duration) * 0.16) * drop.bounce * Math.exp(-(age - drop.duration) * 0.045);
      }
      drop.sprite.rotation = progress >= 1
        ? drop.landedRotation
        : drop.spin * eased + index * 0.03;
      const squash = 1 - Math.sin(landing * Math.PI) * 0.16;
      const groundFlatten = progress >= 1 ? 0.88 : 1;
      drop.sprite.scale.set(
        drop.baseScale * drop.settleScale * fakeDepthX / squash,
        drop.baseScale * drop.settleScale * fakeDepthY * squash * groundFlatten,
      );

      if (age >= 0 && progress > 0.62) {
        const shadowWidth = 18 + drop.sprite.texture.width * drop.baseScale * drop.settleScale * (0.3 + groundProgress * 0.52);
        const shadowHeight = 6 + drop.sprite.texture.height * drop.baseScale * drop.settleScale * (0.045 + groundProgress * 0.08);
        shadowLayer.ellipse(drop.endX, drop.endY + shadowHeight * 0.5, shadowWidth, shadowHeight);
        shadowLayer.fill({ color: 0x120804, alpha: 0.06 + groundProgress * 0.16 });
      }

      if (landing > 0 && landing < 1) {
        const contactPulse = Math.sin(landing * Math.PI);
        glowLayer.ellipse(drop.endX, drop.endY, 28 + contactPulse * 24, 10 + contactPulse * 9);
        glowLayer.fill({ color: 0xffe066, alpha: contactPulse * 0.18 });
      }
    });

    sparklesRef.current.forEach((sparkle, index) => {
      const slot = slots[sparkle.slotIndex];
      const age = frame - sparkle.delay;
      const loopAge = ((age % sparkle.duration) + sparkle.duration) % sparkle.duration;
      const progress = loopAge / sparkle.duration;
      const pulse = Math.sin(progress * Math.PI);
      sparkle.sprite.visible = age >= 0;
      sparkle.sprite.alpha = age < 0 ? 0 : pulse * 0.72;
      sparkle.sprite.x = slot.darkCenterX + sparkle.offsetX + Math.sin(frame * 0.032 + index) * slot.openingWidth * 0.08;
      sparkle.sprite.y = slot.darkBackY + sparkle.offsetY + Math.cos(frame * 0.04 + index) * slot.openingHeight * 0.32;
      sparkle.sprite.rotation += sparkle.spin * 0.035;
      const sparkleScale = sparkle.baseScale * sparkle.pulseScale * (0.75 + pulse * 0.42);
      sparkle.sprite.scale.set(sparkleScale);
    });
  });

  return null;
}

export function CelebrationScreen({ finalState, selectedFood, onComplete }: CelebrationScreenProps) {
  const food = getRewardFoodOption(selectedFood);
  const foodUnits = foodUnitsForCorrectWords(finalState.wordsHit.length);
  const [resizeTarget, setResizeTarget] = useState<HTMLDivElement | null>(null);
  const handleCanvasRef = useCallback((node: HTMLDivElement | null) => {
    setResizeTarget(node);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(onComplete, CELEBRATION_MS);
    const chime = new Audio('/audio/sound_effects/victory-chime.mp3');
    chime.volume = 0.45;
    const laugh = new Audio('/audio/sound_effects/children-laughing-377305.mp3');
    laugh.volume = 0.28;

    const play = (element: HTMLAudioElement, label: string) => {
      void element.play().catch(error => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        console.warn(`[audio] ${label} play failed`, error);
      });
    };
    play(chime, 'victory chime');
    play(laugh, 'children laughing');

    const stop = (element: HTMLAudioElement) => {
      element.pause();
      element.src = '';
    };

    return () => {
      window.clearTimeout(timer);
      stop(chime);
      stop(laugh);
    };
  }, [onComplete]);

  return (
    <div className="celebration-screen celebration-screen--pixi">
      <div className="celebration-canvas-host" ref={handleCanvasRef}>
        {resizeTarget && (
          <Application resizeTo={resizeTarget} backgroundAlpha={0} antialias>
            <CelebrationCanvas selectedFood={selectedFood} foodUnits={foodUnits} />
          </Application>
        )}
      </div>

      <div className="celebration-copy celebration-copy--compact">
        <div className="celebration-kicker">Snack Time!</div>
        <div className="celebration-food-total">
          <img src={food.baseImage} alt="" />
          <span>{foodUnits}</span>
        </div>
        <div className="celebration-subtitle">Happy moles are feasting!</div>
      </div>
    </div>
  );
}
