export function getEarnedStarCount(correctCount: number, totalCount: number): number {
  if (!Number.isFinite(totalCount)) return 0;

  const normalizedTotal = Math.max(0, Math.floor(totalCount));
  if (normalizedTotal === 0) return 0;

  const normalizedCorrect = Number.isFinite(correctCount)
    ? Math.min(normalizedTotal, Math.max(0, Math.floor(correctCount)))
    : 0;

  if (normalizedCorrect >= Math.ceil(normalizedTotal * 0.9)) return 3;
  if (normalizedCorrect >= Math.ceil((normalizedTotal * 2) / 3)) return 2;
  if (normalizedCorrect >= Math.ceil(normalizedTotal / 3)) return 1;
  return 0;
}
