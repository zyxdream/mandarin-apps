import { Application, useApplication, useTick } from '@pixi/react';
import { Assets, Container, Graphics, Point, Sprite, Text, TextStyle, Texture } from 'pixi.js';
import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import type { GameState, MoleAnimState, MoleState } from '../types/game';
import {
  getMoleSlots,
  getSceneRenderRect,
} from '../engine/moleLayout';
import { DEFAULT_SCENE_FIT_MODE } from '../engine/sceneProjection';
import {
  computeBodyAnchoredMoleTransform,
  computeBodyOpeningShadowBounds,
  spriteWorldRect,
  type AttachmentMetadata,
} from '../engine/moleAttachment';
import {
  HIT_TEXTURE,
  HIT_TEXTURE_ATTACHMENT,
  MOLE_CHARACTER_STYLES,
  type MoleCharacterAttachmentStyle,
} from '../engine/moleAttachmentMetadata';

const BOARD_TEXT_FILL = 0xfff2c4;
const BOARD_TEXT_STROKE = 0x4a2c16;
const BOARD_TEXT_LINE_SPACING = 110;
const BOARD_PINYIN_MAX_WIDTH = 640;
const BOARD_HANZI_MAX_WIDTH = 580;
const HAMMER_BOARD_CLEARANCE_RATIO = 0.46;
const HAMMER_HEAD_CLEARANCE_RATIO = 0.08;
const HAMMER_ANGLE_JITTER = 0.12;
const HAMMER_EDGE_INSET_RATIO = 0.48;
const HAMMER_IDLE_MIN_Y_RATIO = 1.18;
const HAMMER_SIDE_JITTER_RATIO = 0.16;
const HAMMER_ANCHOR_X = 0.45;
const HAMMER_ANCHOR_Y = 0.22;
const HAMMER_TEXTURE_FALLBACK_SIZE = 1254;
const HAMMER_HEAD_SAFETY_POINTS = [
  { x: 0.29, y: 0.36 },
  { x: 0.34, y: 0.49 },
  { x: 0.45, y: 0.56 },
  { x: 0.58, y: 0.55 },
  { x: 0.71, y: 0.47 },
];

const BACKGROUND_TEXTURE = '/assets/backgrounds/grass_world_with_holes_expand.v2.webp';
const HAMMER_TEXTURE = '/assets/objects/hammer_right_transparent.v2.webp';
const HIT_EFFECT_TEXTURE = '/assets/effects/sparkle.v2.webp';
const MISS_EFFECT_TEXTURE = '/assets/effects/miss.v2.webp';

const MOLE_EMERGE_LIFT = 132;
const MOLE_EMERGE_FRAMES = 30;
const COLLECT_TARGET_Y = 84;
const HAMMER_SWING_DECAY = 0.024;
const HAMMER_HIT_FADE_START_FRAME = 34;
const HAMMER_HIT_HIDE_FRAME = 46;
const LISTENING_HAMMER_HOVER_PX = 6;
const LISTENING_HAMMER_LEAN_RAD = 0.09;
const HIT_EFFECT_FRAMES = 88;
const MISS_EFFECT_FRAMES = 76;
const HIT_SPARKLE_SIDE_OFFSET_RATIO = 0.16;
const HIT_SPARKLE_UP_OFFSET_RATIO = 0.1;
const HIT_SPARKLE_FACE_CLEAR_RATIO = 0.12;
const HIT_SPARKLE_BOARD_CLEAR_RATIO = 0.08;
const CONTACT_SHADOW_ALPHA = 0.18;
const MOLE_BACK_SHADOW_ALPHA = 0.22;
const MOLE_DEPTH_SHADE_ALPHA = 0.04;
const MOLE_DEPTH_HIGHLIGHT_ALPHA = 0.18;
const FRONT_RIM_SHADOW_ALPHA = 0.52;
const FRONT_RIM_HIGHLIGHT_ALPHA = 0.24;
const FOREGROUND_BLEND_ALPHA = 0.55;
const DEBUG_COLORS = {
  holeOval: 0x3bd4ff,
  backLip: 0x67d8ff,
  moleContact: 0x38f08b,
  frontLip: 0xff9f1c,
  shadowCenter: 0x9b8cff,
  holeCenter: 0xffffff,
  spriteBBox: 0xffe066,
  bodyContact: 0xff4f8b,
  bodyBBox: 0x7dff6a,
  shadowBBox: 0xb58cff,
  boardCenter: 0x35f3ff,
  impactPoint: 0xffd447,
  sparkleAnchor: 0xff7ae7,
  hammerSafe: 0xff6ad5,
  slotAnchor: 0xfff4a3,
};
const LAYOUT_DEBUG = (() => {
  const params = new URLSearchParams(window.location.search);
  return params.get('layoutDebug') === '1' || params.get('layoutDebug') === 'true';
})();

const PRELOAD_TEXTURES = [
  BACKGROUND_TEXTURE,
  HAMMER_TEXTURE,
  HIT_EFFECT_TEXTURE,
  MISS_EFFECT_TEXTURE,
  HIT_TEXTURE,
  ...MOLE_CHARACTER_STYLES.flatMap(style => [style.hold.texture, style.miss.texture]),
];

interface RendererProps {
  activeMole: MoleState | null;
  activeMoleRef: RefObject<MoleState | null>;
  volume: number;
}

interface GroundExtensionConfig {
  minHeightPx: number;
  blendHeightPx: number;
  textureStripNormY: number;
}

const GROUND_EXTENSION_CONFIG: GroundExtensionConfig = {
  minHeightPx: 72,
  blendHeightPx: 82,
  textureStripNormY: 0.91,
};

interface CollectFlyState {
  active: boolean;
  progress: number;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
}

interface HammerPlacementState {
  side: -1 | 1;
  idleJitterX: number;
  idleJitterY: number;
  angleBias: number;
}

interface HammerSafetyPoint {
  x: number;
  y: number;
}

function hashWord(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0);
}

function pickStyle(wordId: string): MoleCharacterAttachmentStyle {
  return MOLE_CHARACTER_STYLES[hashWord(wordId) % MOLE_CHARACTER_STYLES.length] ?? MOLE_CHARACTER_STYLES[0];
}

function pickHammerPlacement(wordId: string): HammerPlacementState {
  const hash = hashWord(`hammer:${wordId}`);
  return {
    side: hash % 2 === 0 ? 1 : -1,
    idleJitterX: (((hash >>> 3) % 100) / 100 - 0.5) * HAMMER_SIDE_JITTER_RATIO,
    idleJitterY: (((hash >>> 11) % 100) / 100 - 0.5) * HAMMER_SIDE_JITTER_RATIO,
    angleBias: (((hash >>> 19) % 100) / 100 - 0.5) * HAMMER_ANGLE_JITTER,
  };
}

function getHammerRotation(baseRotation: number, side: -1 | 1, angleBias: number) {
  const naturalRotation = Math.max(-0.95, Math.min(0.45, baseRotation + angleBias));
  return side * naturalRotation;
}

function getHammerSafetyPointWorld(
  anchorX: number,
  anchorY: number,
  scaleX: number,
  scaleY: number,
  rotation: number,
  textureWidth: number,
  textureHeight: number,
  point: HammerSafetyPoint,
) {
  const localX = (point.x - HAMMER_ANCHOR_X) * textureWidth * scaleX;
  const localY = (point.y - HAMMER_ANCHOR_Y) * textureHeight * scaleY;
  const sin = Math.sin(rotation);
  const cos = Math.cos(rotation);

  return {
    x: anchorX + localX * cos - localY * sin,
    y: anchorY + localX * sin + localY * cos,
  };
}

function getHammerLowestHeadPoint(
  anchorX: number,
  anchorY: number,
  scaleX: number,
  scaleY: number,
  rotation: number,
  textureWidth: number,
  textureHeight: number,
) {
  return HAMMER_HEAD_SAFETY_POINTS
    .map(point => getHammerSafetyPointWorld(anchorX, anchorY, scaleX, scaleY, rotation, textureWidth, textureHeight, point))
    .reduce((lowest, point) => (point.y > lowest.y ? point : lowest));
}

