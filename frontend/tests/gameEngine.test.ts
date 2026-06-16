import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { GameEngine } from '../src/engine/gameEngine.js';
import type { EvalResult, GameState, MoleAnimState } from '../src/types/game.js';
import type { PronunciationEvaluator } from '../src/types/evaluator.js';
import type { Word } from '../src/types/word.js';
import type { EvaluationAudio } from '../src/types/audio.js';

function buildWord(index: number, hanzi = '学习词'): Word {
  return {
    id: `w-${index}`,
    hanzi,
    pinyin: `zi${index}`,
    pinyinRaw: 'zi4',
    tone: 4,
    difficulty: 'easy',
    creatureName: `Word ${index}`,
    scoreValue: 10,
  };
}

function buildWords(count: number, hanzi = '学习词'): Word[] {
  return Array.from({ length: count }, (_, index) => buildWord(index + 1, hanzi));
}

function buildWordsFromHanzi(hanziList: string[]): Word[] {
  return hanziList.map((hanzi, index) => buildWord(index + 1, hanzi));
}

const evaluator: PronunciationEvaluator = {
  evaluate: async (_audio: EvaluationAudio, word: Word): Promise<EvalResult> => ({
    success: false,
    confidence: 0,
    wordId: word.id,
    error: true,
  }),
};

function buildEvaluationAudio(): EvaluationAudio {
  return {
    blob: new Blob(['test'], { type: 'audio/webm' }),
    format: 'webm_opus',
    sampleRate: null,
    channels: null,
    mimeType: 'audio/webm',
    filename: 'recording.webm',
    stats: {
      durationMs: 500,
      peakVolume: 0.8,
      averageVolume: 0.4,
      peakRms: 0.1,
      averageRms: 0.05,
      chunks: 1,
    },
  };
}

interface EngineHarness {
  engine: GameEngine;
  latestState: () => GameState;
  gameOverCount: () => number;
}

function createHarness(wordsOrCount: number | Word[]): EngineHarness {
  const words = Array.isArray(wordsOrCount) ? wordsOrCount : buildWords(wordsOrCount);
  const engine = new GameEngine(
    words,
    evaluator,
    { canvasWidth: 800, canvasHeight: 600 },
    { preserveWordOrder: true },
  );
  let latest: GameState | null = null;
  let gameOverEvents = 0;

  engine.subscribe(event => {
    if (event.type === 'stateChanged') {
      latest = event.state as GameState;
      return;
    }
    latest = event.finalState as GameState;
    gameOverEvents += 1;
  });

  return {
    engine,
    latestState: () => {
      assert.ok(latest, 'expected at least one emitted state');
      return latest;
    },
    gameOverCount: () => gameOverEvents,
  };
}

function setActiveAnimState(engine: GameEngine, animState: MoleAnimState) {
  const current = (engine as any).state as GameState;
  assert.ok(current.activeMole, 'expected an active mole');
  (engine as any).state = {
    ...current,
    activeMole: { ...current.activeMole, animState },
  };
}

function runCountdown(engine: GameEngine) {
  (engine as any).countdown();
}

function withMockTimers(t: TestContext) {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] });
}

test('8 3-hanzi words initialize with 80 seconds', () => {
  const { engine, latestState } = createHarness(8);
  engine.start();

  const state = latestState();
  assert.equal(state.timeRemaining, 80);

  engine.stop();
});

test('countdown ignores non-actionable mole states', () => {
  const { engine, latestState } = createHarness(8);
  engine.start();

  const start = latestState().timeRemaining;
  setActiveAnimState(engine, 'emerging');
  runCountdown(engine);
  setActiveAnimState(engine, 'hit');
  runCountdown(engine);
  setActiveAnimState(engine, 'escaping');
  runCountdown(engine);

  assert.equal(latestState().timeRemaining, start);
  engine.stop();
});

test('initial timer budget matches per-word Hanzi timeout rules', () => {
  const { engine, latestState } = createHarness(buildWordsFromHanzi(['天', '朋友', '好朋友']));
  engine.start();

  const state = latestState();
  assert.equal(state.timeRemaining, 25); // 7 + 8 + 10
  engine.stop();
});

