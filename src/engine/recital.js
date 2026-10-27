import { wordKey } from './parseText.js';
import { wordDeadlineMs } from './timing.js';
import { DEFAULT_CONFIG, LIMITS } from './config.js';

/** A soft cut aims for this many words, and may land a little under or over. */
export const RECITAL_PHRASE_WORDS = 10;

/** A clause this long, or shorter, stays whole until a pause. */
const RECITAL_PHRASE_LIMIT = 12;

/**
 * Groups a run into phrases.
 * A word with punctuation ends a phrase, and a blank line starts a new one.
 * Past about ten words, the phrase also ends where a piece is finished.
 * Anything left at the end, including a short tail, is its own phrase.
 * A token with no letter stays a single pass between phrases.
 */
export function pickPhrases(words) {
  const spans = [];
  let index = 0;
  while (index < words.length) {
    if (!words[index]?.targetChar) {
      spans.push({ start: index, end: index + 1, kind: 'pass' });
      index += 1;
      continue;
    }

    const end = phraseEnd(words, index);
    spans.push({ start: index, end, kind: 'phrase' });
    index = end;
  }
  return spans;
}

function phraseEnd(words, start) {
  let hard = start;
  while (hard < words.length && words[hard]?.targetChar) {
    if (hard > start && words[hard].breakBefore) break;
    hard += 1;
    if (words[hard - 1].hasPunctuation) break;
  }

  const count = hard - start;
  if (count <= RECITAL_PHRASE_LIMIT) return hard;

  const span = words.slice(start, hard);
  let best = null;
  for (let index = 0; index < span.length - 1; index += 1) {
    if (!canEndAfter(span, index)) continue;
    const length = index + 1;
    const distance = Math.abs(length - RECITAL_PHRASE_WORDS);
    if (
      !best
      || distance < best.distance
      || (distance === best.distance && length < best.length)
    ) {
      best = { length, distance };
    }
  }
  if (!best) return hard;
  return start + best.length;
}

// Words that still need what follows them: a determiner, a joining word, a helper verb.
const NO_END = new Set([
  'a', 'an', 'the',
  'my', 'your', 'his', 'her', 'its', 'our', 'their',
  'this', 'that', 'these', 'those',
  'and', 'or', 'but', 'nor', 'yet', 'so',
  'where', 'when', 'while', 'because', 'although', 'though', 'if', 'unless',
  'until', 'whether', 'since', 'whereas', 'which', 'who', 'whom', 'whose',
  'of', 'to', 'in', 'on', 'for', 'with', 'from', 'by', 'at', 'into', 'over',
  'under', 'about', 'between', 'through', 'during', 'without', 'within',
  'across', 'after', 'before', 'against', 'among', 'around', 'behind',
  'below', 'beside', 'beyond', 'inside', 'outside', 'toward', 'towards',
  'upon', 'via', 'per', 'as', 'than', 'like',
  'up', 'out', 'off', 'down', 'away', 'back', 'onto', 'along',
  'am', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'do', 'does', 'did', 'have', 'has', 'had', 'having',
  'will', 'would', 'can', 'could', 'shall', 'should', 'may', 'might', 'must',
  'not', 'dont', 'doesnt', 'didnt', 'isnt', 'arent', 'wasnt', 'werent',
  'havent', 'hasnt', 'hadnt', 'wont', 'wouldnt', 'cant', 'couldnt',
  'shouldnt', 'mustnt',
]);

// A verb keeps the piece that follows it, unless that piece is a new join.
const VERBS = new Set([
  'let', 'lets', 'call', 'calls', 'called',
  'make', 'makes', 'made', 'allow', 'allows', 'allowed',
  'help', 'helps', 'helped', 'give', 'gives', 'gave', 'given',
  'take', 'takes', 'took', 'taken', 'get', 'gets', 'got',
  'use', 'uses', 'used', 'need', 'needs', 'needed',
  'want', 'wants', 'wanted', 'keep', 'keeps', 'kept',
  'set', 'sets', 'show', 'shows', 'showed', 'shown',
  'include', 'includes', 'included', 'provide', 'provides', 'provided',
  'require', 'requires', 'required', 'create', 'creates', 'created',
  'enable', 'enables', 'enabled', 'configure', 'configures', 'configured',
  'tell', 'tells', 'told', 'ask', 'asks', 'asked',
  'see', 'sees', 'saw', 'seen', 'know', 'knows', 'knew', 'known',
  'say', 'says', 'said', 'find', 'finds', 'found',
  'start', 'starts', 'started', 'try', 'tries', 'tried',
  'leave', 'leaves', 'left', 'put', 'puts', 'bring', 'brings', 'brought',
  'begin', 'begins', 'began', 'begun', 'write', 'writes', 'wrote', 'written',
  'follow', 'follows', 'followed', 'change', 'changes', 'changed',
  'offer', 'offers', 'offered', 'consider', 'considers', 'considered',
  'build', 'builds', 'built', 'send', 'sends', 'sent',
  'expect', 'expects', 'expected', 'decide', 'decides', 'decided',
  'explain', 'explains', 'explained', 'describe', 'describes', 'described',
  'add', 'adds', 'added', 'read', 'reads', 'learn', 'learns', 'learned',
  'remember', 'remembers', 'remembered', 'understand', 'understands', 'understood',
  'run', 'runs', 'ran', 'move', 'moves', 'moved', 'turn', 'turns', 'turned',
  'work', 'works', 'worked', 'mean', 'means', 'meant',
  'seem', 'seems', 'seemed', 'become', 'becomes', 'became',
]);