function getHammerSafeLift(
  anchorX: number,
  anchorY: number,
  scaleX: number,
  scaleY: number,
  rotation: number,
  textureWidth: number,
  textureHeight: number,
  openingWidth: number,
  keepoutTop: number,
  clearance: number,
) {
  const lowestHeadPoint = getHammerLowestHeadPoint(
    anchorX,
    anchorY,
    scaleX,
    scaleY,
    rotation,
    textureWidth,
    textureHeight,
  );
  const cornerClearance = Math.max(openingWidth * HAMMER_HEAD_CLEARANCE_RATIO, clearance * 0.18);
  return Math.max(0, lowestHeadPoint.y - (keepoutTop - cornerClearance));
}

function textureForState(animState: MoleAnimState, style: MoleCharacterAttachmentStyle): string {
  if (animState === 'hit') return HIT_TEXTURE;
  if (animState === 'retry' || animState === 'escaping') return style.miss.texture;
  return style.hold.texture;
}

function displayAttachmentForState(animState: MoleAnimState, style: MoleCharacterAttachmentStyle): AttachmentMetadata {
  if (animState === 'hit') return HIT_TEXTURE_ATTACHMENT;
  if (animState === 'retry' || animState === 'escaping') return style.miss.meta;
  return style.hold.meta;
}

function placementAttachmentForState(_animState: MoleAnimState, style: MoleCharacterAttachmentStyle): AttachmentMetadata {
  // Keep reaction frames locked to the holding pose so the body does not jump relative to the hole.
  return style.hold.meta;
}

function shouldShowSign(animState: MoleAnimState): boolean {
  return (
    animState === 'active' ||
    animState === 'listening' ||
    animState === 'emerging' ||
    animState === 'retry' ||
    animState === 'escaping'
  );
}

function easeInCubic(value: number) {
  return value * value * value;
}

function easeOutCubic(value: number) {
  return 1 - Math.pow(1 - value, 3);
}

function easeOutBack(value: number) {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(value - 1, 3) + c1 * Math.pow(value - 1, 2);
}

function motionValue(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) ? Number(value) : fallback;
}

function fittedTextScale(text: Text, baseScale: number, maxWidth: number): number {
  const currentScale = text.scale.x || 1;
  const unscaledWidth = text.width / currentScale;
  if (unscaledWidth <= 0) return baseScale;
  return baseScale * Math.min(1, maxWidth / unscaledWidth);
}

function drawDebugCross(
  graphics: Graphics,
  x: number,
  y: number,
  color: number,
  size = 8,
  width = 2,
) {
  graphics.stroke({ color, pixelLine: true, width });
  graphics.moveTo(x - size, y);
  graphics.lineTo(x + size, y);
  graphics.moveTo(x, y - size);
  graphics.lineTo(x, y + size);
}

function drawDebugDiamond(
  graphics: Graphics,
  x: number,
  y: number,
  color: number,
  size = 7,
) {
  graphics.stroke({ color, pixelLine: true, width: 2 });
  graphics.moveTo(x, y - size);
  graphics.lineTo(x + size, y);
  graphics.lineTo(x, y + size);
  graphics.lineTo(x - size, y);
  graphics.lineTo(x, y - size);
}

function drawSlotAnchors(graphics: Graphics, slots: ReturnType<typeof getMoleSlots>) {
  for (const slot of slots) {
    graphics.stroke({ color: DEBUG_COLORS.holeOval, pixelLine: true, width: 2 });
    graphics.ellipse(slot.darkCenterX, slot.darkCenterY, slot.openingWidth / 2, slot.openingHeight / 2);
    graphics.rect(slot.darkLeftX, slot.darkBackY, slot.openingWidth, slot.openingHeight);

    graphics.stroke({ color: DEBUG_COLORS.backLip, pixelLine: true, width: 2 });
    graphics.moveTo(slot.darkLeftX, slot.darkBackY);
    graphics.lineTo(slot.darkRightX, slot.darkBackY);

    graphics.stroke({ color: DEBUG_COLORS.moleContact, pixelLine: true, width: 2 });
    graphics.moveTo(slot.darkLeftX, slot.moleContactY);
    graphics.lineTo(slot.darkRightX, slot.moleContactY);

    graphics.stroke({ color: DEBUG_COLORS.frontLip, pixelLine: true, width: 2 });
    graphics.moveTo(slot.darkLeftX, slot.darkFrontY);
    graphics.lineTo(slot.darkRightX, slot.darkFrontY);

    graphics.circle(slot.darkCenterX, slot.darkCenterY, 3);
    graphics.fill({ color: DEBUG_COLORS.holeCenter, alpha: 0.9 });
    graphics.circle(slot.darkLeftX, slot.darkCenterY, 4);
    graphics.circle(slot.darkRightX, slot.darkCenterY, 4);
    graphics.fill({ color: DEBUG_COLORS.slotAnchor, alpha: 0.85 });
  }
}

