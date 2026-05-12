import type { Word } from '../types/word.js';
import type { GameState, MoleAnimState, MoleReaction, MoleState, EvalResult } from '../types/game.js';
import type { PronunciationEvaluator } from '../types/evaluator.js';
import { shuffleWords } from '../data/words.js';
import { getMoleSlots, pickMoleSlot, type BoardConfig } from './moleLayout.js';
import { scoreForResult } from './scoring.js';

export type EngineEvent =
  | { type: 'stateChanged'; state: Readonly<GameState> }
  | { type: 'gameOver'; finalState: Readonly<GameState> };

type EngineListener = (event: EngineEvent) => void;

interface GameEngineOptions {
  preserveWordOrder?: boolean;
}

type TimerKey =
  | 'countdown'
  | 'emerge'
  | 'activeMoleTimeout'
  | 'retry'
  | 'hardWordTimeout'
  | 'hintClear'
  | 'postHit'
  | 'postEscape'
  | 'nextMole';

interface PausableTimerState {
  armed: boolean;
  callback: (() => void) | null;
  remainingMs: number;
  startedAtMs: number;
  handle: ReturnType<typeof setTimeout> | null;
}

interface PendingEvaluation {
  result: EvalResult;
  wordId: string;
  wordLife: number;
}

const HIT_ANIM_MS = 1180;
const MISS_FEEDBACK_MS = 1080;
const NEXT_MOLE_DELAY_MS = 450;
const SUCCESS_NEXT_MOLE_DELAY_MS = 120;
const SUCCESS_NEXT_MOLE_LEAD_MS = 320;
const TIMEOUT_NEXT_MOLE_DELAY_MS = 120;
const MOLE_VISIBLE_MS = 10000;
const ONE_HANZI_MOLE_VISIBLE_MS = 7000;
const TWO_HANZI_MOLE_VISIBLE_MS = 8000;
const WORD_HARD_TIMEOUT_MS = 15000;
const SUCCESS_HINT_MS = 850;
const EMERGE_MS = 260;
const COUNTDOWN_TICK_MS = 1000;
const SUCCESS_HINTS = ['Great', 'Amazing', 'Fantastic'] as const;
const CJK_HANZI_RE = /[\u3400-\u9fff]/g;
const TIMER_KEYS: TimerKey[] = [
  'countdown',
  'emerge',
  'activeMoleTimeout',
  'retry',
  'hardWordTimeout',
  'hintClear',
  'postHit',
  'postEscape',
  'nextMole',
];

function createTimerState(): PausableTimerState {
  return {
    armed: false,
    callback: null,
    remainingMs: 0,
    startedAtMs: 0,
    handle: null,
  };
}

export class GameEngine {
  private state: GameState;
  private wordQueue: Word[];
  private readonly listeners = new Set<EngineListener>();
  private readonly timers: Record<TimerKey, PausableTimerState> = {
    countdown: createTimerState(),
    emerge: createTimerState(),
    activeMoleTimeout: createTimerState(),
    retry: createTimerState(),
    hardWordTimeout: createTimerState(),
    hintClear: createTimerState(),
    postHit: createTimerState(),
    postEscape: createTimerState(),
    nextMole: createTimerState(),
  };
  private readonly evaluator: PronunciationEvaluator;
  private canvas: BoardConfig;
  private evaluating = false;
  private running = false;
  private pendingEvaluation: PendingEvaluation | null = null;
  private lastSlotIndex: number | null = null;
  private strikeId = 0;
  private wordLifeCounter = 0;

  constructor(words: Word[], evaluator: PronunciationEvaluator, canvas?: BoardConfig, options?: GameEngineOptions) {
    this.evaluator = evaluator;
    this.wordQueue = options?.preserveWordOrder ? [...words] : shuffleWords(words);
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
    if (this.running) return;
    this.running = true;
    this.pendingEvaluation = null;
    this.clearAllTimers();
    this.state = this.initialState();
    this.spawnNextMole();
    this.scheduleCountdownTick();
  }

  stop(): void {
    this.clearAllTimers();
    this.evaluating = false;
    this.pendingEvaluation = null;
    this.running = false;
  }

  togglePause(): void {
    if (!this.running || this.state.screen !== 'game') return;
    if (this.state.isPaused) {
      this.resume();
      return;
    }
    this.pause();
  }

  private pause(): void {
    if (this.state.isPaused) return;
    this.pauseAllTimers();
    this.setState({ isPaused: true });
  }

  private resume(): void {
    if (!this.state.isPaused) return;
    this.setState({ isPaused: false });
    this.resumeAllTimers();
    this.flushPendingEvaluation();
  }