test('countdown decrements during actionable mole states', () => {
  const { engine, latestState } = createHarness(8);
  engine.start();

  const start = latestState().timeRemaining;
  setActiveAnimState(engine, 'active');
  runCountdown(engine);
  setActiveAnimState(engine, 'retry');
  runCountdown(engine);
  setActiveAnimState(engine, 'listening');
  runCountdown(engine);

  assert.equal(latestState().timeRemaining, start - 3);
  engine.stop();
});

test('pause toggles and freezes countdown', () => {
  const { engine, latestState } = createHarness(8);
  engine.start();

  setActiveAnimState(engine, 'active');
  const start = latestState().timeRemaining;
  engine.togglePause();
  assert.equal(latestState().isPaused, true);

  runCountdown(engine);
  assert.equal(latestState().timeRemaining, start);

  engine.togglePause();
  assert.equal(latestState().isPaused, false);
  runCountdown(engine);
  assert.equal(latestState().timeRemaining, start - 1);
  engine.stop();
});

test('timer at zero does not end round while queued words remain', () => {
  const { engine, latestState, gameOverCount } = createHarness(2);
  engine.start();

  setActiveAnimState(engine, 'active');
  const current = (engine as any).state as GameState;
  (engine as any).state = { ...current, timeRemaining: 1 };

  runCountdown(engine);
  assert.equal(latestState().timeRemaining, 0);
  assert.equal(latestState().screen, 'game');
  assert.equal(gameOverCount(), 0);

  runCountdown(engine);
  assert.equal(latestState().timeRemaining, 0);
  assert.equal(latestState().screen, 'game');
  assert.equal(gameOverCount(), 0);

  engine.stop();
});

test('round ends only after all words resolve', t => {
  withMockTimers(t);
  const { engine, latestState, gameOverCount } = createHarness(2);
  engine.start();

  const steps = [260, 10_000, 1_180, 120, 260, 10_000, 1_180, 120];
  for (const step of steps) {
    t.mock.timers.tick(step);
  }

  assert.equal(gameOverCount(), 1);
  const state = latestState();
  assert.equal(state.screen, 'result');
  assert.equal(state.wordsMissed.length, 2);
  assert.equal(state.wordsHit.length, 0);
});

test('pause freezes emerge transition and resumes it', t => {
  withMockTimers(t);
  const { engine, latestState } = createHarness(1);
  engine.start();

  assert.equal(latestState().activeMole?.animState, 'emerging');
  engine.togglePause();

  t.mock.timers.tick(3_000);
  assert.equal(latestState().activeMole?.animState, 'emerging');

  engine.togglePause();
  t.mock.timers.tick(260);
  assert.equal(latestState().activeMole?.animState, 'active');
  engine.stop();
});

test('pause freezes active timeout and resumes from remaining duration', t => {
  withMockTimers(t);
  const { engine, latestState } = createHarness(buildWordsFromHanzi(['好朋友']));
  engine.start();

  t.mock.timers.tick(260);
  assert.equal(latestState().activeMole?.animState, 'active');

  t.mock.timers.tick(3_000);
  engine.togglePause();

  t.mock.timers.tick(20_000);
  assert.equal(latestState().activeMole?.animState, 'active');
  assert.equal(latestState().wordsMissed.length, 0);

  engine.togglePause();
  t.mock.timers.tick(6_999);
  assert.equal(latestState().activeMole?.animState, 'active');
  t.mock.timers.tick(1);
  assert.equal(latestState().activeMole?.animState, 'escaping');
  assert.equal(latestState().wordsMissed.length, 1);
  engine.stop();
});