function MoleRenderer({ activeMole, activeMoleRef, volume }: RendererProps) {
  const { app } = useApplication();

  const backgroundRef = useRef<Sprite | null>(null);
  const groundBlendRef = useRef<Graphics | null>(null);
  const holeOcclusionRef = useRef<Graphics | null>(null);
  const holeFrontRimRef = useRef<Graphics | null>(null);
  const contactShadowRef = useRef<Graphics | null>(null);
  const moleBackShadowRef = useRef<Graphics | null>(null);
  const moleDepthShadeRef = useRef<Graphics | null>(null);
  const moleHighlightRef = useRef<Graphics | null>(null);
  const moleContainerRef = useRef<Container | null>(null);
  const moleSpriteRef = useRef<Sprite | null>(null);
  const hammerSpriteRef = useRef<Sprite | null>(null);
  const hitEffectRef = useRef<Sprite | null>(null);
  const missEffectRef = useRef<Sprite | null>(null);
  const pinyinRef = useRef<Text | null>(null);
  const hanziRef = useRef<Text | null>(null);
  const reactionRef = useRef<Text | null>(null);
  const collectGlowRef = useRef<Sprite | null>(null);
  const collectWordRef = useRef<Text | null>(null);
  const debugGraphicsRef = useRef<Graphics | null>(null);
  const debugLegendRef = useRef<Text | null>(null);

  const animStateRef = useRef<MoleAnimState>('hidden');
  const animTickRef = useRef(0);
  const swingRef = useRef(0);
  const lastWordIdRef = useRef<string | null>(null);
  const lastStrikeIdRef = useRef(0);
  const lastSparkleStrikeIdRef = useRef<number | null>(null);
  const currentStyleRef = useRef<MoleCharacterAttachmentStyle>(MOLE_CHARACTER_STYLES[0]);
  const currentTexturePathRef = useRef('');
  const hammerPlacementRef = useRef<HammerPlacementState>({
    side: 1,
    idleJitterX: 0,
    idleJitterY: 0,
    angleBias: 0,
  });
  const volumeRef = useRef(volume);
  const stageSizeRef = useRef({ width: 0, height: 0 });
  const slotsRef = useRef<ReturnType<typeof getMoleSlots>>([]);
  const collectFlyRef = useRef<CollectFlyState>({
    active: false,
    progress: 0,
    startX: 0,
    startY: 0,
    endX: 0,
    endY: 0,
  });

  useEffect(() => {
    volumeRef.current = volume;
  }, [volume]);

  useEffect(() => {
    let disposed = false;

    async function setup() {
      try {
        await Assets.load(PRELOAD_TEXTURES);
      } catch {
        // Fall back to lazy loading if preload fails.
      }

      if (disposed) return;

      const background = new Sprite(Texture.from(BACKGROUND_TEXTURE));
      const groundBlend = new Graphics();
      const holeOcclusion = new Graphics();
      const holeFrontRim = new Graphics();
      const contactShadow = new Graphics();
      const moleBackShadow = new Graphics();
      const moleDepthShade = new Graphics();
      const moleHighlight = new Graphics();
      const moleContainer = new Container();
      const moleSprite = new Sprite(Texture.from(MOLE_CHARACTER_STYLES[0].hold.texture));
      const hammer = new Sprite(Texture.from(HAMMER_TEXTURE));
      const hitEffect = new Sprite(Texture.from(HIT_EFFECT_TEXTURE));
      const missEffect = new Sprite(Texture.from(MISS_EFFECT_TEXTURE));
      const collectGlow = new Sprite(Texture.from(HIT_EFFECT_TEXTURE));
      const debugGraphics = new Graphics();
      const debugLegend = new Text({
        text: [
          'layoutDebug anchors',
          'cyan oval = dark hole opening',
          'blue = dark back lip',
          'green = body bottom/contact line',
          'orange = dark front lip',
          'purple = derived shadow bounds',
          'pink cross = body left-bottom anchor',
          'lime box = mole body bbox',
          'cyan diamond = board/text center',
          'gold cross = hammer impact point',
          'pink diamond = hammer head safety bottom',
          'yellow box = visible sprite bbox',
        ].join('\n'),
        style: new TextStyle({
          fontFamily: 'Menlo, Consolas, monospace',
          fontSize: 13,
          fill: 0xffffff,
          stroke: { color: 0x14210f, width: 4 },
          lineHeight: 17,
        }),
      });

      const pinyin = new Text({
        text: '',
        style: new TextStyle({
          fontFamily: '"Noto Sans SC", "PingFang SC", sans-serif',
          fontSize: 118,
          fill: BOARD_TEXT_FILL,
          fontWeight: '900',
          stroke: { color: BOARD_TEXT_STROKE, width: 11 },
          letterSpacing: 4,
          align: 'center',
        }),
      });

      const hanzi = new Text({
        text: '',
        style: new TextStyle({
          fontFamily: '"Noto Sans SC", "PingFang SC", sans-serif',
          fontSize: 112,
          fill: BOARD_TEXT_FILL,
          fontWeight: '900',
          stroke: { color: BOARD_TEXT_STROKE, width: 10 },
          align: 'center',
        }),
      });

      const reaction = new Text({
        text: '',
        style: new TextStyle({
          fontFamily: '"Noto Sans SC", "PingFang SC", sans-serif',
          fontSize: 44,
          fill: 0xffffff,
          fontWeight: '900',
          stroke: { color: 0x4a2c16, width: 6 },
          align: 'center',
        }),
      });

      const collectWord = new Text({
        text: '',
        style: new TextStyle({
          fontFamily: '"Noto Sans SC", "PingFang SC", sans-serif',
          fontSize: 84,
          fill: 0xfff3b0,
          fontWeight: '900',
          stroke: { color: 0x6b3a1a, width: 8 },
          align: 'center',
        }),
      });

      pinyin.anchor.set(0.5);
      hanzi.anchor.set(0.5);
      reaction.anchor.set(0.5);
      collectWord.anchor.set(0.5);
      moleSprite.anchor.set(0.5, 1);
      hammer.anchor.set(HAMMER_ANCHOR_X, HAMMER_ANCHOR_Y);
      hitEffect.anchor.set(0.5);
      missEffect.anchor.set(0.14, 0.5);
      collectGlow.anchor.set(0.5);

      moleContainer.visible = false;
      hammer.visible = false;
      hitEffect.visible = false;
      missEffect.visible = false;
      reaction.visible = false;
      collectGlow.visible = false;
      collectWord.visible = false;
      debugGraphics.visible = LAYOUT_DEBUG;
      debugLegend.visible = LAYOUT_DEBUG;
      debugLegend.alpha = 0.9;
      contactShadow.visible = false;
      moleBackShadow.visible = false;
      moleDepthShade.visible = false;
      moleHighlight.visible = false;

      moleContainer.addChild(moleSprite, pinyin, hanzi, reaction);
      app.stage.addChild(
        background,
        groundBlend,
        holeOcclusion,
        contactShadow,
        moleBackShadow,
        moleContainer,
        moleDepthShade,
        moleHighlight,
        holeFrontRim,
        collectGlow,
        collectWord,
        hammer,
        hitEffect,
        missEffect,
        debugGraphics,
        debugLegend,
      );

      backgroundRef.current = background;
      groundBlendRef.current = groundBlend;
      holeOcclusionRef.current = holeOcclusion;
      holeFrontRimRef.current = holeFrontRim;
      contactShadowRef.current = contactShadow;
      moleBackShadowRef.current = moleBackShadow;
      moleDepthShadeRef.current = moleDepthShade;
      moleHighlightRef.current = moleHighlight;
      moleContainerRef.current = moleContainer;
      moleSpriteRef.current = moleSprite;
      hammerSpriteRef.current = hammer;
      hitEffectRef.current = hitEffect;
      missEffectRef.current = missEffect;
      pinyinRef.current = pinyin;
      hanziRef.current = hanzi;
      reactionRef.current = reaction;
      collectGlowRef.current = collectGlow;
      collectWordRef.current = collectWord;
      debugGraphicsRef.current = debugGraphics;
      debugLegendRef.current = debugLegend;

      stageSizeRef.current = { width: 0, height: 0 };
    }

    void setup();

    return () => {
      disposed = true;
      const background = backgroundRef.current;
      const groundBlend = groundBlendRef.current;
      const holeOcclusion = holeOcclusionRef.current;
      const holeFrontRim = holeFrontRimRef.current;
      const contactShadow = contactShadowRef.current;
      const moleBackShadow = moleBackShadowRef.current;
      const moleDepthShade = moleDepthShadeRef.current;
      const moleHighlight = moleHighlightRef.current;
      const moleContainer = moleContainerRef.current;
      const hammer = hammerSpriteRef.current;
      const hitEffect = hitEffectRef.current;
      const missEffect = missEffectRef.current;
      const collectGlow = collectGlowRef.current;
      const collectWord = collectWordRef.current;
      const debugGraphics = debugGraphicsRef.current;
      const debugLegend = debugLegendRef.current;

      if (background) {
        background.parent?.removeChild(background);
        if (!background.destroyed) background.destroy();
      }
      if (groundBlend) {
        groundBlend.parent?.removeChild(groundBlend);
        if (!groundBlend.destroyed) groundBlend.destroy();
      }
      if (holeOcclusion) {
        holeOcclusion.parent?.removeChild(holeOcclusion);
        if (!holeOcclusion.destroyed) holeOcclusion.destroy();
      }
      if (holeFrontRim) {
        holeFrontRim.parent?.removeChild(holeFrontRim);
        if (!holeFrontRim.destroyed) holeFrontRim.destroy();
      }
      if (contactShadow) {
        contactShadow.parent?.removeChild(contactShadow);
        if (!contactShadow.destroyed) contactShadow.destroy();
      }
      if (moleBackShadow) {
        moleBackShadow.parent?.removeChild(moleBackShadow);
        if (!moleBackShadow.destroyed) moleBackShadow.destroy();
      }
      if (moleDepthShade) {
        moleDepthShade.parent?.removeChild(moleDepthShade);
        if (!moleDepthShade.destroyed) moleDepthShade.destroy();
      }
      if (moleHighlight) {
        moleHighlight.parent?.removeChild(moleHighlight);
        if (!moleHighlight.destroyed) moleHighlight.destroy();
      }
      if (moleContainer) {
        moleContainer.parent?.removeChild(moleContainer);
        if (!moleContainer.destroyed) moleContainer.destroy({ children: true });
      }
      if (hammer) {
        hammer.parent?.removeChild(hammer);
        if (!hammer.destroyed) hammer.destroy();
      }
      if (hitEffect) {
        hitEffect.parent?.removeChild(hitEffect);
        if (!hitEffect.destroyed) hitEffect.destroy();
      }
      if (missEffect) {
        missEffect.parent?.removeChild(missEffect);
        if (!missEffect.destroyed) missEffect.destroy();
      }
      if (collectGlow) {
        collectGlow.parent?.removeChild(collectGlow);
        if (!collectGlow.destroyed) collectGlow.destroy();
      }
      if (collectWord) {
        collectWord.parent?.removeChild(collectWord);
        if (!collectWord.destroyed) collectWord.destroy();
      }
      if (debugGraphics) {
        debugGraphics.parent?.removeChild(debugGraphics);
        if (!debugGraphics.destroyed) debugGraphics.destroy();
      }
      if (debugLegend) {
        debugLegend.parent?.removeChild(debugLegend);
        if (!debugLegend.destroyed) debugLegend.destroy();
      }

      backgroundRef.current = null;
      groundBlendRef.current = null;
      holeOcclusionRef.current = null;
      holeFrontRimRef.current = null;
      contactShadowRef.current = null;
      moleBackShadowRef.current = null;
      moleDepthShadeRef.current = null;
      moleHighlightRef.current = null;
      moleContainerRef.current = null;
      moleSpriteRef.current = null;
      hammerSpriteRef.current = null;
      hitEffectRef.current = null;
      missEffectRef.current = null;
      pinyinRef.current = null;
      hanziRef.current = null;
      reactionRef.current = null;
      collectGlowRef.current = null;
      collectWordRef.current = null;
      debugGraphicsRef.current = null;
      debugLegendRef.current = null;
    };
  }, [app]);

  useEffect(() => {
    if (!activeMole) return;
    if (pinyinRef.current) {
      pinyinRef.current.text = activeMole.word.pinyin;
    }
    if (hanziRef.current) {
      hanziRef.current.text = activeMole.word.hanzi;
    }
  }, [activeMole?.word.id, activeMole?.word.pinyin, activeMole?.word.hanzi, activeMole]);

  useTick(() => {
    const background = backgroundRef.current;
    const groundBlend = groundBlendRef.current;
    const holeOcclusion = holeOcclusionRef.current;
    const holeFrontRim = holeFrontRimRef.current;
    const contactShadow = contactShadowRef.current;
    const moleBackShadow = moleBackShadowRef.current;
    const moleDepthShade = moleDepthShadeRef.current;
    const moleHighlight = moleHighlightRef.current;
    const moleContainer = moleContainerRef.current;
    const moleSprite = moleSpriteRef.current;
    const hammer = hammerSpriteRef.current;
    const hitEffect = hitEffectRef.current;
    const missEffect = missEffectRef.current;
    const collectGlow = collectGlowRef.current;
    const collectWord = collectWordRef.current;
    const debugGraphics = debugGraphicsRef.current;
    const debugLegend = debugLegendRef.current;

    if (
      !background ||
      !groundBlend ||
      !holeOcclusion ||
      !holeFrontRim ||
      !contactShadow ||
      !moleBackShadow ||
      !moleDepthShade ||
      !moleHighlight ||
      !moleContainer ||
      !moleSprite ||
      !hammer ||
      !hitEffect ||
      !missEffect ||
      !collectGlow ||
      !collectWord
    ) {
      return;
    }

    if (
      stageSizeRef.current.width !== app.renderer.width ||
      stageSizeRef.current.height !== app.renderer.height
    ) {
      stageSizeRef.current = { width: app.renderer.width, height: app.renderer.height };

      const renderRect = getSceneRenderRect(
        { canvasWidth: app.renderer.width, canvasHeight: app.renderer.height },
        DEFAULT_SCENE_FIT_MODE,
      );
      background.width = renderRect.width;
      background.height = renderRect.height;
      background.x = renderRect.x;
      background.y = renderRect.y;

      slotsRef.current = getMoleSlots(
        { canvasWidth: app.renderer.width, canvasHeight: app.renderer.height },
        DEFAULT_SCENE_FIT_MODE,
      );

      const groundStartY = renderRect.y + renderRect.height * GROUND_EXTENSION_CONFIG.textureStripNormY;
      const extensionHeight = Math.max(
        GROUND_EXTENSION_CONFIG.minHeightPx,
        app.renderer.height - groundStartY,
      );
      const blendBands = 6;
      groundBlend.clear();
      for (let i = 0; i < blendBands; i += 1) {
        const bandRatio = i / blendBands;
        const bandY = groundStartY + extensionHeight * bandRatio;
        const bandHeight = extensionHeight / blendBands + GROUND_EXTENSION_CONFIG.blendHeightPx / blendBands;
        const bandAlpha = FOREGROUND_BLEND_ALPHA * (0.18 + bandRatio * 0.2);
        groundBlend.rect(renderRect.x, bandY, renderRect.width, bandHeight);
        groundBlend.fill({ color: 0x5b3c25, alpha: bandAlpha });
      }

      // The background art already includes the holes; permanent painted ovals here
      // can look like misplaced duplicate holes. Keep this layer empty and let
      // active-mole contact shadows handle edge blending.
      holeOcclusion.clear();
      holeFrontRim.clear();
    }

    const collectFly = collectFlyRef.current;
    if (collectFly.active) {
      collectFly.progress = Math.min(1, collectFly.progress + 0.05);
      const eased = easeOutCubic(collectFly.progress);
      const arcY = Math.sin(Math.PI * collectFly.progress) * -108;

      collectWord.visible = true;
      collectGlow.visible = true;

      collectWord.x = collectFly.startX + (collectFly.endX - collectFly.startX) * eased;
      collectWord.y = collectFly.startY + (collectFly.endY - collectFly.startY) * eased + arcY;
      collectWord.alpha = 1 - Math.max(0, collectFly.progress - 0.76) / 0.24;
      collectWord.scale.set(1.15 - collectFly.progress * 0.38);

      collectGlow.position.set(collectWord.x, collectWord.y + 5);
      collectGlow.alpha = Math.max(0, 0.95 - collectFly.progress * 0.8);
      collectGlow.scale.set(0.46 + (1 - collectFly.progress) * 0.85);
      collectGlow.rotation += 0.12;

      if (collectFly.progress >= 1) {
        collectFly.active = false;
        collectWord.visible = false;
        collectGlow.visible = false;
      }
    } else {
      collectWord.visible = false;
      collectGlow.visible = false;
    }

    const mole = activeMoleRef.current;

    if (!mole) {
      moleContainer.visible = false;
      hammer.visible = false;
      hitEffect.visible = false;
      missEffect.visible = false;
      holeFrontRim.clear();
      contactShadow.visible = false;
      contactShadow.clear();
      moleBackShadow.visible = false;
      moleBackShadow.clear();
      moleDepthShade.visible = false;
      moleDepthShade.clear();
      moleHighlight.visible = false;
      moleHighlight.clear();
      app.stage.position.set(0, 0);

      if (debugGraphics && LAYOUT_DEBUG) {
        debugGraphics.clear();
        drawSlotAnchors(debugGraphics, slotsRef.current);
      }
      if (debugLegend && LAYOUT_DEBUG) {
        debugLegend.visible = true;
        debugLegend.position.set(14, 14);
      }
      return;
    }

    moleContainer.visible = true;
    hammer.visible = true;

    if (mole.word.id !== lastWordIdRef.current) {
      lastWordIdRef.current = mole.word.id;
      currentStyleRef.current = pickStyle(mole.word.id);
      hammerPlacementRef.current = pickHammerPlacement(mole.word.id);
      animTickRef.current = 0;
      currentTexturePathRef.current = '';
      if (pinyinRef.current) {
        pinyinRef.current.text = mole.word.pinyin;
      }
      if (hanziRef.current) {
        hanziRef.current.text = mole.word.hanzi;
      }
    }

    let shouldLaunchCollect = false;
    if (mole.animState !== animStateRef.current) {
      animStateRef.current = mole.animState;
      animTickRef.current = 0;
      if (mole.animState === 'hit' && mole.strikeId !== lastStrikeIdRef.current) {
        lastStrikeIdRef.current = mole.strikeId;
        swingRef.current = 1;
        shouldLaunchCollect = true;
      }
      if (mole.animState === 'retry') {
        swingRef.current = 1;
      }
    }

    animTickRef.current += 1;

    const style = currentStyleRef.current;
    const texturePath = textureForState(mole.animState, style);
    if (texturePath !== currentTexturePathRef.current) {
      moleSprite.texture = Texture.from(texturePath);
      currentTexturePathRef.current = texturePath;
    }

    const slotGeometry = slotsRef.current[mole.slotIndex];
    const fallbackOpeningWidth = Math.max(1, mole.scale);
    const fallbackOpeningHeight = fallbackOpeningWidth * 0.38;
    const darkOpening = slotGeometry
      ? {
          darkLeftX: slotGeometry.darkLeftX,
          darkRightX: slotGeometry.darkRightX,
          darkBackY: slotGeometry.darkBackY,
          darkFrontY: slotGeometry.darkFrontY,
        }
      : {
          darkLeftX: mole.x - fallbackOpeningWidth / 2,
          darkRightX: mole.x + fallbackOpeningWidth / 2,
          darkBackY: mole.y - fallbackOpeningHeight,
          darkFrontY: mole.y,
        };
    const placement = {
      centerX: (darkOpening.darkLeftX + darkOpening.darkRightX) / 2,
      rimY: darkOpening.darkFrontY,
      openingWidth: Math.max(1, darkOpening.darkRightX - darkOpening.darkLeftX),
    };
    const displayAttachmentMeta = displayAttachmentForState(mole.animState, style);
    const placementAttachmentMeta = placementAttachmentForState(mole.animState, style);
    const base = computeBodyAnchoredMoleTransform(darkOpening, placementAttachmentMeta, style.scaleBias ?? 1);
    const idleBobAmp = motionValue(style.idleBobAmp, 3.2);
    const wobbleAmp = motionValue(style.wobbleAmp, 0.03);
    const hitSquash = motionValue(style.hitSquash, 0.94);
    const escapeSinkBias = motionValue(style.escapeSinkBias, 1);
    const contactShadowScale = motionValue(style.contactShadowScale, 1);
    const bodyBBox = placementAttachmentMeta.bodyBBox ?? placementAttachmentMeta.visibleBBox;
    const bodyLeftBottomX = placementAttachmentMeta.bodyLeftBottomX ?? bodyBBox.left;
    const bodyBottomY = placementAttachmentMeta.bodyBottomY ?? bodyBBox.bottom;

    const t = animTickRef.current;
    let deltaX = 0;
    let deltaY = 0;
    let renderScaleX = base.scale;
    let renderScaleY = base.scale;
    let renderRotation = 0;
    let renderAlpha = 1;
    const bob = Math.sin(t * 0.085) * idleBobAmp;
    const holeHeight = Math.max(1, darkOpening.darkFrontY - darkOpening.darkBackY);
    if (mole.animState === 'emerging') {
      const emergeProgress = Math.min(1, t / MOLE_EMERGE_FRAMES);
      const emergeEase = easeOutBack(emergeProgress);
      deltaY += Math.max(0, MOLE_EMERGE_LIFT * (1 - emergeEase));
      renderScaleY = base.scale * (0.9 + emergeProgress * 0.1);
    } else if (mole.animState === 'active' || mole.animState === 'listening') {
      deltaY += Math.max(0, bob);
      renderRotation = Math.sin(t * 0.08) * wobbleAmp;
      if (mole.animState === 'listening') {
        const pulse = 1 + Math.sin(t * 0.24) * 0.04;
        renderScaleX = base.scale * pulse;
        renderScaleY = base.scale * (1 + Math.sin(t * 0.24 + 0.28) * 0.025);
      }
    } else if (mole.animState === 'retry') {
      const dodge = easeOutBack(Math.min(1, t / 20));
      const duck = easeOutCubic(Math.min(1, t / 16));
      deltaX += Math.sin(t * 0.72) * 7 + (mole.reaction === 'laugh' ? 14 : -14) * dodge;
      deltaY += duck * 13;
      renderRotation = Math.sin(t * 0.3) * (wobbleAmp + 0.01);
    } else if (mole.animState === 'hit') {
      const impactAge = Math.max(0, t - 4);
      const shake = Math.sin(impactAge * 1.24) * Math.max(0, 7 - impactAge * 0.2);
      deltaX += shake;
      deltaY += Math.min(112, Math.max(0, impactAge - 7) * 2.9);
      renderScaleY = base.scale * (hitSquash + Math.min(0.08, impactAge * 0.004));
      renderScaleX = base.scale * (1.04 + Math.min(0.1, impactAge * 0.003));
      renderAlpha = impactAge < 30 ? 1 : Math.max(0, 1 - (impactAge - 30) / 16);
    } else if (mole.animState === 'escaping') {
      deltaY += Math.min(122 * escapeSinkBias, t * 5.1 * escapeSinkBias);
      renderScaleX = base.scale * 0.98;
      renderScaleY = base.scale * 0.95;
      renderAlpha = Math.max(0, 1 - t / 30);
    }

    const anchoredX = darkOpening.darkLeftX - (bodyLeftBottomX - placementAttachmentMeta.canvasWidth / 2) * renderScaleX;
    const anchoredY = base.bodyBottomY + (placementAttachmentMeta.canvasHeight - bodyBottomY) * renderScaleY;
    moleContainer.position.set(anchoredX + deltaX, anchoredY + deltaY);
    moleContainer.scale.set(renderScaleX, renderScaleY);
    moleContainer.alpha = renderAlpha;
    moleContainer.rotation = renderRotation;
    const impactAnchorX = anchoredX + deltaX;
    const impactAnchorY = anchoredY + deltaY;
    const bodyLeftX = impactAnchorX + (bodyBBox.left - placementAttachmentMeta.canvasWidth / 2) * renderScaleX;
    const bodyRightX = impactAnchorX + (bodyBBox.right - placementAttachmentMeta.canvasWidth / 2) * renderScaleX;
    const bodyTopY = impactAnchorY - (placementAttachmentMeta.canvasHeight - bodyBBox.top) * renderScaleY;
    const renderedBodyBottomY = impactAnchorY - (placementAttachmentMeta.canvasHeight - bodyBBox.bottom) * renderScaleY;
    const renderedBody = {
      x: impactAnchorX,
      y: impactAnchorY,
      scale: (renderScaleX + renderScaleY) / 2,
      bodyLeftX,
      bodyRightX,
      bodyTopY,
      bodyBottomY: renderedBodyBottomY,
      bodyWidth: bodyRightX - bodyLeftX,
      bodyHeight: renderedBodyBottomY - bodyTopY,
    };

    const bodyCenterX = renderedBody.bodyLeftX + renderedBody.bodyWidth / 2;
    const bodyCenterY = renderedBody.bodyTopY + renderedBody.bodyHeight / 2;
    const emergeDepth = mole.animState === 'emerging'
      ? easeOutCubic(Math.min(1, t / MOLE_EMERGE_FRAMES))
      : 1;
    const depthFade = Math.max(0, Math.min(1, renderAlpha * emergeDepth));
    const listeningGlow = mole.animState === 'listening' ? 1.12 : 1;
    const hitShadeBoost = mole.animState === 'hit' ? Math.max(0, 1 - t / 36) * 0.025 : 0;

    moleBackShadow.visible = mole.animState !== 'hidden';
    moleBackShadow.clear();
    moleBackShadow.ellipse(
      bodyCenterX + renderedBody.bodyWidth * 0.08,
      renderedBody.bodyBottomY - renderedBody.bodyHeight * 0.22,
      renderedBody.bodyWidth * 0.44,
      renderedBody.bodyHeight * 0.24,
    );
    moleBackShadow.fill({ color: 0x140804, alpha: MOLE_BACK_SHADOW_ALPHA * depthFade * 0.58 });
    moleBackShadow.ellipse(
      bodyCenterX + renderedBody.bodyWidth * 0.16,
      renderedBody.bodyBottomY - renderedBody.bodyHeight * 0.12,
      renderedBody.bodyWidth * 0.34,
      renderedBody.bodyHeight * 0.16,
    );
    moleBackShadow.fill({ color: 0x030100, alpha: MOLE_BACK_SHADOW_ALPHA * depthFade * 0.42 });

    moleDepthShade.visible = mole.animState !== 'hidden';
    moleDepthShade.clear();
    // Keep front-facing character art clear; depth shade only darkens the lower contact edge.
    moleDepthShade.ellipse(
      bodyCenterX + renderedBody.bodyWidth * 0.12,
      renderedBody.bodyBottomY - renderedBody.bodyHeight * 0.08,
      renderedBody.bodyWidth * 0.38,
      renderedBody.bodyHeight * 0.11,
    );
    moleDepthShade.fill({ color: 0x000000, alpha: (MOLE_DEPTH_SHADE_ALPHA + hitShadeBoost) * depthFade });

    moleHighlight.visible = mole.animState !== 'hidden';
    moleHighlight.clear();
    moleHighlight.ellipse(
      bodyCenterX - renderedBody.bodyWidth * 0.22,
      renderedBody.bodyTopY + renderedBody.bodyHeight * 0.18,
      renderedBody.bodyWidth * 0.22,
      renderedBody.bodyHeight * 0.18,
    );
    moleHighlight.fill({ color: 0xffe4b8, alpha: MOLE_DEPTH_HIGHLIGHT_ALPHA * depthFade * listeningGlow });
    moleHighlight.ellipse(
      bodyCenterX - renderedBody.bodyWidth * 0.28,
      bodyCenterY,
      renderedBody.bodyWidth * 0.1,
      renderedBody.bodyHeight * 0.24,
    );
    moleHighlight.fill({ color: 0xfff0cf, alpha: MOLE_DEPTH_HIGHLIGHT_ALPHA * depthFade * 0.34 });

    const shadowFade = mole.animState === 'escaping'
      ? Math.max(0, 0.6 - t / 45)
      : (mole.animState === 'hit' ? Math.max(0.2, 0.85 - t * 0.018) : 0.95);
    const shadowWobble = 1 + Math.sin(t * 0.09) * 0.045;
    const shadowBounds = computeBodyOpeningShadowBounds(darkOpening, renderedBody, contactShadowScale * shadowWobble);
    const contactShadowWidth = shadowBounds.width * 0.36;
    const contactShadowHeight = shadowBounds.height * 0.34;
    const shadowX = shadowBounds.centerX;
    const shadowY = Math.min(
      darkOpening.darkFrontY - contactShadowHeight * 0.58,
      shadowBounds.centerY + holeHeight * 0.08,
    );
    const innerShadowX = Math.min(
      darkOpening.darkRightX - contactShadowWidth * 0.42,
      shadowX + placement.openingWidth * 0.04,
    );
    const innerShadowY = Math.min(
      darkOpening.darkFrontY - contactShadowHeight * 0.42,
      shadowY + holeHeight * 0.04,
    );
    contactShadow.visible = mole.animState !== 'hidden';
    contactShadow.clear();
    // Keep this as a subtle grounding mark inside the dark opening; body depth is handled by moleBackShadow.
    contactShadow.ellipse(shadowX, shadowY, contactShadowWidth, contactShadowHeight);
    contactShadow.fill({ color: 0x070301, alpha: CONTACT_SHADOW_ALPHA * shadowFade * 0.46 });
    contactShadow.ellipse(innerShadowX, innerShadowY, contactShadowWidth * 0.52, contactShadowHeight * 0.46);
    contactShadow.fill({ color: 0x000000, alpha: CONTACT_SHADOW_ALPHA * shadowFade * 0.64 });

    holeFrontRim.clear();
    if (slotGeometry && mole.animState !== 'hidden') {
      const rimRx = placement.openingWidth * 0.62;
      const rimRy = slotGeometry.openingHeight * 0.34;
      const frontLipY = slotGeometry.darkFrontY - slotGeometry.openingHeight * 0.04;
      const rimAlpha = mole.animState === 'escaping'
        ? Math.max(0, FRONT_RIM_SHADOW_ALPHA * (1 - t / 32))
        : FRONT_RIM_SHADOW_ALPHA;

      // Dynamic front lip only appears where a mole is present, blending the contact edge.
      holeFrontRim.ellipse(slotGeometry.darkCenterX, frontLipY, rimRx, rimRy);
      holeFrontRim.fill({ color: 0x2a160c, alpha: rimAlpha });
      holeFrontRim.ellipse(slotGeometry.darkCenterX, slotGeometry.darkFrontY + rimRy * 0.08, rimRx * 0.78, rimRy * 0.28);
      holeFrontRim.fill({ color: 0x100704, alpha: rimAlpha * 0.34 });
      holeFrontRim.ellipse(slotGeometry.darkCenterX, frontLipY - rimRy * 0.26, rimRx * 0.92, rimRy * 0.46);
      holeFrontRim.fill({ color: 0x8a5a32, alpha: FRONT_RIM_HIGHLIGHT_ALPHA * Math.min(1, rimAlpha / FRONT_RIM_SHADOW_ALPHA) });
      holeFrontRim.ellipse(slotGeometry.darkCenterX - rimRx * 0.18, frontLipY - rimRy * 0.36, rimRx * 0.34, rimRy * 0.2);
      holeFrontRim.fill({ color: 0xd7a15d, alpha: FRONT_RIM_HIGHLIGHT_ALPHA * 0.52 });
    }

    const showSign = shouldShowSign(mole.animState);
    const textDrift = (mole.animState === 'active' || mole.animState === 'listening')
      ? Math.sin(t * 0.1) * 3.2
      : 0;
    const boardParallax = (mole.animState === 'active' || mole.animState === 'listening')
      ? Math.sin(t * 0.073) * 1.4
      : 0;
    const textScaleBoost = mole.animState === 'listening' ? 1.03 : 1;
    const textCenterY = (style.pinyinY + style.hanziY) / 2;
    const pinyinBoardY = textCenterY - BOARD_TEXT_LINE_SPACING / 2;
    const hanziBoardY = textCenterY + BOARD_TEXT_LINE_SPACING / 2;
    const boardTextCenterY = moleContainer.y + textCenterY * renderScaleY;
    const boardKeepoutHeight = BOARD_TEXT_LINE_SPACING * renderScaleY * 1.8;
    const boardKeepoutTop = boardTextCenterY - boardKeepoutHeight / 2;
    const boardKeepoutWidth = Math.max(placement.openingWidth * 1.78, renderedBody.bodyWidth * 1.18);
    const hammerPlacement = hammerPlacementRef.current;
    const hammerSide = hammerPlacement.side;
    const hammerClearance = placement.openingWidth * HAMMER_BOARD_CLEARANCE_RATIO;
    const isNearSideEdge = (
      (hammerSide === -1 && darkOpening.darkLeftX < app.renderer.width * 0.24) ||
      (hammerSide === 1 && darkOpening.darkRightX > app.renderer.width * 0.76)
    );
    const bodyImpactX = bodyLeftX + renderedBody.bodyWidth * (hammerSide === 1 ? 0.58 : 0.42);
    const bodyImpactY = bodyTopY + renderedBody.bodyHeight * 0.16;
    let impactPointX = bodyImpactX;
    let impactPointY = Math.min(bodyImpactY, boardKeepoutTop - hammerClearance);
    if (isNearSideEdge) {
      impactPointX += hammerSide * placement.openingWidth * HAMMER_EDGE_INSET_RATIO;
      impactPointY -= placement.openingWidth * 0.16;
    }
    const hammerBaseX = bodyLeftX + renderedBody.bodyWidth * (hammerSide === 1 ? 0.52 : 0.48);
    const hammerBaseY = Math.min(
      darkOpening.darkFrontY - placement.openingWidth * HAMMER_IDLE_MIN_Y_RATIO,
      boardKeepoutTop - hammerClearance,
    );
    let hammerIdleX = hammerBaseX + hammerSide * placement.openingWidth * (0.86 + hammerPlacement.idleJitterX);
    let hammerIdleY = hammerBaseY - placement.openingWidth * (0.22 + hammerPlacement.idleJitterY);
    if (isNearSideEdge) {
      hammerIdleX += hammerSide * placement.openingWidth * HAMMER_EDGE_INSET_RATIO;
      hammerIdleY -= placement.openingWidth * 0.2;
    }
    const sparkleAnchorX = impactPointX + hammerSide * placement.openingWidth * HIT_SPARKLE_SIDE_OFFSET_RATIO;
    const sparkleAnchorY = Math.min(
      impactPointY - placement.openingWidth * HIT_SPARKLE_UP_OFFSET_RATIO,
      bodyTopY + renderedBody.bodyHeight * HIT_SPARKLE_FACE_CLEAR_RATIO,
      boardKeepoutTop - placement.openingWidth * HIT_SPARKLE_BOARD_CLEAR_RATIO,
    );

    if (shouldLaunchCollect) {
      const holdBase = computeBodyAnchoredMoleTransform(darkOpening, style.hold.meta, style.scaleBias ?? 1);
      const start = new Point(
        holdBase.x + style.textAnchorX * holdBase.scale,
        holdBase.y + hanziBoardY * holdBase.scale,
      );
      collectWord.text = mole.word.hanzi;
      collectFly.active = true;
      collectFly.progress = 0;
      collectFly.startX = start.x;
      collectFly.startY = start.y;
      collectFly.endX = app.renderer.width * 0.5;
      collectFly.endY = COLLECT_TARGET_Y;
    }

    if (pinyinRef.current) {
      pinyinRef.current.visible = showSign;
      pinyinRef.current.position.set(
        style.textAnchorX + Math.sin(t * 0.08) * 1.2 + boardParallax,
        pinyinBoardY + textDrift - boardParallax * 0.2,
      );
      const pinyinScale = fittedTextScale(
        pinyinRef.current,
        (style.textScale ?? 1) * textScaleBoost,
        BOARD_PINYIN_MAX_WIDTH,
      );
      pinyinRef.current.scale.set(pinyinScale);
      (pinyinRef.current.style as TextStyle).fill = BOARD_TEXT_FILL;
    }
    if (hanziRef.current) {
      hanziRef.current.visible = showSign;
      hanziRef.current.position.set(style.textAnchorX + boardParallax * 0.6, hanziBoardY + textDrift * 0.7);
      const hanziScale = fittedTextScale(
        hanziRef.current,
        (style.textScale ?? 1) * textScaleBoost,
        BOARD_HANZI_MAX_WIDTH,
      );
      hanziRef.current.scale.set(hanziScale);
    }

    if (reactionRef.current) {
      if (mole.animState === 'hit') {
        reactionRef.current.visible = true;
        reactionRef.current.text = 'Great!';
        reactionRef.current.position.set(style.textAnchorX, hanziBoardY - 124 - Math.min(16, t * 0.6));
        reactionRef.current.alpha = Math.max(0, 1 - Math.max(0, t - 22) / 12);
      } else if (mole.animState === 'retry') {
        reactionRef.current.visible = true;
        reactionRef.current.text = mole.reaction === 'laugh' ? 'Again!' : 'Oops!';
        reactionRef.current.position.set(style.textAnchorX, hanziBoardY - 118 - Math.min(12, t * 0.55));
        reactionRef.current.alpha = Math.max(0, 1 - Math.max(0, t - 18) / 12);
      } else {
        reactionRef.current.visible = false;
      }
    }

    if (mole.animState === 'hit' && t < HIT_EFFECT_FRAMES) {
      const progress = Math.min(1, t / HIT_EFFECT_FRAMES);
      const fadeProgress = Math.max(0, (progress - 0.42) / 0.58);
      const life = 1 - easeOutCubic(fadeProgress);
      const bloom = Math.sin(progress * Math.PI);
      const spinProgress = Math.max(0, (progress - 0.62) / 0.38);
      if (lastSparkleStrikeIdRef.current !== mole.strikeId) {
        lastSparkleStrikeIdRef.current = mole.strikeId;
        console.log('[latency] state transition to sparkle visible', {
          strikeId: mole.strikeId,
          animTick: t,
        });
      }
      hitEffect.visible = true;
      hitEffect.position.set(sparkleAnchorX, sparkleAnchorY);
      hitEffect.scale.set(base.scale * (0.82 + bloom * 0.38 + progress * 0.08));
      hitEffect.alpha = Math.min(0.82, 0.56 + life * 0.26);
      hitEffect.rotation += 0.004 + easeOutCubic(spinProgress) * 0.09;
    } else {
      hitEffect.visible = false;
      hitEffect.alpha = 0;
    }

    if ((mole.animState === 'retry' || mole.animState === 'escaping') && t < MISS_EFFECT_FRAMES) {
      const progress = Math.min(1, t / MISS_EFFECT_FRAMES);
      const fadeProgress = Math.max(0, (progress - 0.36) / 0.64);
      const life = 1 - easeOutCubic(fadeProgress);
      const settle = easeOutCubic(progress);
      const direction = mole.reaction === 'laugh' ? 1 : -1;
      missEffect.visible = true;
      missEffect.position.set(
        impactPointX + direction * placement.openingWidth * 0.34,
        impactPointY - placement.openingWidth * 0.1 - settle * 10,
      );
      missEffect.scale.set(base.scale * (1.52 + progress * 0.28) * direction, base.scale * (1.52 + progress * 0.28));
      missEffect.alpha = Math.min(0.92, 0.64 + life * 0.3);
      missEffect.rotation = direction * (0.1 + settle * 0.08);
    } else {
      missEffect.visible = false;
      missEffect.alpha = 0;
    }

    const voicePower = Math.min(1, volumeRef.current);
    const stateImpactBoost = (mole.animState === 'hit' || mole.animState === 'retry')
      ? Math.max(0, 1 - t / 42) * 0.075
      : 0;
    const hammerScale = 0.21 + voicePower * 0.13 + stateImpactBoost;
    const hammerVisualScale = Math.max(hammerScale, 0.27 + voicePower * 0.1);
    const hammerScaleX = hammerVisualScale * hammerSide;
    const hammerSafetyScale = hammerVisualScale + 0.08;
    const hammerSafetyScaleX = hammerSafetyScale * hammerSide;
    const hammerTextureWidth = hammer.texture.width || HAMMER_TEXTURE_FALLBACK_SIZE;
    const hammerTextureHeight = hammer.texture.height || HAMMER_TEXTURE_FALLBACK_SIZE;
    const listeningLean = mole.animState === 'listening' ? LISTENING_HAMMER_LEAN_RAD : 0;
    const listeningHover = mole.animState === 'listening'
      ? (-LISTENING_HAMMER_HOVER_PX + Math.sin(t * 0.22) * 2.6)
      : 0;
    const idleBaseRotation = -0.52 + Math.sin(t * 0.06) * 0.05 - voicePower * 0.07 - listeningLean;
    const windupBaseRotation = -1.33;
    const impactBaseRotation = 0.42;
    const recoveryBaseRotation = -0.42;
    const idleRotation = getHammerRotation(idleBaseRotation, hammerSide, hammerPlacement.angleBias);
    const windupRotation = getHammerRotation(windupBaseRotation, hammerSide, hammerPlacement.angleBias);
    const impactRotation = getHammerRotation(impactBaseRotation, hammerSide, hammerPlacement.angleBias * 0.45);
    const recoveryRotation = getHammerRotation(recoveryBaseRotation, hammerSide, hammerPlacement.angleBias);
    const windupX = hammerBaseX + hammerSide * placement.openingWidth * (0.72 + hammerPlacement.idleJitterX * 0.4);
    let windupY = Math.min(hammerIdleY, impactPointY - placement.openingWidth * 0.72);
    const recoveryX = impactPointX + hammerSide * placement.openingWidth * 0.38;
    let recoveryY = impactPointY - placement.openingWidth * 0.34;
    const keepoutLimitY = boardKeepoutTop - placement.openingWidth * HAMMER_HEAD_CLEARANCE_RATIO;
    const hammerSafetyLift = Math.max(
      getHammerSafeLift(
        hammerIdleX,
        hammerIdleY,
        hammerSafetyScaleX,
        hammerSafetyScale,
        idleRotation,
        hammerTextureWidth,
        hammerTextureHeight,
        placement.openingWidth,
        boardKeepoutTop,
        hammerClearance,
      ),
      getHammerSafeLift(
        windupX,
        windupY,
        hammerSafetyScaleX,
        hammerSafetyScale,
        windupRotation,
        hammerTextureWidth,
        hammerTextureHeight,
        placement.openingWidth,
        boardKeepoutTop,
        hammerClearance,
      ),
      getHammerSafeLift(
        impactPointX,
        impactPointY,
        hammerSafetyScaleX,
        hammerSafetyScale,
        impactRotation,
        hammerTextureWidth,
        hammerTextureHeight,
        placement.openingWidth,
        boardKeepoutTop,
        hammerClearance,
      ),
      getHammerSafeLift(
        recoveryX,
        recoveryY,
        hammerSafetyScaleX,
        hammerSafetyScale,
        recoveryRotation,
        hammerTextureWidth,
        hammerTextureHeight,
        placement.openingWidth,
        boardKeepoutTop,
        hammerClearance,
      ),
    );
    hammerIdleY = Math.min(hammerIdleY - hammerSafetyLift, keepoutLimitY);
    windupY = Math.min(windupY - hammerSafetyLift, keepoutLimitY);
    impactPointY = Math.min(impactPointY - hammerSafetyLift, keepoutLimitY);
    recoveryY = Math.min(recoveryY - hammerSafetyLift, keepoutLimitY);

    hammer.texture = Texture.from(HAMMER_TEXTURE);
    hammer.position.set(hammerIdleX, hammerIdleY - voicePower * 18 + listeningHover);
    hammer.scale.set(hammerScaleX, hammerVisualScale);
    hammer.alpha = 1;
    hammer.visible = true;

    if (swingRef.current > 0) {
      const swing = swingRef.current;
      const progress = 1 - swing;
      const windupEnd = 0.34;
      const impactEnd = 0.66;
      const holdEnd = 0.78;

      if (progress < windupEnd) {
        const eased = easeOutCubic(progress / windupEnd);
        hammer.rotation = idleRotation + (windupRotation - idleRotation) * eased;
        hammer.x = hammerIdleX + (windupX - hammerIdleX) * eased;
        hammer.y = hammerIdleY + (windupY - hammerIdleY) * eased;
      } else if (progress < impactEnd) {
        const eased = easeInCubic((progress - windupEnd) / (impactEnd - windupEnd));
        hammer.rotation = windupRotation + (impactRotation - windupRotation) * eased;
        hammer.x = windupX + (impactPointX - windupX) * eased;
        hammer.y = windupY + (impactPointY - windupY) * eased;
      } else if (progress < holdEnd) {
        hammer.rotation = impactRotation;
        hammer.x = impactPointX;
        hammer.y = impactPointY;
      } else {
        const eased = easeOutBack((progress - holdEnd) / (1 - holdEnd));
        hammer.rotation = impactRotation + (recoveryRotation - impactRotation) * eased;
        hammer.x = impactPointX + (recoveryX - impactPointX) * eased;
        hammer.y = impactPointY + (recoveryY - impactPointY) * eased;
      }

      swingRef.current = Math.max(0, swing - HAMMER_SWING_DECAY);
      const impactScaleBoost = progress >= windupEnd && progress <= holdEnd
        ? Math.sin(((progress - windupEnd) / (holdEnd - windupEnd)) * Math.PI) * 0.08
        : 0;
      const swingScale = hammerVisualScale + impactScaleBoost;
      hammer.scale.set(swingScale * hammerSide, swingScale);
    } else {
      hammer.rotation = idleRotation;
    }

    if (mole.animState === 'hit') {
      const fadeProgress = Math.max(
        0,
        Math.min(1, (t - HAMMER_HIT_FADE_START_FRAME) / (HAMMER_HIT_HIDE_FRAME - HAMMER_HIT_FADE_START_FRAME)),
      );
      hammer.alpha = 1 - easeOutCubic(fadeProgress);
      hammer.visible = t < HAMMER_HIT_HIDE_FRAME;
    }

    if (debugGraphics && LAYOUT_DEBUG) {
      debugGraphics.clear();
      drawSlotAnchors(debugGraphics, slotsRef.current);

      const debugScale = (renderScaleX + renderScaleY) / 2;
      const rect = spriteWorldRect({ x: moleContainer.x, y: moleContainer.y, scale: debugScale }, displayAttachmentMeta);
      const bbox = displayAttachmentMeta.visibleBBox;
      const bboxLeft = rect.left + bbox.left * debugScale;
      const bboxTop = rect.top + bbox.top * debugScale;
      const bboxWidth = bbox.width * debugScale;
      const bboxHeight = bbox.height * debugScale;
      const boardCenterX = moleContainer.x + style.textAnchorX * renderScaleX;
      const boardCenterY = moleContainer.y + ((style.pinyinY + style.hanziY) / 2) * renderScaleY;
      const bboxBottomX = bboxLeft + bboxWidth / 2;
      const bboxBottomY = bboxTop + bboxHeight;

      debugGraphics.stroke({ color: DEBUG_COLORS.spriteBBox, pixelLine: true, width: 2 });
      debugGraphics.rect(bboxLeft, bboxTop, bboxWidth, bboxHeight);
      debugGraphics.stroke({ color: DEBUG_COLORS.bodyBBox, pixelLine: true, width: 2 });
      debugGraphics.rect(bodyLeftX, bodyTopY, renderedBody.bodyWidth, renderedBody.bodyHeight);
      debugGraphics.stroke({ color: DEBUG_COLORS.shadowBBox, pixelLine: true, width: 2 });
      debugGraphics.rect(shadowBounds.left, shadowBounds.top, shadowBounds.width, shadowBounds.height);
      debugGraphics.stroke({ color: DEBUG_COLORS.hammerSafe, pixelLine: true, width: 2 });
      debugGraphics.rect(
        boardCenterX - boardKeepoutWidth / 2,
        boardKeepoutTop,
        boardKeepoutWidth,
        boardKeepoutHeight,
      );

      drawDebugCross(debugGraphics, bodyLeftX, renderedBodyBottomY, DEBUG_COLORS.bodyContact, 10, 2);
      drawDebugDiamond(debugGraphics, boardCenterX, boardCenterY, DEBUG_COLORS.boardCenter, 9);
      drawDebugCross(debugGraphics, impactPointX, impactPointY, DEBUG_COLORS.impactPoint, 9, 2);
      drawDebugDiamond(debugGraphics, sparkleAnchorX, sparkleAnchorY, DEBUG_COLORS.sparkleAnchor, 8);
      const debugLowestHeadPoint = getHammerLowestHeadPoint(
        impactPointX,
        impactPointY,
        hammerSafetyScaleX,
        hammerSafetyScale,
        impactRotation,
        hammerTextureWidth,
        hammerTextureHeight,
      );
      drawDebugDiamond(
        debugGraphics,
        debugLowestHeadPoint.x,
        debugLowestHeadPoint.y,
        DEBUG_COLORS.hammerSafe,
        8,
      );
      drawDebugCross(debugGraphics, bboxBottomX, bboxBottomY, DEBUG_COLORS.spriteBBox, 6, 2);

      if (slotGeometry) {
        drawDebugCross(debugGraphics, slotGeometry.darkCenterX, slotGeometry.darkFrontY, DEBUG_COLORS.frontLip, 7, 2);
        drawDebugCross(debugGraphics, slotGeometry.darkLeftX, slotGeometry.moleContactY, DEBUG_COLORS.moleContact, 7, 2);
        drawDebugDiamond(debugGraphics, shadowBounds.centerX, shadowBounds.centerY, DEBUG_COLORS.shadowCenter, 8);
      }
    }

    if (debugLegend && LAYOUT_DEBUG) {
      debugLegend.visible = true;
      debugLegend.position.set(14, 14);
    }
  });

  return null;
}

interface MoleCanvasProps {
  gameState: GameState | null;
  activeMoleRef: RefObject<MoleState | null>;
  volume: number;
  resizeTarget: HTMLElement | null;
}

export function MoleCanvas({ gameState, activeMoleRef, volume, resizeTarget }: MoleCanvasProps) {
  return (
    <Application
      backgroundAlpha={0}
      resizeTo={resizeTarget ?? window}
      antialias={true}
    >
      <MoleRenderer
        activeMole={gameState?.activeMole ?? null}
        activeMoleRef={activeMoleRef}
        volume={volume}
      />
    </Application>
  );
}
