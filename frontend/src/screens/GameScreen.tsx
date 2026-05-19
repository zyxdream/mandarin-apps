import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { GameState } from '../types/game';
import { useGameEngine } from '../hooks/useGameEngine';
import { useGameAudio } from '../hooks/useGameAudio';
import { useMicrophone } from '../hooks/useMicrophone';
import { MoleCanvas } from '../components/MoleCanvas';
import { HUD } from '../components/HUD';
import { RewardComboPopup } from '../components/RewardComboPopup';
import type { RewardComboPopupVariant } from '../components/RewardComboPopup';
import { VoiceMeter } from '../components/MicButton';
import {
  blendNoiseFloor,
  computeSpeechThresholds,
  HIGH_SENSITIVITY_SPEECH_CONFIG,
  shouldSkipCaptureQuality,
  shouldSkipWeakUtterance,
} from '../engine/speechDetection';
import { DevEvalCenterPanel, PedagogyHint } from '../components/PronunciationHint';
import type { UiDockLayout } from '../engine/uiDockLayout';
import { foodUnitsForCorrectWords, getRewardFoodOption, type RewardFood } from '../data/rewards';
import type { ScriptSession } from '../data/scriptSessions';
import { pingHealthWarmup, warmupDeepIfStaleOrFailed } from '../warmup/backendWarmup';
import type { ActiveMoleOverlayLayout, ResolveIncorrectHintPlacementResult } from '../engine/overlayPlacement';
import {
  estimateBaoziOverlaySizes,
  resolveBaoziLinkedHintTop,
  resolveLegacyBaoziAnchorWithBoardGuard,
  resolveBaoziRewardX,
  resolveIncorrectHintPlacement,
} from '../engine/overlayPlacement';
import {
  buildPedagogyHintClassName,
  resolveHintPlacementMode,
} from '../engine/hintPlacementMode';

const WARMUP_PING_INTERVAL_MS = 3 * 60 * 1000;
const COMBO_POPUP_MARGIN_PX = 92;
const COMBO_POPUP_MIN_Y_PX = 72;
const COMBO_POPUP_VERTICAL_LIFT_PX = 152;
const BAOZI_COMBO_EXTRA_LIFT_PX = 32;
const COMBO_POPUP_UPPER_HALF_RATIO = 0.46;
const BAOZI_HINT_TIGHT_GAP_PX = 10;
const BAOZI_HINT_MIN_TOP_PX = 72;
const BAOZI_HINT_BOTTOM_MARGIN_PX = 16;
const BAOZI_RIGHT_SHIFT_PX = 24;
const BAOZI_LEFT_OF_MOLE_GAP_PX = 14;
const INCORRECT_HINT_MIN_WIDTH_PX = 132;
const INCORRECT_HINT_HEIGHT_PX = 84;
const INCORRECT_HINT_SAFE_MARGIN_PX = 14;
const INCORRECT_HINT_SIDE_GAP_PX = 24;
const RIGHTMOST_MOLE_SLOT_INDEX = 5;
const RIGHTMOST_HINT_MIN_WIDTH_PX = 240;
const RIGHTMOST_HINT_MAX_WIDTH_PX = 360;
const RIGHTMOST_HINT_TOP_GAP_PX = 12;
const STACK_REWARD_SOURCE_WIDTH_PX = 1536;
const STACK_REWARD_FOODS: RewardFood[] = ['apple', 'berry', 'tree_nut', 'strawberry', 'baozi', 'mooncake'];
const STACK_REWARD_FOOD_SET = new Set<RewardFood>(STACK_REWARD_FOODS);
const STACK_REWARD_X_OFFSET_RATIO_BY_FOOD: Partial<Record<RewardFood, number>> = {
  apple: 89 / STACK_REWARD_SOURCE_WIDTH_PX,
  berry: 89 / STACK_REWARD_SOURCE_WIDTH_PX,
  tree_nut: 123 / STACK_REWARD_SOURCE_WIDTH_PX,
  strawberry: 125 / STACK_REWARD_SOURCE_WIDTH_PX,
  mooncake: 124.5 / STACK_REWARD_SOURCE_WIDTH_PX,
};

interface RewardComboPopupState {
  triggerId: number;
  x: number;
  y: number;
  foodLabel: string;
  foodImage: string;
  amount: number;
  variant: RewardComboPopupVariant;
  showFoodLabel: boolean;
  linkedHintX?: number;
  linkedHintTop?: number;
}

interface BaoziUnitPlacement {
  rewardAnchorX: number;
  rewardAnchorY: number;
  hintAnchorX: number;
  hintTop: number;
}

interface LockedIncorrectHintPlacement {
  key: string;
  placement: ResolveIncorrectHintPlacementResult;
}

function clampToRange(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  if (max < min) return (min + max) / 2;
  return Math.min(max, Math.max(min, value));
}

