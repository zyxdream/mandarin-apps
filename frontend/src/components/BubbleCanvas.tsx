import { Application, useApplication, useTick } from '@pixi/react';
import { Container, Graphics, Text, TextStyle } from 'pixi.js';
import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import type { GameState, MoleState } from '../types/game';
import type { Tone } from '../types/word';
import { getMoleSlots } from '../engine/moleLayout';

const TONE_COLORS: Record<Tone, number> = {
  1: 0xe53935,
  2: 0xfb8c00,
  3: 0x43a047,
  4: 0x1e88e5,
};

const MOLE_WIDTH = 92;
const MOLE_HEIGHT = 88;
const HIT_IMPACT_FRAME = 20;

interface Particle {
  x: number; y: number;
  vx: number; vy: number;
  life: number;
  color: number;
  radius: number;
}

interface RendererProps {
  activeMole: MoleState | null;
  activeMoleRef: RefObject<MoleState | null>;
  volume: number;
}

function MoleRenderer({ activeMole, activeMoleRef, volume }: RendererProps) {
  const { app } = useApplication();

  const boardRef = useRef<Graphics | null>(null);
  const containerRef = useRef<Container | null>(null);
  const moleRef = useRef<Graphics | null>(null);
  const bannerRef = useRef<Graphics | null>(null);
  const hammerRef = useRef<Graphics | null>(null);
  const particleGfxRef = useRef<Graphics | null>(null);
  const hanziRef = useRef<Text | null>(null);
  const pinyinRef = useRef<Text | null>(null);
  const secondChanceLabelRef = useRef<Text | null>(null);
  const reactionRef = useRef<Text | null>(null);

  const particlesRef = useRef<Particle[]>([]);
  const animStateRef = useRef<string>('hidden');
  const animTickRef = useRef(0);
  const swingRef = useRef(0);
  const impactSpawnedRef = useRef(false);
  const lastStrikeRef = useRef(0);
  const lastBoardSizeRef = useRef({ width: 0, height: 0 });
  const volumeRef = useRef(volume);

  useEffect(() => {
    volumeRef.current = volume;
  }, [volume]);

  useEffect(() => {
    const board = new Graphics();
    const container = new Container();
    const banner = new Graphics();
    const mole = new Graphics();
    const hammer = new Graphics();
    const particleGfx = new Graphics();

    const hanzi = new Text({ text: '', style: new TextStyle({
      fontFamily: '"Noto Sans SC", "PingFang SC", sans-serif',
      fontSize: 30,
      fill: 0x2b1a12,
      fontWeight: 'bold',
    })});
    const pinyin = new Text({ text: '', style: new TextStyle({
      fontFamily: 'sans-serif',
      fontSize: 15,
      fill: 0x2b1a12,
      fontWeight: 'bold',
    })});
    const secondChanceLabel = new Text({ text: 'Try again!', style: new TextStyle({
      fontFamily: 'sans-serif',
      fontSize: 14,
      fill: 0xfff2a8,
      fontWeight: 'bold',
    })});
    const reaction = new Text({ text: '', style: new TextStyle({
      fontFamily: 'sans-serif',
      fontSize: 22,
      fill: 0xffffff,
      fontWeight: 'bold',
    })});

    hanzi.anchor.set(0.5);
    pinyin.anchor.set(0.5, 0.5);
    secondChanceLabel.anchor.set(0.5, 0.5);
    reaction.anchor.set(0.5);

    container.addChild(particleGfx, banner, mole, pinyin, hanzi, secondChanceLabel, reaction);
    container.visible = false;
    app.stage.addChild(board);
    app.stage.addChild(container);
    app.stage.addChild(hammer);

    boardRef.current = board;
    containerRef.current = container;
    bannerRef.current = banner;
    moleRef.current = mole;
    hammerRef.current = hammer;
    particleGfxRef.current = particleGfx;
    hanziRef.current = hanzi;
    pinyinRef.current = pinyin;
    secondChanceLabelRef.current = secondChanceLabel;
    reactionRef.current = reaction;

    return () => {
      board.parent?.removeChild(board);
      container.parent?.removeChild(container);
      hammer.parent?.removeChild(hammer);
      if (!board.destroyed) board.destroy();
      if (!container.destroyed) container.destroy({ children: true });
      if (!hammer.destroyed) hammer.destroy();
    };
  }, [app]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    if (!activeMole) {
      container.visible = false;
      if (hammerRef.current) hammerRef.current.visible = false;
      particlesRef.current = [];
      return;
    }

    container.visible = true;
    container.alpha = 1;
    container.scale.set(1);
    container.rotation = 0;
    if (hammerRef.current) hammerRef.current.visible = true;

    const { word, animState, isSecondChance, reaction, strikeId } = activeMole;
    const color = TONE_COLORS[word.tone];

    drawBanner(bannerRef.current!, color);
    drawMole(moleRef.current!, reaction);
    drawHammer(hammerRef.current!, volume);

    hanziRef.current!.text = word.hanzi;
    hanziRef.current!.y = -102;

    pinyinRef.current!.text = word.pinyin;
    (pinyinRef.current!.style as TextStyle).fill = color;
    pinyinRef.current!.y = -130;

    secondChanceLabelRef.current!.visible = isSecondChance;
    secondChanceLabelRef.current!.y = -166;

    reactionRef.current!.text = reaction === 'angry' ? 'Hey!' : reaction === 'laugh' ? 'Haha!' : reaction === 'dizzy' ? 'BANG!' : '';
    reactionRef.current!.visible = reaction !== 'idle';
    reactionRef.current!.y = -34;

    animStateRef.current = animState;
    animTickRef.current = 0;
    impactSpawnedRef.current = false;

    particlesRef.current = [];

    if (strikeId !== lastStrikeRef.current) {
      lastStrikeRef.current = strikeId;
      swingRef.current = 1;
    }

  }, [activeMole?.animState, activeMole?.word?.id, activeMole?.isSecondChance, activeMole?.reaction, activeMole?.strikeId, activeMole, volume]);

  useTick(() => {
    const board = boardRef.current;
    const container = containerRef.current;
    const hammer = hammerRef.current;
    if (!board || !container || !hammer) return;

    if (
      lastBoardSizeRef.current.width !== app.renderer.width ||
      lastBoardSizeRef.current.height !== app.renderer.height
    ) {
      lastBoardSizeRef.current = { width: app.renderer.width, height: app.renderer.height };
      drawBoard(board, app.renderer.width, app.renderer.height);
    }

    const mole = activeMoleRef.current;
    if (!mole || !container.visible) {
      hammer.visible = false;
      return;
    }

    hammer.visible = true;
    container.x = mole.x;
    container.y = mole.y;
    container.scale.set(mole.scale);

    animTickRef.current += 1;
    const t = animTickRef.current;
    const animState = animStateRef.current;

    const bob = Math.sin(t * 0.08) * 2;
    if (animState === 'emerging') {
      container.y = mole.y + Math.max(0, 42 - t * 3);
    } else if (animState === 'active' || animState === 'listening') {
      container.y = mole.y + bob;
      if (animState === 'listening') {
        container.scale.set(mole.scale * (1 + Math.sin(t * 0.3) * 0.04));
      }
    } else if (animState === 'retry') {
      container.x = mole.x + Math.sin(t * 0.7) * 8;
    } else if (animState === 'hit') {
      const impactAge = Math.max(0, t - HIT_IMPACT_FRAME);
      const impactEase = easeOutBack(Math.min(1, impactAge / 16));
      const shake = Math.sin(impactAge * 1.25) * Math.max(0, 7 - impactAge * 0.32);
      const sink = Math.max(0, impactAge - 20) * 2.1;
      container.x = mole.x + shake;
      container.y = mole.y - Math.sin(impactEase * Math.PI) * 7 + sink;
      container.scale.set(
        mole.scale * (1 + Math.sin(impactEase * Math.PI) * 0.08),
        mole.scale * (1 - Math.sin(impactEase * Math.PI) * 0.08),
      );
      container.alpha = impactAge < 28 ? 1 : Math.max(0, 1 - (impactAge - 28) / 34);
    } else if (animState === 'escaping') {
      container.y = mole.y + Math.min(50, t * 3);
      container.alpha = Math.max(0, 1 - t / 34);
    }

    const voicePower = Math.min(1, volumeRef.current);
    const hammerScale = 0.62 + voicePower * 1.55;
    hammer.x = mole.x + 145;
    hammer.y = mole.y - 70 - voicePower * 28;
    if (swingRef.current > 0) {
      const swing = swingRef.current;
      const progress = 1 - swing;
      const windupEnd = 0.28;
      const impactEnd = 0.68;
      if (progress < windupEnd) {
        const eased = easeOutCubic(progress / windupEnd);
        hammer.rotation = -0.35 - eased * 0.9;
        hammer.x = mole.x + 104 + eased * 52;
        hammer.y = mole.y - 96 - eased * 42;
      } else if (progress < impactEnd) {
        const eased = easeInCubic((progress - windupEnd) / (impactEnd - windupEnd));
        hammer.rotation = -1.25 + eased * 1.95;
        hammer.x = mole.x + 156 - eased * 144;
        hammer.y = mole.y - 138 + eased * 74;
      } else {
        const eased = easeOutBack((progress - impactEnd) / (1 - impactEnd));
        hammer.rotation = 0.7 - eased * 1.0;
        hammer.x = mole.x + 12 + eased * 66;
        hammer.y = mole.y - 64 - eased * 46;
      }
      swingRef.current = Math.max(0, swing - 0.032);
    } else {
      hammer.rotation = -0.48 + Math.sin(t * 0.06) * 0.08 - voicePower * 0.18;
    }
    hammer.scale.set(swingRef.current > 0 ? Math.max(1.18, hammerScale) : hammerScale);
    drawHammer(hammer, voicePower);

    const pg = particleGfxRef.current!;
    pg.clear();
    if (animState === 'hit') {
      const impactAge = t - HIT_IMPACT_FRAME;
      if (impactAge >= 0 && !impactSpawnedRef.current) {
        impactSpawnedRef.current = true;
        particlesRef.current = createImpactParticles(mole.word.tone);
      }
      const ringLife = impactAge >= 0 ? Math.max(0, 1 - impactAge / 20) : 0;
      if (ringLife > 0) {
        pg.circle(0, -44, 30 + (1 - ringLife) * 76);
        pg.stroke({ color: 0xfff176, alpha: ringLife, width: 8 * ringLife });
        pg.circle(0, -44, 14 + (1 - ringLife) * 38);
        pg.stroke({ color: 0xffffff, alpha: ringLife * 0.9, width: 4 * ringLife });
      }
    }
    const nextParticles: Particle[] = [];
    for (const p of particlesRef.current) {
      const nextParticle = {
        ...p,
        x: p.x + p.vx,
        y: p.y + p.vy,
        vy: p.vy + 0.14,
        life: p.life - 0.032,
      };
      if (nextParticle.life > 0) {
        pg.circle(nextParticle.x, nextParticle.y, nextParticle.radius * nextParticle.life);
        pg.fill({ color: nextParticle.color, alpha: nextParticle.life * 0.9 });
        nextParticles.push(nextParticle);
      }
    }
    particlesRef.current = nextParticles;

    const reaction = reactionRef.current;
    if (reaction) {
      if (animState === 'hit') {
        const impactAge = t - HIT_IMPACT_FRAME;
        reaction.visible = true;
        reaction.y = -92 - Math.min(20, Math.max(0, impactAge) * 1.1);
        reaction.scale.set(impactAge < 0 ? 0.4 : Math.max(0.8, 1.85 - impactAge * 0.035));
        reaction.alpha = impactAge < 0 ? 0 : Math.max(0, 1 - Math.max(0, impactAge - 18) / 18);
      } else {
        reaction.scale.set(1);
        reaction.alpha = 1;
      }
    }
  });

  return null;
}

