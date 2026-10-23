import { DEFAULT_CONFIG, LIMITS } from './config.js';

/**
 * Time allowed on one word:
 * dwell = 60_000 / wpm, stretched by the punctuation multiplier
 * and by the opening pause on the first word after a window,
 * plus the forgiveness window on words that require a key.
 */
export function wordDeadlineMs(word, config = {}) {
  const wpm = clamp(config.wpm, LIMITS.wpm, DEFAULT_CONFIG.wpm);
  const forgiveness = clamp(config.forgivenessMs, LIMITS.forgivenessMs, DEFAULT_CONFIG.forgivenessMs);
  const punctuation = clamp(
    config.punctuationMultiplier,
    LIMITS.punctuationMultiplier,
    DEFAULT_CONFIG.punctuationMultiplier,
  );
  const opening = clamp(
    config.openingMultiplier,
    LIMITS.openingMultiplier,
    DEFAULT_CONFIG.openingMultiplier,
  );

  let dwell = 60000 / wpm;
  if (word?.hasPunctuation) dwell *= punctuation;
  if (word?.isOpening) dwell *= opening;
  if (word?.isTarget) dwell += forgiveness;
  return Math.max(1, Math.round(dwell));
}

function clamp(value, [min, max], fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}
