import { Application, useApplication, useTick } from '@pixi/react';
import { Assets, Container, Graphics, Sprite, Texture } from 'pixi.js';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { GameState } from '../types/game';
import { foodUnitsForCorrectWords, getRewardFoodOption, type RewardFood } from '../data/rewards';
import { CELEBRATION_MOLE_STYLES } from '../engine/celebrationMoles';
import { computeBodyAnchoredMoleTransform, computeBodyOpeningShadowBounds } from '../engine/moleAttachment';
import { getMoleSlots, getSceneRenderRect } from '../engine/moleLayout';
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
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  delay: number;
  duration: number;
  settleScale: number;
  spin: number;
}

const CELEBRATION_MS = 10_000;
const BACKGROUND_TEXTURE = '/assets/backgrounds/grass_world_with_holes_expand.png';
const MOLE_SHADOW_ALPHA = 0.18;
const RIM_SHADOW_ALPHA = 0.46;
const RIM_HIGHLIGHT_ALPHA = 0.2;
const MAX_FOOD_DROPS = 130;

function seededValue(seed: number) {
  const value = Math.sin(seed * 12.9898) * 43758.5453;
  return value - Math.floor(value);
}

function easeOutCubic(value: number) {
  return 1 - Math.pow(1 - value, 3);
}