function isStackRewardFood(food: RewardFood): boolean {
  return STACK_REWARD_FOOD_SET.has(food);
}

function estimatePedagogyHintSize(viewportWidth: number): { width: number; height: number } {
  return {
    width: clampToRange(
      viewportWidth * 0.42,
      220,
      Math.max(220, viewportWidth - 32),
    ),
    height: INCORRECT_HINT_HEIGHT_PX,
  };
}

function buildIncorrectHintLockKey(
  hint: GameState['lastHint'] | null,
  activeWordId: string | null,
  activeSlotIndex: number | null,
): string | null {
  if (!hint || hint.code === 'heard_correct') return null;
  const confidence = Number.isFinite(hint.confidence) ? Math.round(hint.confidence * 1000) : -1;
  return [
    activeWordId ?? 'none',
    String(activeSlotIndex ?? -1),
    hint.code,
    hint.text,
    hint.transcriptPinyin ?? '',
    confidence,
  ].join('|');
}

function resolveRightmostIncorrectHintPlacement({
  viewportWidth,
  viewportHeight,
  moleX,
  moleBottomY,
}: {
  viewportWidth: number;
  viewportHeight: number;
  moleX: number;
  moleBottomY: number;
}): ResolveIncorrectHintPlacementResult {
  const safeMargin = INCORRECT_HINT_SAFE_MARGIN_PX;
  const preferredWidth = clampToRange(viewportWidth * 0.34, RIGHTMOST_HINT_MIN_WIDTH_PX, RIGHTMOST_HINT_MAX_WIDTH_PX);
  const maxWidth = Math.max(0, viewportWidth - safeMargin * 2);
  const width = clampToRange(preferredWidth, Math.min(RIGHTMOST_HINT_MIN_WIDTH_PX, maxWidth), maxWidth);
  const targetLeft = moleX - width * 0.42;
  const left = clampToRange(targetLeft, safeMargin, Math.max(safeMargin, viewportWidth - safeMargin - width));
  const top = clampToRange(
    moleBottomY + RIGHTMOST_HINT_TOP_GAP_PX,
    safeMargin,
    Math.max(safeMargin, viewportHeight - safeMargin - INCORRECT_HINT_HEIGHT_PX),
  );

  return {
    strategy: 'fallback',
    hintLeft: Math.round(left),
    hintTop: Math.round(top),
    hintWidth: Math.round(width),
  };
}

function estimateFallbackBoardKeepout({
  viewportWidth,
  viewportHeight,
  moleX,
  moleY,
}: {
  viewportWidth: number;
  viewportHeight: number;
  moleX: number;
  moleY: number;
}) {
  const width = clampToRange(viewportWidth * 0.2, 200, 340);
  const height = clampToRange(viewportHeight * 0.16, 88, 148);
  const centerX = moleX + clampToRange(viewportWidth * 0.02, 24, 56);
  const centerY = moleY - clampToRange(viewportHeight * 0.12, 84, 144);
  const left = centerX - width / 2;
  const top = centerY - height / 2;
  return {
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height,
    centerX,
    centerY,
  };
}

function estimateFallbackMoleBodyRect({
  viewportWidth,
  viewportHeight,
  moleX,
  moleY,
}: {
  viewportWidth: number;
  viewportHeight: number;
  moleX: number;
  moleY: number;
}) {
  const width = clampToRange(viewportWidth * 0.11, 112, 220);
  const height = clampToRange(viewportHeight * 0.2, 126, 248);
  const left = moleX - width / 2;
  const top = moleY - height * 0.88;
  return {
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height,
    centerX: moleX,
    centerY: top + height / 2,
  };
}

