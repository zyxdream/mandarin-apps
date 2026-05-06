export interface VisibleBBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export interface AttachmentMetadata {
  canvasWidth: number;
  canvasHeight: number;
  visibleBBox: VisibleBBox;
  rimContactX: number;
  rimContactY: number;
  fitWidthPx: number;
  bodyFitWidthPx?: number;
  bodyBBox?: VisibleBBox;
  bodyLeftBottomX?: number;
  bodyBottomY?: number;
  bodyOpeningFillRatio?: number;
  bodyBottomOverlapPxRatio?: number;
}

export interface HolePlacement {
  centerX: number;
  rimY: number;
  openingWidth: number;
}

export interface AttachedTransform {
  x: number;
  y: number;
  scale: number;
}

export interface DarkOpeningPlacement {
  darkLeftX: number;
  darkRightX: number;
  darkBackY: number;
  darkFrontY: number;
}

export interface BodyAnchoredTransform extends AttachedTransform {
  bodyLeftX: number;
  bodyRightX: number;
  bodyTopY: number;
  bodyBottomY: number;
  bodyWidth: number;
  bodyHeight: number;
}

export interface OpeningShadowBounds {
  centerX: number;
  centerY: number;
  width: number;
  height: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
}

const BODY_OPENING_COVERAGE = 1.08;
const MAX_BODY_FIT_SCALE_BOOST = 1.35;
const BODY_BOTTOM_OVERLAP_RATIO = 0.04;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function computeAttachedMoleTransform(
  hole: HolePlacement,
  metadata: AttachmentMetadata,
  scaleBias = 1,
): AttachedTransform {
  const safeFitWidth = Math.max(1, metadata.fitWidthPx);
  const safeScaleBias = Math.max(0.01, scaleBias);
  const openingWidth = Math.max(1, hole.openingWidth);

  const legacyScale = openingWidth / safeFitWidth;
  const bodyFitScale = metadata.bodyFitWidthPx
    ? (openingWidth * BODY_OPENING_COVERAGE) / Math.max(1, metadata.bodyFitWidthPx)
    : legacyScale;
  const scale = Math.min(bodyFitScale, legacyScale * MAX_BODY_FIT_SCALE_BOOST) * safeScaleBias;

  const contactOffsetX = (metadata.rimContactX - metadata.canvasWidth / 2) * scale;
  const belowContactPx = (metadata.canvasHeight - metadata.rimContactY) * scale;

  return {
    x: hole.centerX - contactOffsetX,
    y: hole.rimY + belowContactPx,
    scale,
  };
}

export function computeBodyAnchoredMoleTransform(
  hole: DarkOpeningPlacement,
  metadata: AttachmentMetadata,
  scaleBias = 1,
): BodyAnchoredTransform {
  const bodyBBox = metadata.bodyBBox ?? metadata.visibleBBox;
  const openingWidth = Math.max(1, hole.darkRightX - hole.darkLeftX);
  const openingHeight = Math.max(1, hole.darkFrontY - hole.darkBackY);
  const fillRatio = metadata.bodyOpeningFillRatio ?? BODY_OPENING_COVERAGE;
  const overlapRatio = metadata.bodyBottomOverlapPxRatio ?? BODY_BOTTOM_OVERLAP_RATIO;
  const safeScaleBias = Math.max(0.01, scaleBias);
  const scale = ((openingWidth * fillRatio) / Math.max(1, bodyBBox.width)) * safeScaleBias;
  const bodyLeftBottomX = metadata.bodyLeftBottomX ?? bodyBBox.left;
  const bodyBottomY = metadata.bodyBottomY ?? bodyBBox.bottom;
  const targetBodyLeftX = hole.darkLeftX;
  const targetBodyBottomY = hole.darkFrontY + openingHeight * overlapRatio;

  const x = targetBodyLeftX - (bodyLeftBottomX - metadata.canvasWidth / 2) * scale;
  const y = targetBodyBottomY + (metadata.canvasHeight - bodyBottomY) * scale;
  const bodyLeftX = x + (bodyBBox.left - metadata.canvasWidth / 2) * scale;
  const bodyRightX = x + (bodyBBox.right - metadata.canvasWidth / 2) * scale;
  const bodyTopY = y - (metadata.canvasHeight - bodyBBox.top) * scale;
  const solvedBodyBottomY = y - (metadata.canvasHeight - bodyBBox.bottom) * scale;

  return {
    x,
    y,
    scale,
    bodyLeftX,
    bodyRightX,
    bodyTopY,
    bodyBottomY: solvedBodyBottomY,
    bodyWidth: bodyRightX - bodyLeftX,
    bodyHeight: solvedBodyBottomY - bodyTopY,
  };
}

export function computeBodyOpeningShadowBounds(
  hole: DarkOpeningPlacement,
  body: BodyAnchoredTransform,
  shadowScale = 1,
): OpeningShadowBounds {
  const openingWidth = Math.max(1, hole.darkRightX - hole.darkLeftX);
  const openingHeight = Math.max(1, hole.darkFrontY - hole.darkBackY);
  const width = Math.min(openingWidth * 0.82, body.bodyWidth * 0.62) * Math.max(0.01, shadowScale);
  const height = Math.min(openingHeight * 0.45, Math.max(1, body.bodyHeight * 0.12));
  const safeWidth = Math.min(width, openingWidth * 0.9);
  const safeHeight = Math.min(height, openingHeight * 0.7);
  const projectedCenterX = body.bodyLeftX + body.bodyWidth * 0.54 + openingWidth * 0.08;
  const projectedCenterY = hole.darkFrontY - openingHeight * 0.22 + openingHeight * 0.08;
  const centerX = clamp(projectedCenterX, hole.darkLeftX + safeWidth / 2, hole.darkRightX - safeWidth / 2);
  const centerY = clamp(projectedCenterY, hole.darkBackY + safeHeight / 2, hole.darkFrontY - safeHeight / 2);

  return {
    centerX,
    centerY,
    width: safeWidth,
    height: safeHeight,
    left: centerX - safeWidth / 2,
    right: centerX + safeWidth / 2,
    top: centerY - safeHeight / 2,
    bottom: centerY + safeHeight / 2,
  };
}

export function spriteWorldRect(transform: AttachedTransform, metadata: AttachmentMetadata) {
  const width = metadata.canvasWidth * transform.scale;
  const height = metadata.canvasHeight * transform.scale;
  return {
    left: transform.x - width / 2,
    top: transform.y - height,
    width,
    height,
  };
}
