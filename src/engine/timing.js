import { DEFAULT_CONFIG, LIMITS } from './config.js';

/** A beat with no letter keeps this share of the plain word slot. */
const GAP_FRACTION = 1 / 3;

/**
 * Time allowed on one word:
 * dwell = 60_000 / wpm, stretched by the punctuation multiplier
 * and by the opening pause on the first word after a window,
 * plus the forgiveness window on words that require a key.
 * A gap keeps a third of the plain slot: no stretch, no forgiveness.
 */
export function wordDeadlineMs(word, config = {}) {
  const wpm = clamp(config.wpm, LIMITS.wpm, DEFAULT_CONFIG.wpm);
  const dwell = 60000 / wpm;
  if (word?.isGap) return Math.max(1, Math.round(dwell * GAP_FRACTION));

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

  let time = dwell;
  if (word?.hasPunctuation) time *= punctuation;
  if (word?.isOpening) time *= opening;
  if (word?.isTarget) time += forgiveness;
  return Math.max(1, Math.round(time));
}

function clamp(value, [min, max], fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}
