export interface OverlayPoint {
  x: number;
  y: number;
}

export interface OverlayRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
}

export interface ActiveMoleOverlayLayout {
  wordId: string;
  moleRef: OverlayPoint & { slotIndex: number };
  boardKeepoutRect: OverlayRect;
  moleBodyRect: OverlayRect;
}

export interface OverlaySize {
  width: number;
  height: number;
}

export type OverlayPlacementStrategy = 'top_center' | 'side_left' | 'side_right' | 'fallback';

export interface ResolveRewardHintPlacementInput {
  viewportWidth: number;
  viewportHeight: number;
  moleRef: OverlayPoint;
  boardKeepoutRect: OverlayRect;
  moleBodyRect: OverlayRect;
  rewardSize: OverlaySize;
  hintSize: OverlaySize;
  safeMarginPx?: number;
  keepoutGapPx?: number;
  stackGapPx?: number;
  sideGapPx?: number;
}

export interface ResolveRewardHintPlacementResult {
  strategy: OverlayPlacementStrategy;
  rewardAnchor: OverlayPoint;
  hintAnchor: OverlayPoint;
}

export interface AnchorBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export interface ResolveLegacyBaoziAnchorInput {
  baseAnchor: OverlayPoint;
  rewardSize: OverlaySize;
  boardKeepoutRect: OverlayRect;
  anchorBounds: AnchorBounds;
  overlapGapPx?: number;
}

export interface ResolveBaoziLinkedHintTopInput {
  rewardAnchorY: number;
  rewardHeight: number;
  hintHeight: number;
  tightGapPx: number;
  minTop: number;
  maxTop: number;
  moleY?: number;
  moleClearancePx?: number;
}

export interface ResolveBaoziRewardXInput {
  hitX: number;
  moleX: number;
  minX: number;
  maxX: number;
  rightShiftPx: number;
  leftOfMoleGapPx: number;
}

export type IncorrectHintPlacementStrategy =
  | 'right_above'
  | 'right_center'
  | 'right_below'
  | 'fallback';

export interface ResolveIncorrectHintPlacementInput {
  viewportWidth: number;
  viewportHeight: number;
  boardKeepoutRect: OverlayRect;
  moleBodyRect: OverlayRect;
  hintSize: OverlaySize;
  safeMarginPx?: number;
  sideGapPx?: number;
  verticalStepPx?: number;
  minHintWidthPx?: number;
}

export interface ResolveIncorrectHintPlacementResult {
  strategy: IncorrectHintPlacementStrategy;
  hintLeft: number;
  hintTop: number;
  hintWidth: number;
}

const DEFAULT_SAFE_MARGIN_PX = 16;
const DEFAULT_KEEPOUT_GAP_PX = 16;
const DEFAULT_STACK_GAP_PX = 14;
const DEFAULT_SIDE_GAP_PX = 24;
const DEFAULT_BOARD_OVERLAP_GAP_PX = 10;
const DEFAULT_BAOZI_HINT_MOLE_CLEARANCE_PX = 6;
const DEFAULT_INCORRECT_HINT_MIN_WIDTH_PX = 132;
const DEFAULT_INCORRECT_HINT_VERTICAL_STEP_PX = 22;

interface Candidate {
  strategy: 'top_center' | 'side_left' | 'side_right';
  desiredCenterX: number;
  desiredCenterY: number;
}

interface UnitPlacement {
  centerX: number;
  centerY: number;
  unitRect: OverlayRect;
  rewardAnchor: OverlayPoint;
  hintAnchor: OverlayPoint;
}

interface CandidateEvaluation {
  candidate: Candidate;
  placement: UnitPlacement;
  valid: boolean;
  score: number;
}

interface IncorrectHintCandidate {
  strategy: Exclude<IncorrectHintPlacementStrategy, 'fallback'>;
  verticalRank: 0 | 1 | 2;
}

interface IncorrectHintCandidateEvaluation {
  candidate: IncorrectHintCandidate;
  left: number;
  top: number;
  width: number;
  noMoleOverlap: boolean;
  score: number;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  if (max < min) return (min + max) / 2;
  return Math.min(max, Math.max(min, value));
}

