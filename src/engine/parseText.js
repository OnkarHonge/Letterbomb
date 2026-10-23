export const FILTERS = new Set(['all', 'long', 'vowel', 'capital']);
export const LONG_WORD_LETTERS = 4;
export const VOWELS = 'AEIOU';
export const PUNCTUATION_MARKS = '.!?,;:…';

export function normalizeKey(raw) {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  const folded = raw.normalize('NFD').replace(/\p{M}/gu, '').toUpperCase();
  if (folded.length !== 1) return null;
  return /[A-Z0-9]/.test(folded) ? folded : null;
}

export function countWords(raw) {
  return parseText(raw).length;
}

export function parseText(raw, filter = 'all') {
  const mode = FILTERS.has(filter) ? filter : 'all';
  const normalized = String(raw ?? '').replace(/\r\n/g, '\n').trim();
  if (!normalized) return [];

  const words = [];
  const paragraphs = normalized.split(/\n\s*\n/);

  for (const paragraph of paragraphs) {
    const tokens = paragraph.replace(/\n/g, ' ').trim().split(/\s+/).filter(Boolean);
    tokens.forEach((original, tokenIndex) => {
      words.push(annotate(original, words.length, mode, tokenIndex === 0 && words.length > 0));
    });
  }

  return words;
}

export function applyFilter(words, filter) {
  const mode = FILTERS.has(filter) ? filter : 'all';
  return words.map((word) => ({
    ...word,
    isTarget: isTargetWord(word, mode),
  }));
}

function annotate(original, id, filter, breakBefore) {
  const match = original.match(/\p{L}|\p{N}/u);
  const base = {
    id,
    original,
    before: '',
    displayChar: '',
    after: '',
    targetChar: null,
    hasPunctuation: [...PUNCTUATION_MARKS].some((mark) => original.includes(mark)),
    isLong: false,
    isVowel: false,
    isCapital: false,
    isTarget: false,
    breakBefore,
  };

  if (!match) return base;

  const displayChar = match[0];
  const index = match.index ?? 0;
  const letters = original.match(/\p{L}/gu) || [];
  const targetChar = normalizeKey(displayChar);
  const word = {
    ...base,
    before: original.slice(0, index),
    displayChar,
    after: original.slice(index + displayChar.length),
    targetChar,
    isLong: letters.length >= LONG_WORD_LETTERS,
    isVowel: Boolean(targetChar && VOWELS.includes(targetChar)),
    isCapital: isUpperLetter(displayChar),
  };
  word.isTarget = isTargetWord(word, filter);
  return word;
}

function isUpperLetter(char) {
  if (!/\p{L}/u.test(char)) return false;
  const upper = char.toLocaleUpperCase();
  const lower = char.toLocaleLowerCase();
  return char === upper && upper !== lower;
}

function isTargetWord(word, filter) {
  if (!word.targetChar) return false;
  if (filter === 'long') return word.isLong;
  if (filter === 'vowel') return word.isVowel;
  if (filter === 'capital') return word.isCapital;
  return true;
}
