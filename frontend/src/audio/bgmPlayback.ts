export type GameBgmPlaybackMode = 'playing' | 'paused' | 'disabled';

export interface BgmPlaybackElement {
  readonly paused: boolean;
  currentTime: number;
  volume: number;
  pause: () => void;
  play: () => Promise<void>;
}

export function syncGameBgmPlayback(
  audio: BgmPlaybackElement,
  mode: GameBgmPlaybackMode,
  onPlayError: (error: unknown) => void = () => undefined,
): void {
  if (mode === 'disabled') {
    audio.pause();
    audio.currentTime = 0;
    audio.volume = 0;
    return;
  }

  if (mode === 'paused') {
    if (!audio.paused) {
      audio.pause();
    }
    return;
  }

  if (audio.paused) {
    void audio.play().catch(onPlayError);
  }
}