function resolveBaoziUnitPlacement({
  viewportWidth,
  viewportHeight,
  hitX,
  hitY,
  moleX,
  moleY,
  activeWordId,
  stackFood,
  overlayLayout,
}: {
  viewportWidth: number;
  viewportHeight: number;
  hitX: number;
  hitY: number;
  moleX: number;
  moleY: number;
  activeWordId: string | null;
  stackFood: RewardFood;
  overlayLayout: ActiveMoleOverlayLayout | null;
}): BaoziUnitPlacement {
  const marginX = Math.min(COMBO_POPUP_MARGIN_PX, Math.max(28, viewportWidth * 0.18));
  const maxX = Math.max(marginX, viewportWidth - marginX);
  const maxRewardY = Math.max(COMBO_POPUP_MIN_Y_PX, viewportHeight * COMBO_POPUP_UPPER_HALF_RATIO);
  const { rewardSize, hintSize } = estimateBaoziOverlaySizes(viewportWidth);

  let rewardAnchorX = resolveBaoziRewardX({
    hitX,
    moleX,
    minX: marginX,
    maxX,
    rightShiftPx: BAOZI_RIGHT_SHIFT_PX,
    leftOfMoleGapPx: BAOZI_LEFT_OF_MOLE_GAP_PX,
  });
  const popupLiftPx = COMBO_POPUP_VERTICAL_LIFT_PX + BAOZI_COMBO_EXTRA_LIFT_PX;
  let rewardAnchorY = clampToRange(hitY - popupLiftPx, COMBO_POPUP_MIN_Y_PX, maxRewardY);
  const hasMatchingOverlay = Boolean(
    overlayLayout &&
    activeWordId &&
    overlayLayout.wordId === activeWordId,
  );

  if (hasMatchingOverlay && overlayLayout) {
    const leftOfMoleMaxX = clampToRange(
      moleX - BAOZI_LEFT_OF_MOLE_GAP_PX,
      marginX,
      maxX,
    );
    const resolvedAnchor = resolveLegacyBaoziAnchorWithBoardGuard({
      baseAnchor: { x: rewardAnchorX, y: rewardAnchorY },
      rewardSize,
      boardKeepoutRect: overlayLayout.boardKeepoutRect,
      anchorBounds: {
        minX: marginX,
        maxX: leftOfMoleMaxX,
        minY: COMBO_POPUP_MIN_Y_PX,
        maxY: maxRewardY,
      },
    });
    rewardAnchorX = resolvedAnchor.x;
    rewardAnchorY = resolvedAnchor.y;
  }

  const stackXOffsetRatio = STACK_REWARD_X_OFFSET_RATIO_BY_FOOD[stackFood] ?? 0;
  if (stackXOffsetRatio > 0) {
    const leftShiftPx = rewardSize.width * stackXOffsetRatio;
    rewardAnchorX = clampToRange(rewardAnchorX - leftShiftPx, marginX, maxX);

    if (hasMatchingOverlay && overlayLayout) {
      const leftOfMoleMaxX = clampToRange(
        moleX - BAOZI_LEFT_OF_MOLE_GAP_PX,
        marginX,
        maxX,
      );
      const resolvedAnchor = resolveLegacyBaoziAnchorWithBoardGuard({
        baseAnchor: { x: rewardAnchorX, y: rewardAnchorY },
        rewardSize,
        boardKeepoutRect: overlayLayout.boardKeepoutRect,
        anchorBounds: {
          minX: marginX,
          maxX: leftOfMoleMaxX,
          minY: COMBO_POPUP_MIN_Y_PX,
          maxY: maxRewardY,
        },
      });
      rewardAnchorX = resolvedAnchor.x;
      rewardAnchorY = resolvedAnchor.y;
    }
  }

  const maxHintTop = Math.max(
    BAOZI_HINT_MIN_TOP_PX,
    viewportHeight - hintSize.height - BAOZI_HINT_BOTTOM_MARGIN_PX,
  );
  const hintTop = resolveBaoziLinkedHintTop({
    rewardAnchorY,
    rewardHeight: rewardSize.height,
    hintHeight: hintSize.height,
    tightGapPx: BAOZI_HINT_TIGHT_GAP_PX,
    minTop: BAOZI_HINT_MIN_TOP_PX,
    maxTop: maxHintTop,
    moleY,
  });

  return {
    rewardAnchorX,
    rewardAnchorY,
    hintAnchorX: rewardAnchorX,
    hintTop,
  };
}

interface GameScreenProps {
  selectedFood: RewardFood;
  onSelectFood: (food: RewardFood) => void;
  scriptSession: ScriptSession;
  onGameOver: (finalState: GameState) => void;
  onBackToSessionSelect: () => void;
}

