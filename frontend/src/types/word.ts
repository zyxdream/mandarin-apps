export type Tone = 1 | 2 | 3 | 4;

export type Difficulty = 'easy' | 'medium' | 'hard';

export interface Word {
  id: string;
  hanzi: string;
  pinyin: string;
  pinyinRaw: string;
  tone: Tone;
  difficulty: Difficulty;
  creatureName: string;
  scoreValue: number;
}