function rectFromEdges(left: number, top: number, right: number, bottom: number): OverlayRect {
  const width = Math.max(0, right - left);
  const height = Math.max(0, bottom - top);
  return {
    left,
    top,
    right,
    bottom,
    width,
    height,
    centerX: left + width / 2,
    centerY: top + height / 2,
  };
}

function rectFromCenter(centerX: number, centerY: number, width: number, height: number): OverlayRect {
  const halfW = Math.max(0, width / 2);
  const halfH = Math.max(0, height / 2);
  return rectFromEdges(centerX - halfW, centerY - halfH, centerX + halfW, centerY + halfH);
}

function rectFromAnchor(anchor: OverlayPoint, size: OverlaySize): OverlayRect {
  return rectFromCenter(anchor.x, anchor.y, size.width, size.height);
}

function unionRects(a: OverlayRect, b: OverlayRect): OverlayRect {
  return rectFromEdges(
    Math.min(a.left, b.left),
    Math.min(a.top, b.top),
    Math.max(a.right, b.right),
    Math.max(a.bottom, b.bottom),
  );
}

function intersectsRect(a: OverlayRect, b: OverlayRect, padding = 0): boolean {
  return !(
    a.right <= b.left - padding ||
    a.left >= b.right + padding ||
    a.bottom <= b.top - padding ||
    a.top >= b.bottom + padding
  );
}

function overlapArea(a: OverlayRect, b: OverlayRect): number {
  const overlapW = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
  const overlapH = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  return overlapW * overlapH;
}

function placeUnitCandidate(
  candidate: Candidate,
  unitWidth: number,
  unitHeight: number,
  rewardHeight: number,
  hintHeight: number,
  stackGapPx: number,
  viewportWidth: number,
  viewportHeight: number,
  safeMarginPx: number,
): UnitPlacement {
  const halfUnitW = unitWidth / 2;
  const halfUnitH = unitHeight / 2;
  const centerX = clamp(candidate.desiredCenterX, safeMarginPx + halfUnitW, viewportWidth - safeMarginPx - halfUnitW);
  const centerY = clamp(candidate.desiredCenterY, safeMarginPx + halfUnitH, viewportHeight - safeMarginPx - halfUnitH);
  const unitRect = rectFromCenter(centerX, centerY, unitWidth, unitHeight);
  const rewardAnchor = {
    x: centerX,
    y: unitRect.top + rewardHeight / 2,
  };
  const hintAnchor = {
    x: centerX,
    y: unitRect.top + rewardHeight + stackGapPx + hintHeight / 2,
  };
  return { centerX, centerY, unitRect, rewardAnchor, hintAnchor };
}

function isValidPlacement(
  strategy: Candidate['strategy'],
  placement: UnitPlacement,
  boardKeepoutRect: OverlayRect,
  moleBodyRect: OverlayRect,
  keepoutTop: number,
  keepoutGapPx: number,
): boolean {
  const noBoardOverlap = !intersectsRect(placement.unitRect, boardKeepoutRect);
  const noBodyOverlap = !intersectsRect(placement.unitRect, moleBodyRect);
  if (!noBoardOverlap || !noBodyOverlap) return false;
  if (strategy !== 'top_center') return true;
  return placement.unitRect.bottom <= keepoutTop - keepoutGapPx;
}

export function estimateBaoziOverlaySizes(viewportWidth: number): {
  rewardSize: OverlaySize;
  hintSize: OverlaySize;
} {
  const rewardWidth = clamp(viewportWidth * 0.22, 168, 286);
  const rewardHeight = rewardWidth * (2 / 3);
  const hintWidth = clamp(viewportWidth * 0.46, 220, Math.min(420, Math.max(220, viewportWidth - 32)));
  const hintHeight = 74;
  return {
    rewardSize: { width: rewardWidth, height: rewardHeight },
    hintSize: { width: hintWidth, height: hintHeight },
  };
}

