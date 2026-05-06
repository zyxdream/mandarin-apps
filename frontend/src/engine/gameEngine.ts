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

const ROUND_SECONDS = 60;
const HIT_ANIM_MS = 1180;
const MISS_FEEDBACK_MS = 1080;
const NEXT_MOLE_DELAY_MS = 450;
const MOLE_VISIBLE_MS = 10000;
const WORD_HARD_TIMEOUT_MS = 15000;
const EMERGE_MS = 260;
const MIN_SECONDS_TO_SPAWN_MOLE = 7;

export class GameEngine {
  private state: GameState;
  private wordQueue: Word[];
  private readonly listeners = new Set<EngineListener>();
  private countdownHandle: ReturnType<typeof setInterval> | null = null;
  private activeMoleTimeout: ReturnType<typeof setTimeout> | null = null;
  private retryHandle: ReturnType<typeof setTimeout> | null = null;
  private hardWordTimeoutHandle: ReturnType<typeof setTimeout> | null = null;
  private readonly evaluator: PronunciationEvaluator;
  private canvas: BoardConfig;
  private evaluating = false;
  private endAfterEvaluation = false;
  private lastSlotIndex: number | null = null;
  private strikeId = 0;
  private wordLifeCounter = 0;

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
    this.spawnNextMole();

