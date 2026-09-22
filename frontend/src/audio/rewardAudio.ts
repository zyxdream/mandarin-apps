export interface RewardAudioState {
  screen: string;
  isPaused: boolean;
}

export function canPlayRewardArrival(
  enabled: boolean,
  gameState: RewardAudioState | null,
): boolean {
  return enabled && gameState?.screen === 'game' && !gameState.isPaused;
}
