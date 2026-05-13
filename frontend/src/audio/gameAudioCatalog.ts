export const GAME_AUDIO = {
  bgm: '/audio/main_theme/denis-pavlov-music-marimba-tropical-african-travel-game-197517.mp3',
  sfx: {
    whack: '/audio/sound_effects/whack-hit.mp3',
    success: '/audio/sound_effects/ui-level-unlock.mp3',
    collect: '/audio/sound_effects/correct-collect-item.mp3',
    miss: '/audio/sound_effects/mistake.mp3',
    failure: '/audio/sound_effects/mistake.mp3',
  },
  volume: {
    // Keep BGM intentionally quiet so it does not interfere with pronunciation capture/evaluation.
    bgmBase: 0.14,
    // Guard window: duck BGM while user is expected to speak.
    bgmGuard: 0.04,
    bgmEvaluating: 0.03,
    sfx: 0.35,
  },
} as const;