    this.countdownHandle = setInterval(() => this.countdown(), 1000);
  }

  stop(): void {
    if (this.countdownHandle) clearInterval(this.countdownHandle);
    if (this.activeMoleTimeout) clearTimeout(this.activeMoleTimeout);
    if (this.retryHandle) clearTimeout(this.retryHandle);
    if (this.hardWordTimeoutHandle) clearTimeout(this.hardWordTimeoutHandle);
    this.countdownHandle = null;
    this.activeMoleTimeout = null;
    this.retryHandle = null;
    this.hardWordTimeoutHandle = null;
    this.evaluating = false;
    this.endAfterEvaluation = false;
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
      result = { success: false, confidence: 0, wordId: word.id, error: true };
    }

    this.evaluating = false;
    console.log('[latency] game evaluation result', {
      word: word.hanzi,
      success: result.success,
      confidence: result.confidence,
      elapsedMs: Math.round(performance.now() - evaluationStartedAt),
    });
    if (this.endAfterEvaluation) {
      this.handleFinalResult(result);
      return;
    }

    this.handleResult(result);
  }

  private buildEvalHint(result: EvalResult): GameState['lastHint'] {
    if (!result.hintCode || !result.hintText) {
      if (!result.transcript && !result.transcriptPinyin) return null;
      return {
        code: result.success ? 'heard_correct' : 'heard_retry',
        text: result.success ? 'Correct pronunciation' : 'Try that sound again',
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

    setTimeout(() => {
      if (this.state.screen !== 'game') return;
      this.setState({ activeMole: null });
      this.scheduleNextMole();
    }, HIT_ANIM_MS);
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
    this.retryHandle = setTimeout(() => {
      this.retryHandle = null;
      if (!this.state.activeMole || this.state.activeMole.word.id !== retryWordId) return;
      if (this.state.screen !== 'game') return;
      this.setState({
        activeMole: { ...this.state.activeMole, animState: 'active', reaction: 'idle' },
      });
      this.armActiveMoleTimeout();
    }, MISS_FEEDBACK_MS);
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

    setTimeout(() => {
      if (this.state.screen !== 'game') return;
      if (!this.state.activeMole || this.state.activeMole.word.id !== word.id) return;
      this.setState({ activeMole: null });
      this.scheduleNextMole();
    }, HIT_ANIM_MS);
  }

  private countdown(): void {
    const newTime = this.state.timeRemaining - 1;
    if (newTime <= 0) {
      this.setState({ timeRemaining: 0 });
      this.finishRound();
      return;
    }
    this.setState({ timeRemaining: newTime });
  }

  private spawnNextMole(): void {
    if (this.state.screen !== 'game') return;

    if (!this.hasEnoughTimeForNewMole()) {
      this.finishRound();
      return;
    }

    if (this.wordQueue.length === 0) {
      this.endGame();
      return;
    }

    const word = this.wordQueue.shift()!;
    this.spawnMole(word, false);
  }

  private scheduleNextMole(): void {
    setTimeout(() => {
      if (this.state.screen !== 'game' || this.state.activeMole) return;
      if (!this.hasEnoughTimeForNewMole()) {
        this.finishRound();
        return;
      }
      this.spawnNextMole();
    }, NEXT_MOLE_DELAY_MS);
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
    this.setState({ activeMole: mole });

    setTimeout(() => {
      if (wordLife !== this.wordLifeCounter) return;
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

  private armActiveMoleTimeout(): void {
    this.clearActiveMoleTimeout();
    const timeoutMs = Math.min(MOLE_VISIBLE_MS, Math.max(1200, this.state.timeRemaining * 1000));
    this.activeMoleTimeout = setTimeout(() => {
      if (!this.state.activeMole || this.evaluating) return;
      this.handleAutoMiss(this.state.activeMole);
    }, timeoutMs);
  }

  private clearActiveMoleTimeout(): void {
    if (this.activeMoleTimeout) clearTimeout(this.activeMoleTimeout);
    this.activeMoleTimeout = null;
  }

  private clearRetryTimeout(): void {
    if (this.retryHandle) clearTimeout(this.retryHandle);
    this.retryHandle = null;
  }

  private clearHardWordTimeout(): void {
    if (this.hardWordTimeoutHandle) clearTimeout(this.hardWordTimeoutHandle);
    this.hardWordTimeoutHandle = null;
  }

  private armHardWordTimeout(word: Word, wordLife: number): void {
    this.clearHardWordTimeout();
    this.hardWordTimeoutHandle = setTimeout(() => {
      this.hardWordTimeoutHandle = null;
      if (this.state.screen !== 'game') return;
      if (wordLife !== this.wordLifeCounter) return;
      const activeMole = this.state.activeMole;
      if (!activeMole || activeMole.word.id !== word.id) return;
      if (activeMole.animState === 'hit' || activeMole.animState === 'escaping') return;
      this.clearActiveMoleTimeout();
      this.handleAutoMiss(activeMole);
    }, WORD_HARD_TIMEOUT_MS);
  }

  private cancelActiveEvaluation(): void {
    if (!this.evaluating) return;
    this.evaluating = false;
    if (this.state.isEvaluating) {
      this.setState({ isEvaluating: false });
    }
  }

  private hasEnoughTimeForNewMole(): boolean {
    return this.state.timeRemaining >= MIN_SECONDS_TO_SPAWN_MOLE;
  }

  private finishRound(): void {
    if (this.evaluating) {
      this.endAfterEvaluation = true;
      if (this.countdownHandle) clearInterval(this.countdownHandle);
      this.countdownHandle = null;
      this.clearActiveMoleTimeout();
      return;
    }

    const activeMole = this.state.activeMole;
    if (
      activeMole &&
      activeMole.animState !== 'hit' &&
      activeMole.animState !== 'escaping'
    ) {
      this.setState({
        combo: 0,
        wordsMissed: [...this.state.wordsMissed, activeMole.word],
      });
    }
    this.endGame();
  }

  private handleFinalResult(result: EvalResult): void {
    this.endAfterEvaluation = false;
    if (this.state.screen !== 'game') return;

    const activeMole = this.state.activeMole;
    const word = activeMole?.word;
    const nextState: Partial<GameState> = {
      lastHint: this.buildEvalHint(result),
      isEvaluating: false,
    };

    if (word && !result.error) {
      if (result.success) {
        const newCombo = this.state.combo + 1;
        nextState.score = this.state.score + scoreForResult(word, newCombo);
        nextState.combo = newCombo;
        nextState.wordsHit = [...this.state.wordsHit, word];
      } else {
        nextState.combo = 0;
        nextState.wordsMissed = [...this.state.wordsMissed, word];
      }
    }

    this.setState(nextState);
    this.endGame();
  }

  private endGame(): void {
    if (this.state.screen !== 'game') return;
    this.stop();
    this.setState({ screen: 'result', activeMole: null, isEvaluating: false, timeRemaining: 0 });
    this.emit({ type: 'gameOver', finalState: this.state });
  }
}