export function resolveLegacyBaoziAnchorWithBoardGuard(
  input: ResolveLegacyBaoziAnchorInput,
): OverlayPoint {
  const overlapGapPx = input.overlapGapPx ?? DEFAULT_BOARD_OVERLAP_GAP_PX;
  const halfRewardWidth = input.rewardSize.width / 2;
  const halfRewardHeight = input.rewardSize.height / 2;
  const baseX = clamp(input.baseAnchor.x, input.anchorBounds.minX, input.anchorBounds.maxX);
  const baseY = clamp(input.baseAnchor.y, input.anchorBounds.minY, input.anchorBounds.maxY);

  let resolvedX = baseX;
  let resolvedY = baseY;
  let rewardRect = rectFromAnchor({ x: resolvedX, y: resolvedY }, input.rewardSize);
  if (!intersectsRect(rewardRect, input.boardKeepoutRect, overlapGapPx)) {
    return { x: resolvedX, y: resolvedY };
  }

  const minYBelowBoard = input.boardKeepoutRect.bottom + overlapGapPx + halfRewardHeight;
  resolvedY = clamp(Math.max(resolvedY, minYBelowBoard), input.anchorBounds.minY, input.anchorBounds.maxY);
  rewardRect = rectFromAnchor({ x: resolvedX, y: resolvedY }, input.rewardSize);
  if (!intersectsRect(rewardRect, input.boardKeepoutRect, overlapGapPx)) {
    return { x: resolvedX, y: resolvedY };
  }

  const leftCandidateX = clamp(
    input.boardKeepoutRect.left - overlapGapPx - halfRewardWidth,
    input.anchorBounds.minX,
    input.anchorBounds.maxX,
  );
  const rightCandidateX = clamp(
    input.boardKeepoutRect.right + overlapGapPx + halfRewardWidth,
    input.anchorBounds.minX,
    input.anchorBounds.maxX,
  );

  const candidateXs = [resolvedX, leftCandidateX, rightCandidateX];
  let bestX = resolvedX;
  let bestScore = Number.POSITIVE_INFINITY;

  for (const candidateX of candidateXs) {
    const candidateRect = rectFromAnchor({ x: candidateX, y: resolvedY }, input.rewardSize);
    const intersects = intersectsRect(candidateRect, input.boardKeepoutRect, overlapGapPx);
    const overlap = overlapArea(candidateRect, input.boardKeepoutRect);
    const drift = Math.abs(candidateX - baseX);
    const score = (intersects ? 1_000_000 : 0) + overlap * 100 + drift;
    if (score < bestScore) {
      bestScore = score;
      bestX = candidateX;
    }
  }

  return { x: bestX, y: resolvedY };
}

export function resolveBaoziLinkedHintTop(
  input: ResolveBaoziLinkedHintTopInput,
): number {
  const rewardBottom = input.rewardAnchorY + input.rewardHeight / 2;
  let hintTop = rewardBottom + input.tightGapPx;

  if (Number.isFinite(input.moleY)) {
    const moleCapTop = (input.moleY as number) - input.hintHeight - (
      input.moleClearancePx ?? DEFAULT_BAOZI_HINT_MOLE_CLEARANCE_PX
    );
    hintTop = Math.min(hintTop, moleCapTop);
  }

  return clamp(hintTop, input.minTop, input.maxTop);
}

export function resolveBaoziRewardX(input: ResolveBaoziRewardXInput): number {
  const baseX = clamp(input.hitX, input.minX, input.maxX);
  const leftOfMoleMaxX = clamp(input.moleX - input.leftOfMoleGapPx, input.minX, input.maxX);
  return clamp(baseX + input.rightShiftPx, input.minX, leftOfMoleMaxX);
}

function rankForStrategy(strategy: IncorrectHintPlacementStrategy): number {
  if (strategy.endsWith('_above')) return 0;
  if (strategy.endsWith('_center')) return 1;
  return 2;
}