function createImpactParticles(tone: Tone): Particle[] {
  const color = TONE_COLORS[tone];
  const ps: Particle[] = [];
  for (let i = 0; i < 38; i++) {
    const angle = (i / 38) * Math.PI * 2;
    const speed = 2.2 + Math.random() * 4.6;
    ps.push({
      x: 0,
      y: -44,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 1.6,
      life: 1,
      color: Math.random() > 0.45 ? color : 0xffe066,
      radius: 3 + Math.random() * 6,
    });
  }
  return ps;
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

function drawBoard(gfx: Graphics, width: number, height: number) {
  gfx.clear();
  gfx.rect(0, 0, width, height);
  gfx.fill({ color: 0x6dd061 });

  gfx.rect(0, height * 0.58, width, height * 0.42);
  gfx.fill({ color: 0x58b950 });

  for (let y = 0; y < height; y += 34) {
    for (let x = (Math.floor(y / 34) % 2) * 17; x < width; x += 34) {
      gfx.rect(x, y, 17, 17);
      gfx.fill({ color: Math.random() > 0.5 ? 0x74dc66 : 0x62c957, alpha: 0.35 });
    }
  }

  gfx.circle(width * 0.18, height * 0.18, 46);
  gfx.fill({ color: 0xffffff, alpha: 0.24 });
  gfx.circle(width * 0.72, height * 0.14, 38);
  gfx.fill({ color: 0xffffff, alpha: 0.22 });

  const slots = getMoleSlots({ canvasWidth: width, canvasHeight: height });
  for (const slot of slots) {
    gfx.ellipse(slot.x, slot.y + 30, 84 * slot.scale, 34 * slot.scale);
    gfx.fill({ color: 0x3a2114 });
    gfx.ellipse(slot.x, slot.y + 24, 76 * slot.scale, 26 * slot.scale);
    gfx.fill({ color: 0x1c120d });
    gfx.ellipse(slot.x, slot.y + 18, 58 * slot.scale, 14 * slot.scale);
    gfx.fill({ color: 0x6b3f22, alpha: 0.38 });
  }
}

function drawBanner(gfx: Graphics, toneColor: number) {
  gfx.clear();
  gfx.roundRect(-72, -148, 144, 70, 8);
  gfx.fill({ color: 0xfff0c4 });
  gfx.stroke({ color: 0x6a4320, width: 4 });
  gfx.rect(-82, -118, 10, 9);
  gfx.rect(72, -118, 10, 9);
  gfx.fill({ color: toneColor });
}

function drawMole(gfx: Graphics, reaction: string) {
  gfx.clear();
  gfx.ellipse(0, 18, MOLE_WIDTH * 0.5, MOLE_HEIGHT * 0.48);
  gfx.fill({ color: 0x8a5738 });
  gfx.circle(-30, -18, 16);
  gfx.circle(30, -18, 16);
  gfx.fill({ color: 0x8a5738 });
  gfx.circle(-30, -18, 7);
  gfx.circle(30, -18, 7);
  gfx.fill({ color: 0x5b3523 });
  gfx.ellipse(0, 10, 18, 12);
  gfx.fill({ color: 0xf7a87a });
  gfx.circle(-16, 0, 4);
  gfx.circle(16, 0, 4);
  gfx.fill({ color: 0x1d130e });

  if (reaction === 'angry') {
    gfx.moveTo(-28, -8);
    gfx.lineTo(-8, -2);
    gfx.moveTo(28, -8);
    gfx.lineTo(8, -2);
    gfx.stroke({ color: 0x1d130e, width: 4 });
  } else if (reaction === 'laugh' || reaction === 'dizzy') {
    gfx.moveTo(-24, -2);
    gfx.lineTo(-10, -2);
    gfx.moveTo(24, -2);
    gfx.lineTo(10, -2);
    gfx.stroke({ color: 0x1d130e, width: 4 });
  }

  gfx.circle(-42, 24, 10);
  gfx.circle(42, 24, 10);
  gfx.fill({ color: 0xf2a36e });
}

function drawHammer(gfx: Graphics, volume: number) {
  gfx.clear();
  const glow = Math.min(0.8, volume);
  if (glow > 0.08) {
    gfx.circle(-2, -2, 42 + glow * 18);
    gfx.fill({ color: 0xfff176, alpha: glow * 0.25 });
  }
  gfx.roundRect(-50, -26, 92, 48, 9);
  gfx.fill({ color: 0x9aa7b2 });
  gfx.stroke({ color: 0x5c6870, width: 4 });
  gfx.rect(-8, 20, 20, 96);
  gfx.fill({ color: 0x9b5b27 });
  gfx.stroke({ color: 0x5f3519, width: 3 });
  gfx.rect(-38, -16, 28, 28);
  gfx.fill({ color: 0xc9d5df, alpha: 0.75 });
}

interface MoleCanvasProps {
  gameState: GameState | null;
  activeMoleRef: RefObject<MoleState | null>;
  volume: number;
}

export function MoleCanvas({ gameState, activeMoleRef, volume }: MoleCanvasProps) {
  return (
    <Application
      background={0x74dc66}
      resizeTo={window}
      antialias={false}
    >
      <MoleRenderer
        activeMole={gameState?.activeMole ?? null}
        activeMoleRef={activeMoleRef}
        volume={volume}
      />
    </Application>
  );
}
