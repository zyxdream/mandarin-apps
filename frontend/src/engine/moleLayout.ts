import type { MoleState } from '../types/game.js';
import {
  computeSceneRenderRect,
  DEFAULT_SCENE_FIT_MODE,
  type SceneFitMode,
  type SceneRenderRect,
} from './sceneProjection.js';

export interface BoardConfig {
  canvasWidth: number;
  canvasHeight: number;
}

interface HoleSlotBlueprint {
  darkLeftXNorm: number;
  darkRightXNorm: number;
  darkBackYNorm: number;
  darkFrontYNorm: number;
  moleOverlapPxRatio?: number;
}

export interface MoleSlot {
  slotIndex: number;
  x: number;
  y: number;
  centerY: number;
  openingWidth: number;
  openingHeight: number;
  leftX: number;
  rightX: number;
  backLipY: number;
  frontY: number;
  moleContactY: number;
  shadowCenterY: number;
  darkLeftX: number;
  darkRightX: number;
  darkBackY: number;
  darkFrontY: number;
  darkCenterX: number;
  darkCenterY: number;
  moleOverlapPxRatio: number;
  scale: number;
}

const COLS = 3;
const ROWS = 2;
export const MOLE_SLOT_COUNT = COLS * ROWS;
export const BACKGROUND_BASE_WIDTH = 1672;
export const BACKGROUND_BASE_HEIGHT = 941;

// Tuned to grass_world_with_holes_expand background.
const SLOT_BLUEPRINTS: HoleSlotBlueprint[] = [
  { darkLeftXNorm: 0.208, darkRightXNorm: 0.269, darkBackYNorm: 0.658, darkFrontYNorm: 0.704, moleOverlapPxRatio: 0.04 },
  { darkLeftXNorm: 0.350, darkRightXNorm: 0.406, darkBackYNorm: 0.606, darkFrontYNorm: 0.646, moleOverlapPxRatio: 0.04 },
  { darkLeftXNorm: 0.477, darkRightXNorm: 0.528, darkBackYNorm: 0.584, darkFrontYNorm: 0.624, moleOverlapPxRatio: 0.03 },
  { darkLeftXNorm: 0.591, darkRightXNorm: 0.645, darkBackYNorm: 0.550, darkFrontYNorm: 0.589, moleOverlapPxRatio: 0.02 },
  // Use the mid/far-right painted hole instead of the most-front bottom-center hole.
  { darkLeftXNorm: 0.605, darkRightXNorm: 0.660, darkBackYNorm: 0.639, darkFrontYNorm: 0.682, moleOverlapPxRatio: 0.04 },
  { darkLeftXNorm: 0.736, darkRightXNorm: 0.808, darkBackYNorm: 0.676, darkFrontYNorm: 0.728, moleOverlapPxRatio: 0.05 },
];

export function getSceneRenderRect(config: BoardConfig, fitMode: SceneFitMode = DEFAULT_SCENE_FIT_MODE): SceneRenderRect {
  return computeSceneRenderRect({
    containerWidth: config.canvasWidth,
    containerHeight: config.canvasHeight,
    sceneWidth: BACKGROUND_BASE_WIDTH,
    sceneHeight: BACKGROUND_BASE_HEIGHT,
    fitMode,
  });
}

export function getMoleSlots(
  config: BoardConfig,
  fitMode: SceneFitMode = DEFAULT_SCENE_FIT_MODE,
): MoleSlot[] {
  const renderRect = getSceneRenderRect(config, fitMode);

  return Array.from({ length: MOLE_SLOT_COUNT }, (_, slotIndex) => {
    const slot = SLOT_BLUEPRINTS[slotIndex] ?? SLOT_BLUEPRINTS[0];
    const darkLeftX = renderRect.x + renderRect.width * slot.darkLeftXNorm;
    const darkRightX = renderRect.x + renderRect.width * slot.darkRightXNorm;
    const darkBackY = renderRect.y + renderRect.height * slot.darkBackYNorm;
    const darkFrontY = renderRect.y + renderRect.height * slot.darkFrontYNorm;
    const openingWidth = darkRightX - darkLeftX;
    const openingHeight = darkFrontY - darkBackY;
    const darkCenterX = (darkLeftX + darkRightX) / 2;
    const darkCenterY = (darkBackY + darkFrontY) / 2;
    return {
      slotIndex,
      x: darkCenterX,
      // `y` stays as the gameplay-compatible body contact line alias.
      y: darkFrontY,
      centerY: darkCenterY,
      leftX: darkLeftX,
      rightX: darkRightX,
      backLipY: darkBackY,
      frontY: darkFrontY,
      moleContactY: darkFrontY,
      shadowCenterY: darkCenterY,
      darkLeftX,
      darkRightX,
      darkBackY,
      darkFrontY,
      darkCenterX,
      darkCenterY,
      openingWidth,
      openingHeight,
      moleOverlapPxRatio: slot.moleOverlapPxRatio ?? 0.04,
      // `scale` kept for compatibility with existing game-state shape.
      scale: openingWidth,
    };
  });
}

export function pickMoleSlot(
  config: BoardConfig,
  previousSlotIndex: number | null,
  fitMode: SceneFitMode = DEFAULT_SCENE_FIT_MODE,
): MoleSlot {
  const slots = getMoleSlots(config, fitMode);
  const choices = slots.filter(slot => slot.slotIndex !== previousSlotIndex);
  return choices[Math.floor(Math.random() * choices.length)] ?? slots[0];
}

export function isMoleVisible(mole: MoleState | null): boolean {
  return Boolean(mole && mole.animState !== 'hidden');
}