  async submitEvaluation(audioBlob: Blob): Promise<void> {
    if (this.state.isPaused) return;
    if (!this.state.activeMole || this.evaluating) return;
    if (this.state.activeMole.animState !== 'active' && this.state.activeMole.animState !== 'retry') return;

    const word = this.state.activeMole.word;
    const wordLife = this.wordLifeCounter;
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
      result = { success: false, confidence: 0, wordId: word.id, error: true };
    }

    this.evaluating = false;
    console.log('[latency] game evaluation result', {
      word: word.hanzi,
      success: result.success,
      confidence: result.confidence,
      elapsedMs: Math.round(performance.now() - evaluationStartedAt),
    });

    if (this.state.isPaused) {
      this.pendingEvaluation = { result, wordId: word.id, wordLife };
      return;
    }

    this.applyEvaluationResult(result, word.id, wordLife);
  }

  private applyEvaluationResult(result: EvalResult, wordId: string, wordLife: number): void {
    if (!this.canApplyEvaluationResult(wordId, wordLife)) {
      if (this.state.isEvaluating) {
        this.setState({ isEvaluating: false });
      }
      return;
    }
    this.handleResult(result);
  }

  private canApplyEvaluationResult(wordId: string, wordLife: number): boolean {
    if (this.state.screen !== 'game') return false;
    if (this.wordLifeCounter !== wordLife) return false;
    const activeMole = this.state.activeMole;
    if (!activeMole || activeMole.word.id !== wordId) return false;
    return this.isActionableMoleState(activeMole.animState);
  }

  private flushPendingEvaluation(): void {
    const pending = this.pendingEvaluation;
    if (!pending) return;
    this.pendingEvaluation = null;
    this.applyEvaluationResult(pending.result, pending.wordId, pending.wordLife);
  }

  private buildEvalHint(result: EvalResult): GameState['lastHint'] {
    if (!result.hintCode || !result.hintText) {
      if (!result.transcript && !result.transcriptPinyin) return null;
      return {
        code: result.success ? 'heard_correct' : 'heard_retry',
        text: result.success ? this.randomSuccessHint() : 'Try that sound again',
        transcript: result.transcript,
        transcriptPinyin: result.transcriptPinyin,
        confidence: result.confidence,
      };
    }
    return {
      code: result.hintCode,
      text: result.hintText,
      transcript: result.transcript,
      transcriptPinyin: result.transcriptPinyin,
      confidence: result.confidence,
    };
  }

  private handleResult(result: EvalResult): void {
    if (this.state.screen !== 'game') return;
    const lastHint = this.buildEvalHint(result);

    if (result.error) {
      if (!this.state.activeMole) return;
      this.setState({
        lastHint,
        isEvaluating: false,
        activeMole: { ...this.state.activeMole, animState: 'active', reaction: 'idle' },
      });
      this.armActiveMoleTimeout();
      return;
    }

    if (result.success) {
      this.handleSuccess(lastHint);
    } else {
      this.handleMiss(lastHint);
    }
  }

  private handleSuccess(lastHint: GameState['lastHint']): void {
    if (!this.state.activeMole) return;
    this.clearRetryTimeout();
    this.clearHardWordTimeout();
    const word = this.state.activeMole.word;
    const newCombo = this.state.combo + 1;
    const earned = scoreForResult(word, newCombo);
    console.log('[latency] confirmed bonk triggered', {
      word: word.hanzi,
      strikeId: this.strikeId + 1,
    });

    this.setState({
      lastHint,
      isEvaluating: false,
      activeMole: { ...this.state.activeMole, animState: 'hit', reaction: 'dizzy', strikeId: ++this.strikeId },
      score: this.state.score + earned,
      combo: newCombo,
      wordsHit: [...this.state.wordsHit, word],
      consecutiveMissCount: 0,
    });
    this.armSuccessHintClear(lastHint);

    this.scheduleTimer('postHit', Math.max(0, HIT_ANIM_MS - SUCCESS_NEXT_MOLE_LEAD_MS), () => {
      if (this.state.screen !== 'game') return;
      this.setState({ activeMole: null, lastHint: this.isSuccessHint(this.state.lastHint) ? null : this.state.lastHint });
      this.scheduleNextMole(SUCCESS_NEXT_MOLE_DELAY_MS);
    });
  }

  private handleMiss(lastHint: GameState['lastHint']): void {
    if (!this.state.activeMole) return;
    this.clearRetryTimeout();
    const reaction: MoleReaction = Math.random() > 0.5 ? 'angry' : 'laugh';

    this.setState({
      lastHint,
      isEvaluating: false,
      activeMole: { ...this.state.activeMole, animState: 'retry', reaction },
      combo: 0,
    });

    const retryWordId = this.state.activeMole.word.id;
    this.scheduleTimer('retry', MISS_FEEDBACK_MS, () => {
      if (!this.state.activeMole || this.state.activeMole.word.id !== retryWordId) return;
      if (this.state.screen !== 'game') return;
      this.setState({
        activeMole: { ...this.state.activeMole, animState: 'active', reaction: 'idle' },
      });
      this.armActiveMoleTimeout();
    });
  }

  private handleAutoMiss(mole: MoleState): void {
    this.cancelActiveEvaluation();
    this.clearRetryTimeout();
    this.clearHardWordTimeout();
    const word = mole.word;

    this.setState({
      activeMole: { ...mole, animState: 'escaping', reaction: 'idle' },
      combo: 0,
      wordsMissed: [...this.state.wordsMissed, word],
    });

    this.scheduleTimer('postEscape', HIT_ANIM_MS, () => {
      if (this.state.screen !== 'game') return;
      if (!this.state.activeMole || this.state.activeMole.word.id !== word.id) return;
      this.setState({ activeMole: null });
      this.scheduleNextMole(TIMEOUT_NEXT_MOLE_DELAY_MS);
    });
  }

  private scheduleCountdownTick(): void {
    this.scheduleTimer('countdown', COUNTDOWN_TICK_MS, () => {
      this.countdown();
      if (this.state.screen === 'game') {
        this.scheduleCountdownTick();
      }
    });
  }

  private countdown(): void {
    if (this.state.screen !== 'game') return;
    if (this.state.isPaused) return;
    if (!this.state.activeMole) return;
    if (!this.isActionableMoleState(this.state.activeMole.animState)) return;

    const newTime = Math.max(0, this.state.timeRemaining - 1);
    if (newTime !== this.state.timeRemaining) {
      this.setState({ timeRemaining: newTime });
    }
  }

  private isActionableMoleState(animState: MoleAnimState): boolean {
    return animState === 'active' || animState === 'retry' || animState === 'listening';
  }

  private spawnNextMole(): void {
    if (this.state.screen !== 'game') return;

    if (this.wordQueue.length === 0) {
      if (this.state.activeMole) {
        return;
      }
      this.endGame();
      return;
    }

    const word = this.wordQueue.shift()!;
    this.spawnMole(word, false);
  }

  private scheduleNextMole(delayMs = NEXT_MOLE_DELAY_MS): void {
    this.scheduleTimer('nextMole', delayMs, () => {
      if (this.state.screen !== 'game' || this.state.activeMole) return;
      this.spawnNextMole();
    });
  }

  private spawnMole(word: Word, isSecondChance: boolean): void {
    const wordLife = ++this.wordLifeCounter;
    this.armHardWordTimeout(word, wordLife);
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
    this.clearHintClearTimeout();
    this.setState({ activeMole: mole, lastHint: null });

    this.scheduleTimer('emerge', EMERGE_MS, () => {
      if (wordLife !== this.wordLifeCounter) return;
      if (!this.state.activeMole || this.state.activeMole.word.id !== word.id) return;
      this.setState({ activeMole: { ...this.state.activeMole, animState: 'active' } });
      this.armActiveMoleTimeout();
    });
  }

  private emit(event: EngineEvent): void {
    this.listeners.forEach(l => l(event));
  }

  private setState(patch: Partial<GameState>): void {
    this.state = { ...this.state, ...patch };
    this.emit({ type: 'stateChanged', state: this.state });
  }

  private initialState(): GameState {
    const totalVisibleMs = this.wordQueue.reduce((sum, word) => sum + this.visibleTimeoutMsForWord(word), 0);
    const initialRoundSeconds = Math.max(1, Math.ceil(totalVisibleMs / 1000));
    return {
      screen: 'game',
      activeMole: null,
      score: 0,
      combo: 0,
      timeRemaining: initialRoundSeconds,
      isPaused: false,
      wordsHit: [],
      wordsMissed: [],
      secondChanceQueue: [],
      consecutiveMissCount: 0,
      lastHint: null,
      isEvaluating: false,
    };
  }

  private armActiveMoleTimeout(): void {
    this.clearActiveMoleTimeout();
    if (!this.state.activeMole) return;
    const timeoutMs = this.visibleTimeoutMsForWord(this.state.activeMole.word);
    this.scheduleTimer('activeMoleTimeout', timeoutMs, () => {
      if (!this.state.activeMole || this.evaluating) return;
      this.handleAutoMiss(this.state.activeMole);
    });
  }

  private visibleTimeoutMsForWord(word: Word): number {
    const hanziCount = (word.hanzi.match(CJK_HANZI_RE) ?? []).length;
    if (hanziCount <= 1) return ONE_HANZI_MOLE_VISIBLE_MS;
    if (hanziCount === 2) return TWO_HANZI_MOLE_VISIBLE_MS;
    return MOLE_VISIBLE_MS;
  }

  private clearActiveMoleTimeout(): void {
    this.clearTimer('activeMoleTimeout');
  }

  private clearRetryTimeout(): void {
    this.clearTimer('retry');
  }

  private clearHardWordTimeout(): void {
    this.clearTimer('hardWordTimeout');
  }

  private clearHintClearTimeout(): void {
    this.clearTimer('hintClear');
  }

  private randomSuccessHint(): string {
    return SUCCESS_HINTS[Math.floor(Math.random() * SUCCESS_HINTS.length)];
  }

  private isSuccessHint(hint: GameState['lastHint']): boolean {
    return hint?.code === 'heard_correct';
  }

  private armSuccessHintClear(hint: GameState['lastHint']): void {
    this.clearHintClearTimeout();
    if (!this.isSuccessHint(hint)) return;
    this.scheduleTimer('hintClear', SUCCESS_HINT_MS, () => {
      if (this.state.screen !== 'game') return;
      if (this.state.lastHint !== hint) return;
      this.setState({ lastHint: null });
    });
  }

  private armHardWordTimeout(word: Word, wordLife: number): void {
    this.clearHardWordTimeout();
    this.scheduleTimer('hardWordTimeout', WORD_HARD_TIMEOUT_MS, () => {
      if (this.state.screen !== 'game') return;
      if (wordLife !== this.wordLifeCounter) return;
      const activeMole = this.state.activeMole;
      if (!activeMole || activeMole.word.id !== word.id) return;
      if (activeMole.animState === 'hit' || activeMole.animState === 'escaping') return;
      this.clearActiveMoleTimeout();
      this.handleAutoMiss(activeMole);
    });
  }

  private cancelActiveEvaluation(): void {
    if (!this.evaluating) return;
    this.evaluating = false;
    this.pendingEvaluation = null;
    if (this.state.isEvaluating) {
      this.setState({ isEvaluating: false });
    }
  }

  private endGame(): void {
    if (this.state.screen !== 'game') return;
    this.stop();
    this.setState({ screen: 'result', activeMole: null, isEvaluating: false, isPaused: false, timeRemaining: 0 });
    this.emit({ type: 'gameOver', finalState: this.state });
  }

  private scheduleTimer(key: TimerKey, delayMs: number, callback: () => void): void {
    this.clearTimer(key);
    const timer = this.timers[key];
    timer.armed = true;
    timer.callback = callback;
    timer.remainingMs = Math.max(0, Math.round(delayMs));
    if (this.state.isPaused) return;
    this.armTimerHandle(key);
  }

  private armTimerHandle(key: TimerKey): void {
    const timer = this.timers[key];
    if (!timer.armed || !timer.callback || timer.handle) return;
    timer.startedAtMs = Date.now();
    timer.handle = setTimeout(() => this.fireTimer(key), timer.remainingMs);
  }

  private fireTimer(key: TimerKey): void {
    const timer = this.timers[key];
    if (!timer.armed || !timer.callback) return;

    const callback = timer.callback;
    timer.armed = false;
    timer.callback = null;
    timer.remainingMs = 0;
    timer.startedAtMs = 0;
    timer.handle = null;
    callback();
  }

  private clearTimer(key: TimerKey): void {
    const timer = this.timers[key];
    if (timer.handle) {
      clearTimeout(timer.handle);
    }
    timer.armed = false;
    timer.callback = null;
    timer.remainingMs = 0;
    timer.startedAtMs = 0;
    timer.handle = null;
  }

  private clearAllTimers(): void {
    for (const key of TIMER_KEYS) {
      this.clearTimer(key);
    }
  }

  private pauseAllTimers(): void {
    const now = Date.now();
    for (const key of TIMER_KEYS) {
      const timer = this.timers[key];
      if (!timer.armed || !timer.handle) continue;
      const elapsedMs = Math.max(0, now - timer.startedAtMs);
      timer.remainingMs = Math.max(0, timer.remainingMs - elapsedMs);
      clearTimeout(timer.handle);
      timer.handle = null;
      timer.startedAtMs = 0;
    }
  }

  private resumeAllTimers(): void {
    for (const key of TIMER_KEYS) {
      this.armTimerHandle(key);
    }
  }
}
