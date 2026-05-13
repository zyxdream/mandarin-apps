/** Static reference clips; filenames match `Word.id` (see `public/audio/reference/`). */
export function referenceAudioUrl(wordId: string): string {
  return `/audio/reference/${encodeURIComponent(wordId)}.mp3`;
}
