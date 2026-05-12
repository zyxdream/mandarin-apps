import type { AttachmentMetadata, VisibleBBox } from './moleAttachment';

interface AttachmentDefinition {
  texture: string;
  meta: AttachmentMetadata;
}

interface BodyAnchorOptions {
  bodyBBox: VisibleBBox;
  bodyLeftBottomX?: number;
  bodyBottomY?: number;
  bodyOpeningFillRatio?: number;
  bodyBottomOverlapPxRatio?: number;
}

export interface MoleCharacterAttachmentStyle {
  id: string;
  hold: AttachmentDefinition;
  miss: AttachmentDefinition;
  textAnchorX: number;
  pinyinY: number;
  hanziY: number;
  textScale?: number;
  scaleBias?: number;
  contactShadowScale?: number;
  idleBobAmp?: number;
  wobbleAmp?: number;
  hitSquash?: number;
  escapeSinkBias?: number;
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

function attachment(
  visibleBBox: VisibleBBox,
  rimContactX: number,
  rimContactY: number,
  fitWidthPx: number,
  bodyFitWidthPx?: number,
  bodyOptions?: BodyAnchorOptions,
): AttachmentMetadata {
  const meta: AttachmentMetadata = {
    canvasWidth: 1254,
    canvasHeight: 1254,
    visibleBBox,
    rimContactX,
    rimContactY,
    fitWidthPx,
  };

  if (bodyFitWidthPx) {
    meta.bodyFitWidthPx = bodyFitWidthPx;
  }

  if (bodyOptions) {
    meta.bodyBBox = bodyOptions.bodyBBox;
    meta.bodyLeftBottomX = bodyOptions.bodyLeftBottomX ?? bodyOptions.bodyBBox.left;
    meta.bodyBottomY = bodyOptions.bodyBottomY ?? bodyOptions.bodyBBox.bottom;
    if (bodyOptions.bodyOpeningFillRatio !== undefined) {
      meta.bodyOpeningFillRatio = bodyOptions.bodyOpeningFillRatio;
    }
    if (bodyOptions.bodyBottomOverlapPxRatio !== undefined) {
      meta.bodyBottomOverlapPxRatio = bodyOptions.bodyBottomOverlapPxRatio;
    }
  }

  return meta;
}

const BODY_ANCHORS = {
  angryHold: { bodyBBox: bbox(222, 334, 692, 1004) },
  angryMiss: { bodyBBox: bbox(168, 228, 688, 1110) },
  coolHold: { bodyBBox: bbox(208, 270, 638, 1030) },
  coolMiss: { bodyBBox: bbox(150, 236, 650, 1060) },
  dizzyHold: { bodyBBox: bbox(248, 342, 698, 966) },
  dizzyMiss: { bodyBBox: bbox(190, 252, 710, 998) },
  eyebrowHold: { bodyBBox: bbox(212, 250, 682, 1118) },
  eyebrowMiss: { bodyBBox: bbox(224, 174, 724, 1114) },
  hatHold: { bodyBBox: bbox(170, 274, 660, 1028) },
  hatMiss: { bodyBBox: bbox(156, 250, 676, 1030) },
  hit: { bodyBBox: bbox(232, 250, 722, 1036) },
} satisfies Record<string, BodyAnchorOptions>;

export const MOLE_CHARACTER_STYLES: MoleCharacterAttachmentStyle[] = [
  {
    id: 'angry',
    hold: {
      texture: '/assets/characters/moles/angry_mole_holding.v2.webp',
      meta: attachment(bbox(172, 113, 1071, 992), 624, 944, 730, 470, BODY_ANCHORS.angryHold),
    },
    miss: {
      texture: '/assets/characters/moles/angry_mole_after_hit.v2.webp',
      meta: attachment(bbox(100, 78, 1158, 1105), 628, 944, 860, 520, BODY_ANCHORS.angryMiss),
    },
    textAnchorX: 4,
    pinyinY: -520,
    hanziY: -446,
    scaleBias: 1,
    contactShadowScale: 1.08,
    idleBobAmp: 3.8,
    wobbleAmp: 0.038,
    hitSquash: 0.9,
    escapeSinkBias: 1.08,
  },
  {
    id: 'cool',
    hold: {
      texture: '/assets/characters/moles/cool_mole_holding.v2.webp',
      meta: attachment(bbox(162, 150, 1168, 1024), 443, 944, 520, 430, BODY_ANCHORS.coolHold),
    },
    miss: {
      texture: '/assets/characters/moles/cool_mole_after_hit.v2.webp',
      meta: attachment(bbox(123, 138, 1179, 1055), 436, 944, 700, 500, BODY_ANCHORS.coolMiss),
    },
    textAnchorX: 256,
    pinyinY: -904,
    hanziY: -832,
    textScale: 0.96,
    scaleBias: 1,
    contactShadowScale: 0.92,
    idleBobAmp: 2.6,
    wobbleAmp: 0.024,
    hitSquash: 0.95,
    escapeSinkBias: 1.02,
  },
  {
    id: 'dizzy',
    hold: {
      texture: '/assets/characters/moles/dizzy_mole_holding.v2.webp',
      meta: attachment(bbox(156, 206, 1167, 962), 662, 944, 560, 450, BODY_ANCHORS.dizzyHold),
    },
    miss: {
      texture: '/assets/characters/moles/dizzy_mole_after_hit.v2.webp',
      meta: attachment(bbox(144, 149, 1196, 994), 667, 944, 760, 520, BODY_ANCHORS.dizzyMiss),
    },
    textAnchorX: 214,
    pinyinY: -564,
    hanziY: -488,
    scaleBias: 1,
    contactShadowScale: 1.02,
    idleBobAmp: 3.3,
    wobbleAmp: 0.032,
    hitSquash: 0.92,
    escapeSinkBias: 1.05,
  },
  {
    id: 'eyebrow',
    hold: {
      texture: '/assets/characters/moles/grey_eyebrow_mole_holding.v2.webp',
      meta: attachment(bbox(153, 98, 1228, 1222), 510, 944, 730, 470, BODY_ANCHORS.eyebrowHold),
    },
    miss: {
      texture: '/assets/characters/moles/gray_eyebrow_mole_on_hit.v2.webp',
      meta: attachment(bbox(174, 63, 1205, 1111), 511, 944, 700, 500, BODY_ANCHORS.eyebrowMiss),
    },
    textAnchorX: 262,
    pinyinY: -1008,
    hanziY: -936,
    textScale: 0.96,
    scaleBias: 1,
    contactShadowScale: 0.97,
    idleBobAmp: 2.8,
    wobbleAmp: 0.026,
    hitSquash: 0.94,
    escapeSinkBias: 1.03,
  },
  {
    id: 'hat',
    hold: {
      texture: '/assets/characters/moles/hat_mole_holding.v2.webp',
      meta: attachment(bbox(78, 180, 1161, 1024), 634, 944, 680, 470, BODY_ANCHORS.hatHold),
    },
    miss: {
      texture: '/assets/characters/moles/hat_mole_after_hit.v2.webp',
      meta: attachment(bbox(74, 183, 1164, 1027), 616, 944, 740, 520, BODY_ANCHORS.hatMiss),
    },
    textAnchorX: 248,
    pinyinY: -756,
    hanziY: -684,
    scaleBias: 1,
    contactShadowScale: 1.04,
    idleBobAmp: 3.5,
    wobbleAmp: 0.034,
    hitSquash: 0.91,
    escapeSinkBias: 1.06,
  },
];

export const HIT_TEXTURE = '/assets/characters/moles/all_mole_on_hit.v2.webp';
export const HIT_TEXTURE_ATTACHMENT = attachment(bbox(198, 171, 1035, 1034), 619, 944, 640, 480, BODY_ANCHORS.hit);
