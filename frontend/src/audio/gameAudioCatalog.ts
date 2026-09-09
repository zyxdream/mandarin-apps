export interface HintVoiceAudioClip {
  id: string;
  text: string;
  url: string;
}

const HINT_VOICE_AUDIO_PUBLIC_DIR = '/audio/sound_effects/hint_voice';

export const HINT_VOICE_AUDIO_CLIPS = [
  {
    id: 'great',
    text: 'Great',
    url: `${HINT_VOICE_AUDIO_PUBLIC_DIR}/great.mp3`,
  },
  {
    id: 'amazing',
    text: 'Amazing',
    url: `${HINT_VOICE_AUDIO_PUBLIC_DIR}/amazing.mp3`,
  },
  {
    id: 'fantastic',
    text: 'Fantastic',
    url: `${HINT_VOICE_AUDIO_PUBLIC_DIR}/fantastic.mp3`,
  },
  {
    id: 'try-again',
    text: 'Try again',
    url: `${HINT_VOICE_AUDIO_PUBLIC_DIR}/try-again.mp3`,
  },
  {
    id: 'so-close',
    text: 'So close',
    url: `${HINT_VOICE_AUDIO_PUBLIC_DIR}/so-close.mp3`,
  },
  {
    id: 'try-that-sound-again',
    text: 'Try that sound again',
    url: `${HINT_VOICE_AUDIO_PUBLIC_DIR}/try-that-sound-again.mp3`,
  },
] as const satisfies readonly HintVoiceAudioClip[];

export const HINT_VOICE_AUDIO_BY_TEXT = Object.fromEntries(
  HINT_VOICE_AUDIO_CLIPS.map(clip => [clip.text, clip]),
) as Readonly<Record<string, HintVoiceAudioClip>>;

export const GAME_AUDIO = {
  bgm: '/audio/main_theme/denis-pavlov-music-marimba-tropical-african-travel-game-197517.mp3',
  sfx: {
    whack: '/audio/sound_effects/whack-hit.mp3',
    success: '/audio/sound_effects/ui-level-unlock.mp3',
    collect: '/audio/sound_effects/correct-collect-item.mp3',
    miss: '/audio/sound_effects/mistake.mp3',
    failure: '/audio/sound_effects/mistake.mp3',
  },
  hintVoice: HINT_VOICE_AUDIO_CLIPS,
  volume: {
    // Keep BGM intentionally quiet so it does not interfere with pronunciation capture/evaluation.
    bgmBase: 0.14,
    // Guard window: duck BGM while user is expected to speak.
    bgmGuard: 0.04,
    bgmEvaluating: 0.03,
    sfx: 0.35,
    hintVoice: 0.32,
  },
} as const;
