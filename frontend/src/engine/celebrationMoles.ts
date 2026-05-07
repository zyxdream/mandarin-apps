import type { AttachmentMetadata, VisibleBBox } from './moleAttachment';

export interface CelebrationMoleStyle {
  id: string;
  texture: string;
  meta: AttachmentMetadata;
  scaleBias?: number;
}

function bbox(left: number, top: number, right: number, bottom: number): VisibleBBox {
  return {
    left,
    top,
    right,
    bottom,
    width: right - left,
    height: bottom - top,
  };
}

function meta(visibleBBox: VisibleBBox, bodyBBox: VisibleBBox): AttachmentMetadata {
  return {
    canvasWidth: 1254,
    canvasHeight: 1254,
    visibleBBox,
    rimContactX: bodyBBox.left,
    rimContactY: bodyBBox.bottom,
    fitWidthPx: bodyBBox.width,
    bodyBBox,
    bodyLeftBottomX: bodyBBox.left,
    bodyBottomY: bodyBBox.bottom,
    bodyOpeningFillRatio: 1.12,
    bodyBottomOverlapPxRatio: 0.045,
  };
}

export const CELEBRATION_MOLE_STYLES: CelebrationMoleStyle[] = [
  {
    id: 'happy-ending-1',
    texture: '/assets/characters/moles/happy_ending_mole_1.png',
    meta: meta(bbox(245, 208, 1145, 936), bbox(245, 208, 735, 936)),
    scaleBias: 1.04,
  },
  {
    id: 'happy-ending-2',
    texture: '/assets/characters/moles/happy_ending_mole_2.png',
    meta: meta(bbox(233, 152, 1056, 1029), bbox(233, 218, 735, 1029)),
    scaleBias: 1,
  },
  {
    id: 'happy-ending-3',
    texture: '/assets/characters/moles/happy_ending_mole_3.png',
    meta: meta(bbox(182, 223, 1052, 1035), bbox(182, 223, 708, 1035)),
    scaleBias: 1.02,
  },
];
