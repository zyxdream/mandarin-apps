import type { Word } from '../types/word';
import type { GameState, MoleReaction, MoleState, EvalResult } from '../types/game';
import type { PronunciationEvaluator } from '../types/evaluator';
import { shuffleWords } from '../data/words';
import { getMoleSlots, pickMoleSlot, type BoardConfig } from './moleLayout';
import { scoreForResult } from './scoring';

export type EngineEvent =
  | { type: 'stateChanged'; state: Readonly<GameState> }
  | { type: 'gameOver'; finalState: Readonly<GameState> };

type EngineListener = (event: EngineEvent) => void;

const ROUND_SECONDS = 45;
const SECOND_CHANCE_INTERVAL_MS = 4500;
const CONSECUTIVE_MISS_THRESHOLD = 3;
const SECOND_CHANCE_PROBABILITY = 0.40;
const HIT_ANIM_MS = 620;
const MISS_RETRY_MS = 760;
const MOLE_VISIBLE_MS = 4300;
const EMERGE_MS = 260;
const SECOND_CHANCE_BONUS = 10;
const MAX_SECOND_CHANCE_QUEUE = 3;

export class GameEngine {
  private state: GameState;
  private wordQueue: Word[];
  private readonly listeners = new Set<EngineListener>();
  private countdownHandle: ReturnType<typeof setInterval> | null = null;
  private secondChanceHandle: ReturnType<typeof setInterval> | null = null;
  private activeMoleTimeout: ReturnType<typeof setTimeout> | null = null;
  private readonly evaluator: PronunciationEvaluator;
  private canvas: BoardConfig;
  private evaluating = false;
  private lastSlotIndex: number | null = null;
  private strikeId = 0;

  constructor(words: Word[], evaluator: PronunciationEvaluator, canvas?: BoardConfig) {
    this.evaluator = evaluator;
    this.wordQueue = shuffleWords(words);
    this.canvas = canvas ?? { canvasWidth: window.innerWidth, canvasHeight: window.innerHeight };
    this.state = this.initialState();
  }

