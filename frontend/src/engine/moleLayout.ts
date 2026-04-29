import type { MoleState } from '../types/game';

export interface BoardConfig {
  canvasWidth: number;
  canvasHeight: number;
}

export interface MoleSlot {
  slotIndex: number;
  x: number;
  y: number;
  scale: number;
}

const COLS = 3;
const ROWS = 2;
export const MOLE_SLOT_COUNT = COLS * ROWS;

export function getMoleSlots(config: BoardConfig): MoleSlot[] {
  const boardWidth = Math.min(config.canvasWidth * 0.78, 860);
  const colGap = boardWidth / (COLS - 1);
  const startX = (config.canvasWidth - boardWidth) / 2;
  const topY = config.canvasHeight * 0.43;
  const rowGap = Math.min(config.canvasHeight * 0.24, 190);

  return Array.from({ length: MOLE_SLOT_COUNT }, (_, slotIndex) => {
    const col = slotIndex % COLS;
    const row = Math.floor(slotIndex / COLS);
    return {
      slotIndex,
      x: startX + col * colGap,
      y: topY + row * rowGap,
      scale: row === 0 ? 0.92 : 1,
    };
  });
}

export function pickMoleSlot(config: BoardConfig, previousSlotIndex: number | null): MoleSlot {
  const slots = getMoleSlots(config);
  const choices = slots.filter(slot => slot.slotIndex !== previousSlotIndex);
  return choices[Math.floor(Math.random() * choices.length)] ?? slots[0];
}

export function isMoleVisible(mole: MoleState | null): boolean {
  return Boolean(mole && mole.animState !== 'hidden');
}
