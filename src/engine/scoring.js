export function pointsForHit(streak) {
  const safe = Math.max(0, Math.floor(Number(streak) || 0));
  return 100 * (Math.floor(safe / 10) + 1);
}