test('in-flight evaluation result is deferred while paused and applied on resume', async t => {
  withMockTimers(t);
  let resolveEval: ((result: EvalResult) => void) | null = null;
  const evaluatorWithResolve: PronunciationEvaluator = {
    evaluate: async (): Promise<EvalResult> => (
      new Promise<EvalResult>(resolve => {
        resolveEval = resolve;
      })
    ),
  };
  const words = buildWordsFromHanzi(['好朋友']);
  const engine = new GameEngine(words, evaluatorWithResolve, { canvasWidth: 800, canvasHeight: 600 }, { preserveWordOrder: true });
  let latest: GameState | null = null;
  engine.subscribe(event => {
    latest = (event.type === 'stateChanged' ? event.state : event.finalState) as GameState;
  });
  const readLatest = () => latest as GameState | null;

  engine.start();
  t.mock.timers.tick(260);
  const startedState = readLatest();
  assert.ok(startedState, 'expected latest state after start');
  assert.equal(startedState.activeMole?.animState, 'active');

  const activeWord = startedState.activeMole?.word;
  assert.ok(activeWord, 'expected active word');
  const submitPromise = engine.submitEvaluation(buildEvaluationAudio());
  const submittedState = readLatest();
  assert.ok(submittedState, 'expected state after submit');
  assert.equal(submittedState.activeMole?.animState, 'listening');
  assert.equal(submittedState.isEvaluating, true);

  engine.togglePause();
  const pausedState = readLatest();
  assert.ok(pausedState, 'expected state after pause');
  assert.equal(pausedState.isPaused, true);
  const resolve = resolveEval as ((result: EvalResult) => void) | null;
  assert.ok(resolve, 'expected evaluator resolver');
  resolve({
    success: true,
    confidence: 0.95,
    wordId: activeWord.id,
    hintCode: 'heard_correct',
    hintText: 'Great',
  });
  await submitPromise;

  const deferredState = readLatest();
  assert.ok(deferredState, 'expected paused state after evaluation completion');
  assert.equal(deferredState.isPaused, true);
  assert.equal(deferredState.activeMole?.animState, 'listening');
  assert.equal(deferredState.isEvaluating, true);

  engine.togglePause();
  const resumedState = readLatest();
  assert.ok(resumedState, 'expected resumed state');
  assert.equal(resumedState.isPaused, false);
  assert.equal(resumedState.activeMole?.animState, 'hit');
  assert.equal(resumedState.isEvaluating, false);
  engine.stop();
});

test('1-hanzi word timeout is 7 seconds', t => {
  withMockTimers(t);
  const { engine, latestState } = createHarness(buildWordsFromHanzi(['天']));
  engine.start();

  t.mock.timers.tick(260);
  setActiveAnimState(engine, 'active');

  const current = (engine as any).state as GameState;
  (engine as any).state = { ...current, timeRemaining: 1 };
  (engine as any).armActiveMoleTimeout();

  t.mock.timers.tick(6_999);
  assert.equal(latestState().activeMole?.animState, 'active');
  assert.equal(latestState().wordsMissed.length, 0);

  t.mock.timers.tick(1);
  assert.equal(latestState().activeMole?.animState, 'escaping');
  assert.equal(latestState().wordsMissed.length, 1);
  engine.stop();
});

test('2-hanzi word timeout is 8 seconds', t => {
  withMockTimers(t);
  const { engine, latestState } = createHarness(buildWordsFromHanzi(['朋友']));
  engine.start();

  t.mock.timers.tick(260);
  setActiveAnimState(engine, 'active');

  const current = (engine as any).state as GameState;
  (engine as any).state = { ...current, timeRemaining: 1 };
  (engine as any).armActiveMoleTimeout();

  t.mock.timers.tick(7_999);
  assert.equal(latestState().activeMole?.animState, 'active');
  assert.equal(latestState().wordsMissed.length, 0);

  t.mock.timers.tick(1);
  assert.equal(latestState().activeMole?.animState, 'escaping');
  assert.equal(latestState().wordsMissed.length, 1);
  engine.stop();
});

test('3-plus-hanzi word timeout remains 10 seconds even at low remaining time', t => {
  withMockTimers(t);
  const { engine, latestState } = createHarness(buildWordsFromHanzi(['好朋友']));
  engine.start();

  t.mock.timers.tick(260);
  setActiveAnimState(engine, 'active');

  const current = (engine as any).state as GameState;
  (engine as any).state = { ...current, timeRemaining: 1 };
  (engine as any).armActiveMoleTimeout();

  t.mock.timers.tick(9_999);
  assert.equal(latestState().activeMole?.animState, 'active');
  assert.equal(latestState().wordsMissed.length, 0);

  t.mock.timers.tick(1);
  assert.equal(latestState().activeMole?.animState, 'escaping');
  assert.equal(latestState().wordsMissed.length, 1);
  engine.stop();
});