export function GameScreen({
  selectedFood,
  onSelectFood,
  scriptSession,
  onGameOver,
  onBackToSessionSelect,
}: GameScreenProps) {
  const {
    gameState,
    activeMoleRef,
    sessionPracticeUnits,
    startGame,
    setCanvasSize,
    submitEvaluation,
    togglePause,
  } = useGameEngine(scriptSession);
  const { micState, volume, startListening, captureRecentAudio, resetCaptureBuffer } = useMicrophone();
  const calledGameOverRef = useRef(false);
  const startedRoundRef = useRef(false);
  const lastStrikeRef = useRef(0);
  const isSpeakingRef = useRef(false);
  const lastVoiceAtRef = useRef(0);
  const speechStartedAtRef = useRef(0);
  const speechPeakVolumeRef = useRef(0);
  const voiceCandidateStartedAtRef = useRef(0);
  const noiseFloorRef = useRef(0.018);
  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const [resizeTarget, setResizeTarget] = useState<HTMLDivElement | null>(null);
  const dockRef = useRef<HTMLDivElement | null>(null);
  const [dockLayout, setDockLayout] = useState<UiDockLayout>({ dockHeightPx: 0, safeBottomPx: 0 });
  const [hasRoundStarted, setHasRoundStarted] = useState(false);
  const [comboPopupState, setComboPopupState] = useState<RewardComboPopupState | null>(null);
  const comboPopupTriggerRef = useRef(0);
  const previousHitCountRef = useRef(0);
  const previousFoodUnitsRef = useRef(0);
  const activeOverlayLayoutRef = useRef<ActiveMoleOverlayLayout | null>(null);
  const lockedIncorrectHintPlacementRef = useRef<LockedIncorrectHintPlacement | null>(null);
  const activeWordId = gameState?.activeMole?.word.id ?? null;
  const handleCanvasHostRef = useCallback((node: HTMLDivElement | null) => {
    canvasHostRef.current = node;
    setResizeTarget(node);
  }, []);
  const handleOverlayLayout = useCallback((layout: ActiveMoleOverlayLayout | null) => {
    activeOverlayLayoutRef.current = layout;
  }, []);

  useEffect(() => {
    if (micState !== 'listening' || startedRoundRef.current) return;
    startedRoundRef.current = true;
    setHasRoundStarted(true);
    startGame();
  }, [micState, startGame]);

  useEffect(() => {
    if (gameState?.screen === 'result' && !calledGameOverRef.current) {
      calledGameOverRef.current = true;
      onGameOver(gameState);
    }
  }, [gameState, onGameOver]);

  useEffect(() => {
    const host = canvasHostRef.current;
    if (!host) return;

    const resizeToHost = () => {
      const rect = host.getBoundingClientRect();
      setCanvasSize(rect.width, rect.height);
    };

    resizeToHost();

    const observer = new ResizeObserver(entries => {
      const entry = entries[0];
      if (!entry) return;
      setCanvasSize(entry.contentRect.width, entry.contentRect.height);
    });
    observer.observe(host);

    return () => observer.disconnect();
  }, [setCanvasSize]);

  useEffect(() => {
    const dock = dockRef.current;
    if (!dock) return;

    const updateDockLayout = () => {
      const height = Math.max(0, Math.round(dock.getBoundingClientRect().height));
      setDockLayout(prev => {
        if (prev.dockHeightPx === height) return prev;
        return { dockHeightPx: height, safeBottomPx: 0 };
      });
    };

    updateDockLayout();
    const observer = new ResizeObserver(() => updateDockLayout());
    observer.observe(dock);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!activeWordId) return;
    isSpeakingRef.current = false;
    voiceCandidateStartedAtRef.current = 0;
    speechPeakVolumeRef.current = 0;
    resetCaptureBuffer();
  }, [activeWordId, resetCaptureBuffer]);

  useEffect(() => {
    if (!gameState) return;

    const hitCount = gameState.wordsHit.length;
    const foodUnits = foodUnitsForCorrectWords(hitCount);

    if (gameState.screen !== 'game') {
      previousHitCountRef.current = hitCount;
      previousFoodUnitsRef.current = foodUnits;
      return;
    }

    if (hitCount > previousHitCountRef.current) {
      const amount = Math.max(1, foodUnits - previousFoodUnitsRef.current);
      const food = getRewardFoodOption(selectedFood);
      const viewportWidth = Math.max(1, window.innerWidth);
      const viewportHeight = Math.max(1, window.innerHeight);
      const marginX = Math.min(COMBO_POPUP_MARGIN_PX, Math.max(28, viewportWidth * 0.18));
      const maxX = Math.max(marginX, viewportWidth - marginX);
      const maxY = Math.max(COMBO_POPUP_MIN_Y_PX, viewportHeight * COMBO_POPUP_UPPER_HALF_RATIO);
      const activeMole = gameState.activeMole;
      const hitX = activeMole?.x ?? viewportWidth * 0.5;
      const hitY = activeMole?.y ?? viewportHeight * 0.62;
      const usesStackStylePopup = isStackRewardFood(selectedFood);
      let anchorX = clampToRange(hitX, marginX, maxX);
      let anchorY = clampToRange(hitY - COMBO_POPUP_VERTICAL_LIFT_PX, COMBO_POPUP_MIN_Y_PX, maxY);
      let linkedHintX: number | undefined;
      let linkedHintTop: number | undefined;

      if (usesStackStylePopup) {
        const placement = resolveBaoziUnitPlacement({
          viewportWidth,
          viewportHeight,
          hitX,
          hitY,
          moleX: activeMole?.x ?? hitX,
          moleY: activeMole?.y ?? hitY,
          activeWordId: activeMole?.word.id ?? null,
          stackFood: selectedFood,
          overlayLayout: activeOverlayLayoutRef.current,
        });
        anchorX = placement.rewardAnchorX;
        anchorY = placement.rewardAnchorY;
        linkedHintX = Math.round(placement.hintAnchorX);
        linkedHintTop = Math.round(placement.hintTop);
      }

      comboPopupTriggerRef.current += 1;
      const variant: RewardComboPopupVariant = usesStackStylePopup ? 'baozi_focus' : 'default';
      const stackStyleFoodImage = food.stackPopupImage;

      setComboPopupState({
        triggerId: comboPopupTriggerRef.current,
        x: anchorX,
        y: anchorY,
        foodLabel: food.label.toLowerCase(),
        foodImage: usesStackStylePopup
          ? stackStyleFoodImage
          : food.baseImage,
        amount,
        variant,
        showFoodLabel: !usesStackStylePopup,
        linkedHintX,
        linkedHintTop,
      });
    } else if (hitCount < previousHitCountRef.current) {
      setComboPopupState(null);
    }

    previousHitCountRef.current = hitCount;
    previousFoodUnitsRef.current = foodUnits;
  }, [gameState, selectedFood]);

  const combo = gameState?.combo ?? 0;
  const timeRemaining = gameState?.timeRemaining ?? 45;
  const collectedWords = gameState?.wordsHit ?? [];
  const isBaoziSelected = selectedFood === 'baozi';
  const currentPedagogyHint = (
    !gameState?.isEvaluating &&
    gameState?.activeMole &&
    gameState?.lastHint
  )
    ? gameState.lastHint
    : null;
  const isCorrectPedagogyHint = currentPedagogyHint?.code === 'heard_correct';
  const isIncorrectPedagogyHint = Boolean(currentPedagogyHint && !isCorrectPedagogyHint);
  const activeOverlayLayout = activeOverlayLayoutRef.current;
  const hasMatchingOverlayLayout = Boolean(
    activeOverlayLayout &&
    activeWordId &&
    activeOverlayLayout.wordId === activeWordId,
  );
  const activeSlotIndex = activeOverlayLayout?.moleRef.slotIndex ?? gameState?.activeMole?.slotIndex ?? null;
  const isLinkedBaoziHint = (
    comboPopupState?.variant === 'baozi_focus' &&
    Number.isFinite(comboPopupState.linkedHintX) &&
    Number.isFinite(comboPopupState.linkedHintTop)
  );
  const shouldUseBaoziLinkedHint = isStackRewardFood(selectedFood) && isCorrectPedagogyHint;
  const fallbackBaoziHintPlacement = (
    shouldUseBaoziLinkedHint &&
    gameState?.activeMole
  )
    ? resolveBaoziUnitPlacement({
        viewportWidth: Math.max(1, window.innerWidth),
        viewportHeight: Math.max(1, window.innerHeight),
        hitX: gameState.activeMole.x,
        hitY: gameState.activeMole.y,
        moleX: gameState.activeMole.x,
        moleY: gameState.activeMole.y,
        activeWordId: gameState.activeMole.word.id,
        stackFood: selectedFood,
        overlayLayout: activeOverlayLayout,
      })
    : null;
  const hasBaoziLinkedHintPlacement = shouldUseBaoziLinkedHint && (isLinkedBaoziHint || Boolean(fallbackBaoziHintPlacement));
  const hintViewportWidth = Math.max(1, window.innerWidth);
  const hintViewportHeight = Math.max(1, window.innerHeight);
  const estimatedHintSize = estimatePedagogyHintSize(hintViewportWidth);
  const incorrectHintPlacement = (
    isIncorrectPedagogyHint &&
    hasMatchingOverlayLayout &&
    activeOverlayLayout
  )
    ? resolveIncorrectHintPlacement({
        viewportWidth: hintViewportWidth,
        viewportHeight: hintViewportHeight,
        boardKeepoutRect: activeOverlayLayout.boardKeepoutRect,
        moleBodyRect: activeOverlayLayout.moleBodyRect,
        hintSize: estimatedHintSize,
        safeMarginPx: INCORRECT_HINT_SAFE_MARGIN_PX,
        sideGapPx: INCORRECT_HINT_SIDE_GAP_PX,
        minHintWidthPx: INCORRECT_HINT_MIN_WIDTH_PX,
      })
    : null;
  const fallbackIncorrectHintPlacement = (
    isIncorrectPedagogyHint &&
    !incorrectHintPlacement &&
    gameState?.activeMole
  )
    ? resolveIncorrectHintPlacement({
        viewportWidth: hintViewportWidth,
        viewportHeight: hintViewportHeight,
        boardKeepoutRect: estimateFallbackBoardKeepout({
          viewportWidth: hintViewportWidth,
          viewportHeight: hintViewportHeight,
          moleX: gameState.activeMole.x,
          moleY: gameState.activeMole.y,
        }),
        moleBodyRect: estimateFallbackMoleBodyRect({
          viewportWidth: hintViewportWidth,
          viewportHeight: hintViewportHeight,
          moleX: gameState.activeMole.x,
          moleY: gameState.activeMole.y,
        }),
        hintSize: estimatedHintSize,
        safeMarginPx: INCORRECT_HINT_SAFE_MARGIN_PX,
        sideGapPx: INCORRECT_HINT_SIDE_GAP_PX,
        minHintWidthPx: INCORRECT_HINT_MIN_WIDTH_PX,
      })
    : null;
  const resolvedIncorrectHintPlacementBase = incorrectHintPlacement ?? fallbackIncorrectHintPlacement;
  const activeMoleForHintPlacement = gameState?.activeMole ?? null;
  const shouldUseRightmostIncorrectHintOverride = (
    isIncorrectPedagogyHint &&
    activeSlotIndex === RIGHTMOST_MOLE_SLOT_INDEX &&
    activeMoleForHintPlacement
  );
  const rightmostIncorrectHintPlacement = shouldUseRightmostIncorrectHintOverride
    ? resolveRightmostIncorrectHintPlacement({
        viewportWidth: hintViewportWidth,
        viewportHeight: hintViewportHeight,
        moleX: activeOverlayLayout?.moleRef.x ?? activeMoleForHintPlacement.x,
        moleBottomY: activeOverlayLayout?.moleBodyRect.bottom ?? activeMoleForHintPlacement.y,
      })
    : null;
  const resolvedIncorrectHintPlacement = rightmostIncorrectHintPlacement ?? resolvedIncorrectHintPlacementBase;
  const incorrectHintLockKey = buildIncorrectHintLockKey(currentPedagogyHint, activeWordId, activeSlotIndex);
  const currentIncorrectHintLock = lockedIncorrectHintPlacementRef.current;
  if (!incorrectHintLockKey) {
    if (currentIncorrectHintLock) {
      lockedIncorrectHintPlacementRef.current = null;
    }
  } else if (resolvedIncorrectHintPlacement) {
    if (!currentIncorrectHintLock || currentIncorrectHintLock.key !== incorrectHintLockKey) {
      lockedIncorrectHintPlacementRef.current = {
        key: incorrectHintLockKey,
        placement: resolvedIncorrectHintPlacement,
      };
    }
  }
  const stableIncorrectHintPlacement = (
    incorrectHintLockKey &&
    lockedIncorrectHintPlacementRef.current?.key === incorrectHintLockKey
  )
    ? lockedIncorrectHintPlacementRef.current.placement
    : resolvedIncorrectHintPlacement;
  const hasIncorrectHintPlacement = Boolean(stableIncorrectHintPlacement);
  const hintPlacementMode = resolveHintPlacementMode({
    hasIncorrectPlacement: hasIncorrectHintPlacement,
    hasBaoziLinkedPlacement: hasBaoziLinkedHintPlacement,
  });
  const rootStyle = {
    '--ui-dock-height': `${dockLayout.dockHeightPx}px`,
    '--ui-dock-safe-bottom': `${dockLayout.safeBottomPx}px`,
  } as CSSProperties;
  const pedagogyHintStyle = (() => {
    if (hintPlacementMode === 'incorrect_right_lane' && stableIncorrectHintPlacement) {
      return {
        '--hint-left': `${Math.round(stableIncorrectHintPlacement.hintLeft)}px`,
        '--hint-top': `${Math.round(stableIncorrectHintPlacement.hintTop)}px`,
        '--hint-width': `${Math.max(0, Math.round(stableIncorrectHintPlacement.hintWidth))}px`,
      } as CSSProperties;
    }

    if (hintPlacementMode === 'baozi_linked') {
      if (isLinkedBaoziHint) {
        return {
          '--hint-anchor-x': `${Math.round(comboPopupState?.linkedHintX ?? 0)}px`,
          '--hint-anchor-top': `${Math.round(comboPopupState?.linkedHintTop ?? 0)}px`,
        } as CSSProperties;
      }
      if (fallbackBaoziHintPlacement) {
        return {
          '--hint-anchor-x': `${Math.round(fallbackBaoziHintPlacement.hintAnchorX)}px`,
          '--hint-anchor-top': `${Math.round(fallbackBaoziHintPlacement.hintTop)}px`,
        } as CSSProperties;
      }
      return undefined;
    }

    if (gameState?.activeMole) {
      return {
        '--hint-anchor-x': `${Math.round(gameState.activeMole.x)}px`,
        '--hint-anchor-y': `${Math.round(gameState.activeMole.y)}px`,
      } as CSSProperties;
    }
    return undefined;
  })();
  const pedagogyHintClassName = buildPedagogyHintClassName(hintPlacementMode);
  const isMicStartScreen = !hasRoundStarted && micState !== 'listening';
  const showPauseButton = hasRoundStarted && micState === 'listening';
  const isGamePaused = Boolean(gameState?.isPaused);
  const pauseControlLabel = isGamePaused ? '▶' : '||';
  const pauseControlAriaLabel = isGamePaused ? 'Resume' : 'Pause';
  const handleTogglePause = useCallback(() => {
    togglePause();
  }, [togglePause]);
  const handleEnableMic = useCallback(async () => {
    void warmupDeepIfStaleOrFailed('ready_click');
    await startListening();
  }, [startListening]);

  useGameAudio(gameState, micState === 'listening' && gameState?.screen === 'game');

  useEffect(() => {
    const isWarmupActive =
      micState === 'listening' &&
      gameState?.screen === 'game' &&
      !isGamePaused;
    if (!isWarmupActive) return;
    void pingHealthWarmup('game_session_start');
    const timer = window.setInterval(() => {
      void pingHealthWarmup('game_keepalive');
    }, WARMUP_PING_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [gameState?.screen, isGamePaused, micState]);

  useEffect(() => {
    if (micState !== 'listening' || !gameState?.activeMole) return;
    if (isGamePaused) {
      isSpeakingRef.current = false;
      voiceCandidateStartedAtRef.current = 0;
      speechPeakVolumeRef.current = 0;
      resetCaptureBuffer();
      return;
    }

    const now = Date.now();
    const activeMole = gameState.activeMole;
    const thresholds = computeSpeechThresholds(noiseFloorRef.current);
    const {
      speechStartThreshold,
      speechEndThreshold,
      minSpeechPeakVolume,
      minSpeechAverageVolume,
      minSpeechRiseOverNoise,
      speechStartHoldMs,
      speechEndSilenceMs,
      strikeCooldownMs,
      minSpeechDurationMs,
    } = thresholds;

    if (!isSpeakingRef.current) {
      noiseFloorRef.current = blendNoiseFloor(
        noiseFloorRef.current,
        volume,
        HIGH_SENSITIVITY_SPEECH_CONFIG,
      );
    }

    if (isSpeakingRef.current) {
      speechPeakVolumeRef.current = Math.max(speechPeakVolumeRef.current, volume);
    }

    if (volume >= speechStartThreshold) {
      if (!voiceCandidateStartedAtRef.current) {
        voiceCandidateStartedAtRef.current = now;
      }
      if (!isSpeakingRef.current && now - voiceCandidateStartedAtRef.current < speechStartHoldMs) {
        return;
      }
      if (!isSpeakingRef.current) {
        console.log('[speech] start', {
          word: activeMole.word.hanzi,
          volume: Number(volume.toFixed(3)),
          speechStartThreshold: Number(speechStartThreshold.toFixed(3)),
          noiseFloor: Number(noiseFloorRef.current.toFixed(3)),
        });
        speechStartedAtRef.current = voiceCandidateStartedAtRef.current;
        speechPeakVolumeRef.current = volume;
      }
      isSpeakingRef.current = true;
      lastVoiceAtRef.current = now;
      return;
    }

    voiceCandidateStartedAtRef.current = 0;
    if (!isSpeakingRef.current || volume > speechEndThreshold) return;
    if (now - lastVoiceAtRef.current < speechEndSilenceMs) return;
    if (now - lastStrikeRef.current < strikeCooldownMs) return;

    isSpeakingRef.current = false;
    lastStrikeRef.current = now;
    const speechDurationMs = now - speechStartedAtRef.current;
    const speechPeakVolume = speechPeakVolumeRef.current;

    if (shouldSkipWeakUtterance(speechDurationMs, speechPeakVolume, thresholds)) {
      console.log('[speech] skipped weak utterance', {
        word: activeMole.word.hanzi,
        pinyinRaw: activeMole.word.pinyinRaw,
        durationMs: speechDurationMs,
        peakVolume: Number(speechPeakVolume.toFixed(3)),
        noiseFloor: Number(noiseFloorRef.current.toFixed(3)),
        speechStartThreshold: Number(speechStartThreshold.toFixed(3)),
        speechEndThreshold: Number(speechEndThreshold.toFixed(3)),
        minSpeechDurationMs,
        minSpeechPeakVolume: Number(minSpeechPeakVolume.toFixed(3)),
        minSpeechRiseOverNoise: Number(minSpeechRiseOverNoise.toFixed(3)),
      });
      resetCaptureBuffer();
      return;
    }

    const capture = captureRecentAudio({
      sinceMs: speechStartedAtRef.current,
      preRollMs: 220,
      untilMs: lastVoiceAtRef.current,
      postRollMs: 90,
    });
    if (!capture) {
      console.warn('[speech] skipped: no captured audio', {
        word: activeMole.word.hanzi,
        pinyinRaw: activeMole.word.pinyinRaw,
      });
      return;
    }
    const { blob: audio, stats } = capture;
    const peakRiseOverNoise = stats.peakVolume - noiseFloorRef.current;
    if (shouldSkipCaptureQuality(stats, noiseFloorRef.current, thresholds)) {
      console.log('[speech] skipped capture quality gate', {
        word: activeMole.word.hanzi,
        pinyinRaw: activeMole.word.pinyinRaw,
        durationMs: stats.durationMs,
        peakVolume: Number(stats.peakVolume.toFixed(3)),
        averageVolume: Number(stats.averageVolume.toFixed(3)),
        noiseFloor: Number(noiseFloorRef.current.toFixed(3)),
        peakRiseOverNoise: Number(peakRiseOverNoise.toFixed(3)),
        minSpeechDurationMs,
        minSpeechPeakVolume: Number(minSpeechPeakVolume.toFixed(3)),
        minSpeechAverageVolume: Number(minSpeechAverageVolume.toFixed(3)),
        minSpeechRiseOverNoise: Number(minSpeechRiseOverNoise.toFixed(3)),
      });
      resetCaptureBuffer();
      return;
    }
    const speechEndedAt = now;
    console.log('[speech] end, submitting audio', {
      bytes: audio.size,
      type: audio.type,
      word: activeMole.word.hanzi,
      pinyinRaw: activeMole.word.pinyinRaw,
      captureDurationMs: stats.durationMs,
      capturePeakVolume: Number(stats.peakVolume.toFixed(3)),
      captureAverageVolume: Number(stats.averageVolume.toFixed(3)),
    });
    console.log('[latency] utterance submit', {
      word: activeMole.word.hanzi,
      speechDurationMs,
      silenceWaitMs: speechEndedAt - lastVoiceAtRef.current,
      peakVolume: Number(speechPeakVolume.toFixed(3)),
      averageVolume: Number(stats.averageVolume.toFixed(3)),
      bytes: audio.size,
    });
    console.log('[latency] speech end to submit', {
      word: activeMole.word.hanzi,
      elapsedMs: Math.max(0, Date.now() - speechEndedAt),
    });
    submitEvaluation(audio);
  }, [captureRecentAudio, gameState?.activeMole, isGamePaused, micState, resetCaptureBuffer, submitEvaluation, volume]);

  return (
    <div
      className={`game-root${isMicStartScreen ? ' game-root--mic-start' : ''}${isBaoziSelected ? ' game-root--baozi-selected' : ''}`}
      style={rootStyle}
    >
      <div className="game-scene-shell">
        <div
          className="bubble-canvas-wrapper"
          ref={handleCanvasHostRef}
        >
          <MoleCanvas
            gameState={gameState}
            activeMoleRef={activeMoleRef}
            volume={volume}
            resizeTarget={resizeTarget}
            onOverlayLayout={handleOverlayLayout}
          />
        </div>

        <div className="hud-overlay">
          <HUD
            combo={combo}
            timeRemaining={timeRemaining}
            collectedWords={collectedWords}
            selectedFood={selectedFood}
          />
        </div>

        <div className="combo-reward-overlay">
          {comboPopupState ? (
            <RewardComboPopup
              triggerId={comboPopupState.triggerId}
              x={comboPopupState.x}
              y={comboPopupState.y}
              foodLabel={comboPopupState.foodLabel}
              foodImage={comboPopupState.foodImage}
              amount={comboPopupState.amount}
              variant={comboPopupState.variant}
              showFoodLabel={comboPopupState.showFoodLabel}
              onDone={() => {
                setComboPopupState(current => (
                  current?.triggerId === comboPopupState.triggerId ? null : current
                ));
              }}
            />
          ) : null}
        </div>

        <div
          className={pedagogyHintClassName}
          style={pedagogyHintStyle}
        >
          {currentPedagogyHint ? (
            <PedagogyHint
              key={`${currentPedagogyHint.code}-${currentPedagogyHint.text}-${currentPedagogyHint.transcriptPinyin ?? ''}-${Math.round(currentPedagogyHint.confidence * 100)}`}
              hint={currentPedagogyHint}
            />
          ) : null}
        </div>

        {gameState && (gameState.isEvaluating || gameState.lastHint) ? (
          <div className="hint-overlay hint-overlay--dev-center">
            <DevEvalCenterPanel isEvaluating={gameState.isEvaluating} hint={gameState.lastHint} />
          </div>
        ) : null}
      </div>

      <div className="game-controls-dock" ref={dockRef}>
        <div className="mic-overlay">
          <VoiceMeter
            micState={micState}
            volume={volume}
            sessionPracticeUnits={sessionPracticeUnits}
            scriptSession={scriptSession}
            selectedFood={selectedFood}
            onSelectFood={onSelectFood}
            onEnableMic={handleEnableMic}
          />
        </div>
        {!isMicStartScreen ? (
          <div className="gameplay-actions gameplay-actions--gameplay">
            <button
              type="button"
              className="session-select-back-button gameplay-action-button"
              onClick={onBackToSessionSelect}
              aria-label="Back to session list"
            >
              ↩
            </button>
            {showPauseButton ? (
              <button
                type="button"
                className="session-select-back-button gameplay-action-button"
                onClick={handleTogglePause}
                aria-label={pauseControlAriaLabel}
              >
                {pauseControlLabel}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
      {isMicStartScreen ? (
        <div className="ready-back-anchor">
          <button
            type="button"
            className="session-select-back-button gameplay-action-button"
            onClick={onBackToSessionSelect}
            aria-label="Back to session list"
          >
            ↩
          </button>
        </div>
      ) : null}
    </div>
  );
}
