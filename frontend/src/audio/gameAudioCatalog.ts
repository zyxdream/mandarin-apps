export interface HintVoiceAudioClip {
  id: string;
  text: string;
  url: string;
  playbackRate: number;
}

const HINT_VOICE_AUDIO_PUBLIC_DIR = '/audio/sound_effects/hint_voice';

export const HINT_VOICE_AUDIO_CLIPS = [
  {
    id: 'amazing',
    text: 'Amazing',
    url: `${HINT_VOICE_AUDIO_PUBLIC_DIR}/amazing-reference-24k-mono.wav`,
    playbackRate: 1,
  },
  {
    id: 'taibangle',
    text: '太棒了',
    url: `${HINT_VOICE_AUDIO_PUBLIC_DIR}/taibangle.wav`,
    playbackRate: 2,
  },
] as const satisfies readonly HintVoiceAudioClip[];

export function pickPositiveFeedbackText(randomValue = Math.random()): string {
  const boundedValue = Math.max(0, Math.min(randomValue, 1 - Number.EPSILON));
  const index = Math.floor(boundedValue * HINT_VOICE_AUDIO_CLIPS.length);
  return HINT_VOICE_AUDIO_CLIPS[index].text;
}

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
    bgmSpeaking: 0.02,
    sfx: 0.35,
    hintVoice: 0.32,
  },
} as const;
