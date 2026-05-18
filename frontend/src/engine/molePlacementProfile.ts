export interface MolePlacementProfile {
  sizeMultiplier: number;
  leftOverhangRatio: number;
  leftOverhangMinPx: number;
  leftOverhangMaxPx: number;
  downNudgePx: number;
}

export interface ResolveMoleAnchoredPositionInput {
  darkLeftX: number;
  baseBodyBottomY: number;
  openingWidth: number;
  canvasWidth: number;
  canvasHeight: number;
  bodyBBoxLeft: number;
  bodyBBoxBottom: number;
  bodyLeftBottomX?: number;
  bodyBottomY?: number;
  renderScaleX: number;
  renderScaleY: number;
  profile: MolePlacementProfile;
  extraLeftNudgePx?: number;
}

export interface ResolvedMoleAnchoredPosition {
  x: number;
  y: number;
  leftOverhangPx: number;
}

export interface GameplaySlotPlacementOverride {
  scaleMultiplier: number;
  extraLeftNudgePx: number;
}

export const GAMEPLAY_MOLE_PLACEMENT_PROFILE: MolePlacementProfile = {
  sizeMultiplier: 1.04,
  leftOverhangRatio: 0.03,
  leftOverhangMinPx: 2,
  leftOverhangMaxPx: 6,
  downNudgePx: 0,
};

export const FEASTING_MOLE_PLACEMENT_PROFILE: MolePlacementProfile = {
  sizeMultiplier: 1.04,
  leftOverhangRatio: 0.03,
  leftOverhangMinPx: 2,
  leftOverhangMaxPx: 6,
  downNudgePx: 4,
};

const DEFAULT_GAMEPLAY_SLOT_OVERRIDE: GameplaySlotPlacementOverride = {
  scaleMultiplier: 1,
  extraLeftNudgePx: 0,
};

const GAMEPLAY_SLOT_OVERRIDES: Record<number, GameplaySlotPlacementOverride> = {
  0: {
    scaleMultiplier: 1.18,
    extraLeftNudgePx: 0,
  },
  1: {
    scaleMultiplier: 1.29,
    extraLeftNudgePx: 0,
  },
  2: {
    scaleMultiplier: 1.41,
    extraLeftNudgePx: 0,
  },
  3: {
    scaleMultiplier: 1.33,
    extraLeftNudgePx: 0,
  },
  4: {
    scaleMultiplier: 1.31,
    extraLeftNudgePx: 0,
  },
};

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  if (max < min) return (min + max) / 2;
  return Math.min(max, Math.max(min, value));
}

export function resolveMoleLeftOverhangPx(openingWidth: number, profile: MolePlacementProfile): number {
  return clamp(
    openingWidth * profile.leftOverhangRatio,
    profile.leftOverhangMinPx,
    profile.leftOverhangMaxPx,
  );
}

export function resolveMoleAnchoredPosition(
  input: ResolveMoleAnchoredPositionInput,
): ResolvedMoleAnchoredPosition {
  const leftOverhangPx = resolveMoleLeftOverhangPx(input.openingWidth, input.profile);
  const bodyLeftBottomX = input.bodyLeftBottomX ?? input.bodyBBoxLeft;
  const bodyBottomY = input.bodyBottomY ?? input.bodyBBoxBottom;
  const extraLeftNudgePx = Math.max(0, input.extraLeftNudgePx ?? 0);

  const x = input.darkLeftX
    - (bodyLeftBottomX - input.canvasWidth / 2) * input.renderScaleX
    - leftOverhangPx
    - extraLeftNudgePx;
  const y = input.baseBodyBottomY
    + (input.canvasHeight - bodyBottomY) * input.renderScaleY
    + input.profile.downNudgePx;

  return {
    x,
    y,
    leftOverhangPx,
  };
}

export function resolveGameplaySlotPlacementOverride(slotIndex: number): GameplaySlotPlacementOverride {
  return GAMEPLAY_SLOT_OVERRIDES[slotIndex] ?? DEFAULT_GAMEPLAY_SLOT_OVERRIDE;
}
