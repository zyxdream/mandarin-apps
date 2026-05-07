import type { Word } from '../types/word';
import { WORDS } from './words';
import { SCRIPT_SESSIONS } from './scriptSessions.generated';

export interface ScriptToken {
  text: string;
  pinyin?: string;
  startSec?: number;
  endSec?: number;
  timingSource?: 'aligned' | 'estimated';
}

export interface ScriptSession {
  id: string;
  title: string;
  source: string[];
  ttsScript: string;
  audioUrl: string;
  scriptTokens: ScriptToken[];
  words: Word[];
}

const FALLBACK_SCRIPT_SESSION: ScriptSession = {
  id: 'fallback-words',
  title: 'Practice Round',
  source: ['Built-in practice words'],
  ttsScript: WORDS.map(word => word.hanzi).join('。'),
  audioUrl: '',
  scriptTokens: WORDS.flatMap((word, index) => [
    ...word.hanzi.split('').map((text): ScriptToken => ({ text })),
    ...(index === WORDS.length - 1 ? [] : [{ text: '。' }]),
  ]),
  words: WORDS,
};

function isValidScriptSession(session: ScriptSession): boolean {
  return Boolean(
    session.id &&
    session.title &&
    session.words.length > 0 &&
    session.words.every(word => word.id && word.hanzi && word.pinyin && word.pinyinRaw),
  );
}

export const ORDERED_SCRIPT_SESSIONS = SCRIPT_SESSIONS.filter(isValidScriptSession);

export const SCRIPT_SESSION_COUNT = Math.max(1, ORDERED_SCRIPT_SESSIONS.length);

export function getScriptSession(index: number): ScriptSession {
  if (ORDERED_SCRIPT_SESSIONS.length === 0) return FALLBACK_SCRIPT_SESSION;
  const safeIndex = ((index % ORDERED_SCRIPT_SESSIONS.length) + ORDERED_SCRIPT_SESSIONS.length) % ORDERED_SCRIPT_SESSIONS.length;
  return ORDERED_SCRIPT_SESSIONS[safeIndex];
}

export function getNextScriptSessionIndex(index: number): number {
  if (ORDERED_SCRIPT_SESSIONS.length === 0) return 0;
  return (index + 1) % ORDERED_SCRIPT_SESSIONS.length;
}

export function getPreviousScriptSessionIndex(index: number): number {
  if (ORDERED_SCRIPT_SESSIONS.length === 0) return 0;
  return (index - 1 + ORDERED_SCRIPT_SESSIONS.length) % ORDERED_SCRIPT_SESSIONS.length;
}
