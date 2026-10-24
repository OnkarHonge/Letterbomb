import { DEFAULT_CONFIG, LIMITS } from './config.js';
import { LONG_WORD_LETTERS, normalizeKey } from './parseText.js';

/** One spot check in each group of this many longer words that need a key. */
export const SPOT_EVERY = 5;
/** The word stays on screen this long after a correct spot-check letter. */
export const SPOT_REVEAL_MS = 400;
const LOOK_EXTRA_PER = 30;
const LOOK_EXTRA_CAP = 300;

/**
 * Letters and digits that can be the marked block, in reading order.
 * Punctuation is not a position.
 */
export function cueChars(original) {
  const text = String(original ?? '');
  const chars = [];
  for (const match of text.matchAll(/\p{L}|\p{N}/gu)) {
    const key = normalizeKey(match[0]);
    if (!key) continue;
    chars.push({ index: match.index ?? 0, length: match[0].length, key });
  }
  return chars;
}

/** One of the pressable characters, each equally likely. */
export function pickCue(original, random = Math.random) {
  const chars = cueChars(original);
  if (!chars.length) return null;
  return chars[rollIndex(chars.length, random)];
}

export function hiddenWordLabel(original, cueIndex) {
  const chars = cueChars(original);
  const at = chars.findIndex((item) => item.index === cueIndex);
  if (at < 0) return 'Hidden word.';
  return `Hidden word. Marked block ${at + 1} of ${chars.length}.`;
}

/**
 * How the active word is drawn.
 * `first` is the ordinary first-letter mark. `plain` is the look.
 * `blocks` hides the letters. `cue` brings one letter back.
 */
export function spotFace(phase, status) {
  if (!phase) return 'first';
  if (phase === 'look') return 'plain';
  if (phase === 'answer' && status !== 'frozen') return 'blocks';
  return 'cue';
}

/**
 * Which longer target words are spot checks for this run.
 * Each full group of five contributes one, placed at random.
 * A spot check never sits on the next eligible word after another.
 * A short tail after a full group stays ordinary.
 */
export function pickSpotIds(words, random = Math.random) {
  const eligible = words.filter((word) => (
    word.isTarget && word.isLong && cueChars(word.original).length > 0
  ));
  const ids = [];
  let start = 0;
  let last = -2;
  while (start < eligible.length) {
    const span = Math.min(SPOT_EVERY, eligible.length - start);
    if (span < SPOT_EVERY && start !== 0) break;
    let at = start + rollIndex(span, random);
    if (at <= last + 1) {
      at = last + 2;
      if (at >= start + span) {
        start += span;
        continue;
      }
    }
    ids.push(eligible[at].id);
    last = at;
    start += span;
  }
  return ids;
}

/**
 * How long the word stays readable before the blocks.
 * Longer words add a little, up to ten letters past the minimum.
 * Punctuation and the opening pause stretch that look.
 */
export function spotLookMs(word, config = {}) {
  const base = clamp(config.spotLookMs, LIMITS.spotLookMs, DEFAULT_CONFIG.spotLookMs);
  const letters = String(word?.original ?? '').match(/\p{L}/gu)?.length ?? 0;
  const extra = Math.min(LOOK_EXTRA_CAP, LOOK_EXTRA_PER * Math.max(0, letters - LONG_WORD_LETTERS));
  let look = base + extra;
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
  if (word?.hasPunctuation) look *= punctuation;
  if (word?.isOpening) look *= opening;
  return Math.max(1, Math.round(look));
}

function rollIndex(span, random) {
  const roll = Number(random());
  if (!Number.isFinite(roll)) return 0;
  return Math.min(span - 1, Math.max(0, Math.floor(roll * span)));
}

function clamp(value, [min, max], fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}