function placeIncorrectHintCandidate(
  candidate: IncorrectHintCandidate,
  input: ResolveIncorrectHintPlacementInput,
  safeMarginPx: number,
  sideGapPx: number,
  verticalStepPx: number,
  minHintWidthPx: number,
): IncorrectHintCandidateEvaluation {
  const safeRight = input.viewportWidth - safeMarginPx;
  const laneLeft = input.boardKeepoutRect.right + sideGapPx;
  const availableRightLane = Math.max(0, safeRight - laneLeft);
  const preferredWidth = Math.max(0, input.hintSize.width);
  const minReadableWidth = Math.min(minHintWidthPx, availableRightLane);
  const width = availableRightLane <= 0
    ? 0
    : clamp(preferredWidth, minReadableWidth, availableRightLane);
  const centerTop = input.boardKeepoutRect.centerY - input.hintSize.height / 2;
  const desiredTop = centerTop + (
    candidate.verticalRank === 0
      ? -verticalStepPx
      : candidate.verticalRank === 2
        ? verticalStepPx
        : 0
  );
  const top = clamp(
    desiredTop,
    safeMarginPx,
    Math.max(safeMarginPx, input.viewportHeight - safeMarginPx - input.hintSize.height),
  );

  const left = laneLeft;
  const right = left + width;
  const rect = rectFromEdges(left, top, right, top + input.hintSize.height);
  const moleOverlap = overlapArea(rect, input.moleBodyRect);
  const noMoleOverlap = moleOverlap === 0;
  const verticalPenalty = candidate.verticalRank * 8;
  const shrinkPenalty = Math.max(0, preferredWidth - width) * 0.36;
  const zeroWidthPenalty = width <= 0 ? 1_000_000 : 0;
  const molePenalty = moleOverlap * 12;
  const score = zeroWidthPenalty + molePenalty + verticalPenalty + shrinkPenalty;

  return {
    candidate,
    left,
    top,
    width,
    noMoleOverlap,
    score,
  };
}

export function resolveIncorrectHintPlacement(
  input: ResolveIncorrectHintPlacementInput,
): ResolveIncorrectHintPlacementResult {
  const safeMarginPx = input.safeMarginPx ?? DEFAULT_SAFE_MARGIN_PX;
  const sideGapPx = input.sideGapPx ?? DEFAULT_SIDE_GAP_PX;
  const verticalStepPx = input.verticalStepPx ?? DEFAULT_INCORRECT_HINT_VERTICAL_STEP_PX;
  const minHintWidthPx = input.minHintWidthPx ?? DEFAULT_INCORRECT_HINT_MIN_WIDTH_PX;

  const candidates: IncorrectHintCandidate[] = [
    { strategy: 'right_above', verticalRank: 0 },
    { strategy: 'right_center', verticalRank: 1 },
    { strategy: 'right_below', verticalRank: 2 },
  ];

  const evaluated = candidates.map(candidate => placeIncorrectHintCandidate(
    candidate,
    input,
    safeMarginPx,
    sideGapPx,
    verticalStepPx,
    minHintWidthPx,
  ));

  const chooseBest = (pool: IncorrectHintCandidateEvaluation[]): IncorrectHintCandidateEvaluation | null => {
    if (pool.length === 0) return null;
    return [...pool].sort((a, b) => {
      if (a.noMoleOverlap !== b.noMoleOverlap) return a.noMoleOverlap ? -1 : 1;
      if (a.score !== b.score) return a.score - b.score;
      return rankForStrategy(a.candidate.strategy) - rankForStrategy(b.candidate.strategy);
    })[0] ?? null;
  };

  const bestRight = chooseBest(evaluated);
  if (bestRight) {
    return {
      strategy: bestRight.candidate.strategy,
      hintLeft: Math.round(bestRight.left),
      hintTop: bestRight.top,
      hintWidth: Math.round(bestRight.width),
    };
  }

  const fallbackLeft = Math.round(input.boardKeepoutRect.right + sideGapPx);
  const fallbackWidth = Math.max(0, Math.round(input.viewportWidth - safeMarginPx - fallbackLeft));
  return {
    strategy: 'fallback',
    hintLeft: fallbackLeft,
    hintTop: Math.round(clamp(
      input.boardKeepoutRect.centerY - input.hintSize.height / 2,
      safeMarginPx,
      Math.max(safeMarginPx, input.viewportHeight - safeMarginPx - input.hintSize.height),
    )),
    hintWidth: fallbackWidth,
  };
}