  subscribe(listener: EngineListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  setCanvasSize(canvas: BoardConfig): void {
    this.canvas = canvas;
    if (!this.state.activeMole) return;

    const slot = getMoleSlots(canvas)[this.state.activeMole.slotIndex];
    if (!slot) return;

    this.setState({
      activeMole: {
        ...this.state.activeMole,
        x: slot.x,
        y: slot.y,
        scale: slot.scale,
      },
    });
  }

  start(): void {
    if (this.countdownHandle) return;
    this.state = this.initialState();
    this.spawnNextMole(false);

    this.countdownHandle = setInterval(() => this.countdown(), 1000);
    this.secondChanceHandle = setInterval(() => this.trySpawnSecondChance(), SECOND_CHANCE_INTERVAL_MS);
  }

  stop(): void {
    if (this.countdownHandle) clearInterval(this.countdownHandle);
    if (this.secondChanceHandle) clearInterval(this.secondChanceHandle);
    if (this.activeMoleTimeout) clearTimeout(this.activeMoleTimeout);
    this.countdownHandle = null;
    this.secondChanceHandle = null;
    this.activeMoleTimeout = null;
  }

  async submitEvaluation(audioBlob: Blob): Promise<void> {
    if (!this.state.activeMole || this.evaluating) return;
    if (this.state.activeMole.animState !== 'active' && this.state.activeMole.animState !== 'retry') return;

    const word = this.state.activeMole.word;
    this.evaluating = true;
    this.clearActiveMoleTimeout();
    const evaluationStartedAt = performance.now();
    console.log('[latency] game evaluation start', {
      word: word.hanzi,
      bytes: audioBlob.size,
    });

    this.setState({
      activeMole: {
        ...this.state.activeMole,
        animState: 'listening',
      },
      isEvaluating: true,
    });

    let result: EvalResult;
    try {
      result = await this.evaluator.evaluate(audioBlob, word);
    } catch {
      result = { success: false, confidence: 0, wordId: word.id };
    }

    this.evaluating = false;
    this.setState({ isEvaluating: false });
    console.log('[latency] game evaluation result', {
      word: word.hanzi,
      success: result.success,
      confidence: result.confidence,
      elapsedMs: Math.round(performance.now() - evaluationStartedAt),
    });
    this.handleResult(result);
  }

  private handleResult(result: EvalResult): void {
    if (this.state.screen !== 'game') return;
    this.setState({
      lastHint: result.hintCode && result.hintText
        ? {
            code: result.hintCode,
            text: result.hintText,
            transcript: result.transcript,
            confidence: result.confidence,
          }
        : null,
    });
    if (result.success) {
      this.handleSuccess();
    } else {
      this.handleMiss();
    }
  }

  private handleSuccess(): void {
    if (!this.state.activeMole) return;
    const word = this.state.activeMole.word;
    const newCombo = this.state.combo + 1;
    const earned = scoreForResult(word, newCombo) + (this.state.activeMole.isSecondChance ? SECOND_CHANCE_BONUS : 0);
    console.log('[latency] confirmed bonk triggered', {
      word: word.hanzi,
      strikeId: this.strikeId + 1,
    });

    this.setState({
      activeMole: { ...this.state.activeMole, animState: 'hit', reaction: 'dizzy', strikeId: ++this.strikeId },
      score: this.state.score + earned,
      combo: newCombo,
      wordsHit: [...this.state.wordsHit, word],
      consecutiveMissCount: 0,
    });

    setTimeout(() => {
      if (this.state.screen !== 'game') return;
      this.setState({ activeMole: null });
      this.spawnNextMole(false);
    }, HIT_ANIM_MS);
  }

  private handleMiss(): void {
    if (!this.state.activeMole) return;
    const word = this.state.activeMole.word;
    const newSecondChanceQueue = this.enqueueSecondChance(word);

    const newConsecutiveMissCount = this.state.consecutiveMissCount + 1;
    const reaction: MoleReaction = Math.random() > 0.5 ? 'angry' : 'laugh';

    this.setState({
      activeMole: { ...this.state.activeMole, animState: 'retry', reaction },
      combo: 0,
      wordsMissed: [...this.state.wordsMissed, word],
      secondChanceQueue: newSecondChanceQueue,
      consecutiveMissCount: newConsecutiveMissCount,
    });

    setTimeout(() => {
      if (!this.state.activeMole || this.state.activeMole.word.id !== word.id) return;
      this.setState({
        activeMole: { ...this.state.activeMole, animState: 'active', reaction: 'idle' },
      });
      this.armActiveMoleTimeout();
    }, MISS_RETRY_MS);

    if (newConsecutiveMissCount >= CONSECUTIVE_MISS_THRESHOLD) {
      setTimeout(() => this.trySpawnSecondChance(), 500);
    }
  }

  private handleAutoMiss(mole: MoleState): void {
    const word = mole.word;
    const newSecondChanceQueue = this.enqueueSecondChance(word);

    this.setState({
      activeMole: { ...mole, animState: 'escaping', reaction: 'laugh' },
      combo: 0,
      wordsMissed: [...this.state.wordsMissed, word],
      secondChanceQueue: newSecondChanceQueue,
      consecutiveMissCount: this.state.consecutiveMissCount + 1,
    });

    setTimeout(() => {
      if (this.state.screen !== 'game') return;
      if (!this.state.activeMole || this.state.activeMole.word.id !== word.id) return;
      this.setState({ activeMole: null });
      this.spawnNextMole(false);
    }, HIT_ANIM_MS);
  }

  private countdown(): void {
    const newTime = this.state.timeRemaining - 1;
    if (newTime <= 0) {
      this.stop();
      this.setState({ timeRemaining: 0, screen: 'result', activeMole: null });
      this.emit({ type: 'gameOver', finalState: this.state });
      return;
    }
    this.setState({ timeRemaining: newTime });
  }

  private trySpawnSecondChance(): void {
    if (this.state.secondChanceQueue.length === 0) return;
    if (this.state.activeMole !== null) return;

    const queue = [...this.state.secondChanceQueue];
    const word = queue.shift()!;
    this.setState({
      secondChanceQueue: queue,
      consecutiveMissCount: 0,
    });
    this.spawnMole(word, true);
  }

  private spawnNextMole(isSecondChance: boolean): void {
    if (this.state.screen !== 'game') return;

    if (isSecondChance && this.state.secondChanceQueue.length > 0) {
      const queue = [...this.state.secondChanceQueue];
      const word = queue.shift()!;
      this.setState({ secondChanceQueue: queue, consecutiveMissCount: 0 });
      this.spawnMole(word, true);
      return;
    }

    if (this.state.secondChanceQueue.length > 0 && Math.random() < 0.35) {
      const queue = [...this.state.secondChanceQueue];
      const word = queue.shift()!;
      this.setState({ secondChanceQueue: queue, consecutiveMissCount: 0 });
      this.spawnMole(word, true);
      return;
    }

    if (this.wordQueue.length === 0) {
      this.wordQueue = shuffleWords(
        this.state.wordsHit.length > 0 || this.state.wordsMissed.length > 0
          ? [...this.state.wordsHit, ...this.state.wordsMissed]
          : [],
      );
    }

    if (this.wordQueue.length === 0) return;
    const word = this.wordQueue.shift()!;
    this.spawnMole(word, false);
  }

  private spawnMole(word: Word, isSecondChance: boolean): void {
    const slot = pickMoleSlot(this.canvas, this.lastSlotIndex);
    this.lastSlotIndex = slot.slotIndex;
    const mole: MoleState = {
      word,
      animState: 'emerging',
      reaction: 'idle',
      slotIndex: slot.slotIndex,
      x: slot.x,
      y: slot.y,
      scale: slot.scale,
      alpha: 1,
      isSecondChance,
      strikeId: this.strikeId,
    };
    this.setState({ activeMole: mole });

    setTimeout(() => {
      if (!this.state.activeMole || this.state.activeMole.word.id !== word.id) return;
      this.setState({ activeMole: { ...this.state.activeMole, animState: 'active' } });
      this.armActiveMoleTimeout();
    }, EMERGE_MS);
  }

  private emit(event: EngineEvent): void {
    this.listeners.forEach(l => l(event));
  }

  private setState(patch: Partial<GameState>): void {
    this.state = { ...this.state, ...patch };
    this.emit({ type: 'stateChanged', state: this.state });
  }

  private initialState(): GameState {
    return {
      screen: 'game',
      activeMole: null,
      score: 0,
      combo: 0,
      timeRemaining: ROUND_SECONDS,
      wordsHit: [],
      wordsMissed: [],
      secondChanceQueue: [],
      consecutiveMissCount: 0,
      lastHint: null,
      isEvaluating: false,
    };
  }

  private enqueueSecondChance(word: Word): Word[] {
    const queue = [...this.state.secondChanceQueue];
    if (Math.random() < SECOND_CHANCE_PROBABILITY && !queue.some(item => item.id === word.id)) {
      queue.push(word);
    }
    return queue.slice(-MAX_SECOND_CHANCE_QUEUE);
  }

  private armActiveMoleTimeout(): void {
    this.clearActiveMoleTimeout();
    this.activeMoleTimeout = setTimeout(() => {
      if (!this.state.activeMole || this.evaluating) return;
      this.handleAutoMiss(this.state.activeMole);
    }, MOLE_VISIBLE_MS);
  }

  private clearActiveMoleTimeout(): void {
    if (this.activeMoleTimeout) clearTimeout(this.activeMoleTimeout);
    this.activeMoleTimeout = null;
  }
}