const PRONOUNS = new Set([
  'i', 'you', 'he', 'she', 'it', 'we', 'they',
  'me', 'him', 'us', 'them', 'someone', 'anyone', 'everyone', 'one',
]);

const ING_SKIP = new Set([
  'sing', 'ring', 'king', 'bring', 'thing', 'wing', 'spring', 'string',
  'during', 'morning', 'evening', 'something', 'nothing', 'anything', 'everything',
]);

const ED_SKIP = new Set(['red', 'bed', 'wed', 'hundred', 'speed']);

function canEndAfter(span, index) {
  const current = span[index];
  const next = span[index + 1];
  if (!current || !next) return false;

  const cur = wordKey(current);
  const nxt = wordKey(next);
  if (!cur || NO_END.has(cur)) return false;
  if (cur === 'such' && nxt === 'that') return false;
  if (nxt === 'of' || continuesName(span, index) || holdsComplement(current, next)) return false;
  if (modifierHolds(current, next) || contentHolds(current, next)) return false;
  return true;
}

function continuesName(span, index) {
  const current = span[index];
  const next = span[index + 1];
  if (!current?.isCapital || !next) return false;
  if (next.isCapital) return true;
  if (index === 0) return false;
  const nxt = wordKey(next);
  if (!nxt || NO_END.has(nxt) || VERBS.has(nxt)) return false;
  return true;
}

function holdsComplement(current, next) {
  const cur = wordKey(current);
  const nxt = wordKey(next);
  if (!nxt) return false;
  if (PRONOUNS.has(cur) && (VERBS.has(nxt) || nxt === 'to' || isParticiple(next))) return true;
  if (!isParticiple(current) && !VERBS.has(cur)) return false;
  if (PARTICLE.has(nxt)) return true;
  if (RELEASE.has(nxt)) return false;
  if (VERBS.has(nxt)) return false;
  return true;
}

// A phrase may end before these. A verb still keeps a determiner or an object.
const RELEASE = new Set([
  'and', 'or', 'but', 'nor', 'yet', 'so',
  'from', 'with', 'in', 'on', 'for', 'by', 'at', 'into', 'over', 'under',
  'about', 'between', 'through', 'during', 'without', 'within', 'across',
  'after', 'before', 'against', 'among', 'around', 'behind', 'below',
  'beside', 'beyond', 'inside', 'outside', 'toward', 'towards', 'upon',
  'via', 'per', 'as', 'than', 'like', 'then', 'such',
]);

const ADJECTIVE_SUFFIXES = [
  'ical', 'ible', 'able', 'less', 'ful', 'ous', 'ive', 'ish', 'ent', 'ant',
  'ary', 'ory', 'ial', 'ile', 'ate', 'ic', 'al',
];

const LY_SKIP = new Set([
  'family', 'apply', 'reply', 'supply', 'multiply', 'holy', 'italy', 'anomaly',
]);

const ADVERBS = new Set([
  'far', 'well', 'more', 'most', 'very', 'too', 'just', 'still', 'already',
  'even', 'much', 'less', 'least', 'quite', 'rather', 'almost', 'nearly',
]);

function modifierHolds(current, next) {
  const cur = wordKey(current);
  const nxt = wordKey(next);
  if (!cur || !nxt || RELEASE.has(nxt)) return false;
  if (cur.endsWith('ly') && cur.length >= 5 && !LY_SKIP.has(cur)) return true;
  if (ADVERBS.has(cur)) return true;
  if (VERBS.has(nxt)) return false;
  return ADJECTIVE_SUFFIXES.some((suffix) => cur.length > suffix.length + 2 && cur.endsWith(suffix));
}

function contentHolds(current, next) {
  if (!isContent(current) || !isContent(next)) return false;
  if (VERBS.has(wordKey(next))) return false;
  return !isParticiple(next);
}

function isContent(word) {
  const value = wordKey(word);
  if (!value || NO_END.has(value) || RELEASE.has(value) || PRONOUNS.has(value) || PARTICLE.has(value)) {
    return false;
  }
  return true;
}

const PARTICLE = new Set([
  'up', 'out', 'off', 'down', 'away', 'back', 'over', 'on', 'in', 'through', 'along',
]);

function isParticiple(word) {
  const text = wordKey(word);
  if (!text) return false;
  if (text.endsWith('ing') && text.length >= 5 && !ING_SKIP.has(text)) return true;
  if (text.endsWith('ed') && text.length >= 5 && !ED_SKIP.has(text)) return true;
  return false;
}

/** Twice the time those words would have lasted one by one. */
export function recitalLookMs(phraseWords, config, opening = false) {
  const sum = phraseWords.reduce((total, word, wordIndex) => {
    const timed = wordIndex === 0 && opening ? { ...word, isOpening: true } : word;
    return total + wordDeadlineMs(timed, config);
  }, 0);
  return Math.max(1, sum * 2);
}

/** Each dark key gets this many plain reading slots, with no extras. */
export const RECITAL_FUSE_SCALE = 2;

export function recitalFuseMs(config = {}) {
  const wpm = clamp(config.wpm, LIMITS.wpm, DEFAULT_CONFIG.wpm);
  return Math.max(1, Math.round(60000 / wpm) * RECITAL_FUSE_SCALE);
}

function clamp(value, [min, max], fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}