export function resolveRewardHintPlacement(
  input: ResolveRewardHintPlacementInput,
): ResolveRewardHintPlacementResult {
  const safeMarginPx = input.safeMarginPx ?? DEFAULT_SAFE_MARGIN_PX;
  const keepoutGapPx = input.keepoutGapPx ?? DEFAULT_KEEPOUT_GAP_PX;
  const stackGapPx = input.stackGapPx ?? DEFAULT_STACK_GAP_PX;
  const sideGapPx = input.sideGapPx ?? DEFAULT_SIDE_GAP_PX;

  const unitWidth = Math.max(input.rewardSize.width, input.hintSize.width);
  const unitHeight = input.rewardSize.height + stackGapPx + input.hintSize.height;
  const keepoutUnion = unionRects(input.boardKeepoutRect, input.moleBodyRect);
  const keepoutTop = Math.min(input.boardKeepoutRect.top, input.moleBodyRect.top);
  const preferredUnitBottom = keepoutTop - keepoutGapPx;
  const preferredCenterY = preferredUnitBottom - unitHeight / 2;

  const candidates: Candidate[] = [
    {
      strategy: 'top_center',
      desiredCenterX: input.moleRef.x,
      desiredCenterY: preferredCenterY,
    },
    {
      strategy: 'side_left',
      desiredCenterX: keepoutUnion.left - sideGapPx - unitWidth / 2,
      desiredCenterY: preferredCenterY,
    },
    {
      strategy: 'side_right',
      desiredCenterX: keepoutUnion.right + sideGapPx + unitWidth / 2,
      desiredCenterY: preferredCenterY,
    },
  ];

  const evaluateCandidate = (candidate: Candidate): CandidateEvaluation => {
    const placement = placeUnitCandidate(
      candidate,
      unitWidth,
      unitHeight,
      input.rewardSize.height,
      input.hintSize.height,
      stackGapPx,
      input.viewportWidth,
      input.viewportHeight,
      safeMarginPx,
    );

    const valid = isValidPlacement(
      candidate.strategy,
      placement,
      input.boardKeepoutRect,
      input.moleBodyRect,
      keepoutTop,
      keepoutGapPx,
    );
    const xPenalty = Math.abs(placement.centerX - candidate.desiredCenterX) * 0.45;
    const yPenalty = Math.abs(placement.centerY - candidate.desiredCenterY) * 0.2;
    const overlapPenalty =
      overlapArea(placement.unitRect, input.boardKeepoutRect) +
      overlapArea(placement.unitRect, input.moleBodyRect);
    const strategyPenalty = candidate.strategy === 'top_center' ? 0 : 12;
    return {
      candidate,
      placement,
      valid,
      score: overlapPenalty * 100 + xPenalty + yPenalty + strategyPenalty,
    };
  };

  const evaluated = candidates.map(candidate => evaluateCandidate(candidate));
  const topCenter = evaluated[0];
  if (topCenter?.valid) {
    return {
      strategy: 'top_center',
      rewardAnchor: topCenter.placement.rewardAnchor,
      hintAnchor: topCenter.placement.hintAnchor,
    };
  }

  const bestValidSide = evaluated
    .slice(1)
    .filter(entry => entry.valid)
    .sort((a, b) => a.score - b.score)[0];
  if (bestValidSide) {
    return {
      strategy: bestValidSide.candidate.strategy,
      rewardAnchor: bestValidSide.placement.rewardAnchor,
      hintAnchor: bestValidSide.placement.hintAnchor,
    };
  }

  let bestFallback: CandidateEvaluation | null = null;
  for (const entry of evaluated) {
    if (!bestFallback || entry.score < bestFallback.score) {
      bestFallback = entry;
    }
  }

  const fallbackPlacement = bestFallback?.placement ?? placeUnitCandidate(
    candidates[0],
    unitWidth,
    unitHeight,
    input.rewardSize.height,
    input.hintSize.height,
    stackGapPx,
    input.viewportWidth,
    input.viewportHeight,
    safeMarginPx,
  );

  return {
    strategy: 'fallback',
    rewardAnchor: fallbackPlacement.rewardAnchor,
    hintAnchor: fallbackPlacement.hintAnchor,
  };
}