function CelebrationCanvas({ selectedFood, foodUnits }: CelebrationCanvasProps) {
  const { app } = useApplication();
  const food = getRewardFoodOption(selectedFood);
  const backgroundRef = useRef<Sprite | null>(null);
  const shadowLayerRef = useRef<Graphics | null>(null);
  const rimLayerRef = useRef<Graphics | null>(null);
  const highlightLayerRef = useRef<Graphics | null>(null);
  const moleLayerRef = useRef<Container | null>(null);
  const foodLayerRef = useRef<Container | null>(null);
  const moleSpritesRef = useRef<Sprite[]>([]);
  const foodDropsRef = useRef<FoodDropState[]>([]);
  const frameRef = useRef(0);
  const stageSizeRef = useRef({ width: 0, height: 0 });

  useEffect(() => {
    let disposed = false;

    async function setup() {
      await Assets.load([
        BACKGROUND_TEXTURE,
        food.image,
        ...CELEBRATION_MOLE_STYLES.map(style => style.texture),
      ]);
      if (disposed) return;

      const background = new Sprite(Texture.from(BACKGROUND_TEXTURE));
      const shadowLayer = new Graphics();
      const rimLayer = new Graphics();
      const moleLayer = new Container();
      const highlightLayer = new Graphics();
      const foodLayer = new Container();

      app.stage.addChild(background, shadowLayer, moleLayer, highlightLayer, rimLayer, foodLayer);
      backgroundRef.current = background;
      shadowLayerRef.current = shadowLayer;
      rimLayerRef.current = rimLayer;
      moleLayerRef.current = moleLayer;
      highlightLayerRef.current = highlightLayer;
      foodLayerRef.current = foodLayer;
      stageSizeRef.current = { width: 0, height: 0 };
    }

    void setup();

    return () => {
      disposed = true;
      foodDropsRef.current = [];
      moleSpritesRef.current = [];
      app.stage?.removeChildren().forEach(child => child.destroy({ children: true }));
      backgroundRef.current = null;
      shadowLayerRef.current = null;
      rimLayerRef.current = null;
      highlightLayerRef.current = null;
      moleLayerRef.current = null;
      foodLayerRef.current = null;
    };
  }, [app, food.image]);

  useTick(() => {
    const background = backgroundRef.current;
    const shadowLayer = shadowLayerRef.current;
    const rimLayer = rimLayerRef.current;
    const highlightLayer = highlightLayerRef.current;
    const moleLayer = moleLayerRef.current;
    const foodLayer = foodLayerRef.current;
    if (!background || !shadowLayer || !rimLayer || !highlightLayer || !moleLayer || !foodLayer) return;

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
      moleSpritesRef.current = [];
      foodDropsRef.current = [];
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
      const count = Math.min(MAX_FOOD_DROPS, Math.max(foodUnits > 0 ? 24 : 10, Math.round(foodUnits * 1.45)));
      foodDropsRef.current = Array.from({ length: count }, (_, index) => {
        const slot = slots[index % slots.length];
        const sprite = new Sprite(Texture.from(food.image));
        const openingWidth = Math.max(1, slot.darkRightX - slot.darkLeftX);
        const startX = width * (0.08 + seededValue(index + 31) * 0.84);
        const startY = -openingWidth * (0.9 + seededValue(index + 39) * 1.2);
        const endX = slot.darkCenterX + (seededValue(index + 47) - 0.5) * openingWidth * 1.45;
        const endY = slot.darkFrontY + openingWidth * (0.38 + seededValue(index + 53) * 0.95);
        const size = openingWidth * (0.34 + seededValue(index + 67) * 0.22);
        sprite.anchor.set(0.5);
        sprite.width = size;
        sprite.height = size;
        sprite.alpha = 0;
        foodLayer.addChild(sprite);
        return {
          sprite,
          startX,
          startY,
          endX,
          endY,
          delay: seededValue(index + 73) * 260,
          duration: 260 + seededValue(index + 89) * 230,
          settleScale: 0.86 + seededValue(index + 97) * 0.28,
          spin: (seededValue(index + 107) - 0.5) * 2.8,
        };
      });
    }

    shadowLayer.clear();
    rimLayer.clear();
    highlightLayer.clear();

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
      const bodyWidth = transform.bodyWidth;
      const bodyHeight = transform.bodyHeight;
      const bodyCenterX = transform.bodyLeftX + bodyWidth / 2;
      const bodyCenterY = transform.bodyTopY + bodyHeight / 2;
      const wiggle = Math.sin(frame * 0.08 + index * 0.7);
      const bounce = Math.sin(frame * 0.11 + index * 0.55);
      const scaleX = transform.scale * (1 + wiggle * 0.028);
      const scaleY = transform.scale * (1 - wiggle * 0.018 + Math.max(0, bounce) * 0.018);

      sprite.texture = Texture.from(style.texture);
      sprite.position.set(transform.x + wiggle * 3.6, transform.y - Math.max(0, bounce) * 7.5);
      sprite.scale.set(scaleX, scaleY);
      sprite.rotation = wiggle * 0.035;
      sprite.alpha = 1;

      const shadowBounds = computeBodyOpeningShadowBounds(
        {
          darkLeftX: slot.darkLeftX,
          darkRightX: slot.darkRightX,
          darkBackY: slot.darkBackY,
          darkFrontY: slot.darkFrontY,
        },
        transform,
        1.04 + wiggle * 0.025,
      );
      shadowLayer.ellipse(shadowBounds.centerX, shadowBounds.centerY, shadowBounds.width * 0.42, shadowBounds.height * 0.4);
      shadowLayer.fill({ color: 0x070301, alpha: MOLE_SHADOW_ALPHA * 0.52 });
      shadowLayer.ellipse(bodyCenterX + bodyWidth * 0.13, transform.bodyBottomY - bodyHeight * 0.12, bodyWidth * 0.35, bodyHeight * 0.15);
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

    foodDropsRef.current.forEach((drop, index) => {
      const age = Math.max(0, frame - drop.delay);
      const progress = Math.min(1, age / drop.duration);
      const eased = easeOutCubic(progress);
      const arc = Math.sin(progress * Math.PI) * -34;
      drop.sprite.visible = age >= 0;
      drop.sprite.alpha = progress <= 0 ? 0 : Math.min(1, progress * 4);
      drop.sprite.x = drop.startX + (drop.endX - drop.startX) * eased;
      drop.sprite.y = drop.startY + (drop.endY - drop.startY) * eased + arc;
      drop.sprite.rotation = drop.spin * eased + index * 0.03;
      const squash = progress >= 1 ? 0.92 : 1;
      drop.sprite.scale.set(drop.settleScale * squash, drop.settleScale / squash);
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
    const audio = new Audio('/audio/sound_effects/victory-chime.mp3');
    audio.volume = 0.45;
    void audio.play().catch(error => {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      console.warn('[audio] victory chime play failed', error);
    });

    return () => {
      window.clearTimeout(timer);
      audio.pause();
      audio.src = '';
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
          <img src={food.image} alt="" />
          <span>{foodUnits}</span>
        </div>
        <div className="celebration-subtitle">Happy moles are feasting!</div>
      </div>
    </div>
  );
}
