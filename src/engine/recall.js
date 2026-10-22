/**
 * One three-word question about the stretch that was just read.
 * The answer sits near the middle and has at least four letters.
 * Wrong answers prefer words already read.
 */

export const RECALL_WINDOW = 40;
const MIN_LETTERS = 4;
const NEAREST_DECOYS = 8;
const SENTENCE_LIMIT = 28;

export function wordKey(word) {
  const chars = String(word?.original ?? '').match(/\p{L}|\p{N}/gu);
  return chars ? chars.join('').toLocaleLowerCase() : '';
}

export function recallBounds(words, roundStart, end) {
  const total = words.length;
  let start = roundStart;
  if (start <= 0 && end >= total && total >= 4) {
    const window = Math.min(RECALL_WINDOW, Math.floor(total / 2));
    start = total - window;
  }
  return { start, end };
}

export function selectTarget(words, start, end) {
  return closest(words, start, end, true) || closest(words, start, end, false);
}

export function sentenceAround(words, index, limit = words.length) {
  const cap = Math.min(words.length, Math.max(index + 1, limit));
  let start = index;
  while (start > 0) {
    if (words[start].breakBefore) break;
    if (endsSentence(words[start - 1].original)) break;
    start -= 1;
  }

  let end = index;
  const lastVisible = cap - 1;
  while (end < lastVisible) {
    if (endsSentence(words[end].original)) break;
    if (words[end + 1].breakBefore) break;
    end += 1;
  }

  const clipped = end === lastVisible
    && end + 1 < words.length
    && !endsSentence(words[end].original)
    && !words[end + 1].breakBefore;

  let from = start;
  let to = end;
  let lead = false;
  if (to - from + 1 > SENTENCE_LIMIT) {
    from = Math.max(start, index - 12);
    to = Math.min(end, index + 12);
    lead = from > start;
  }

  const parts = [];
  if (lead) parts.push({ text: '…', marked: false });
  for (let i = from; i <= to; i += 1) {
    parts.push({ text: words[i].original, marked: i === index });
  }
  if (to < end || clipped) parts.push({ text: '…', marked: false });
  return parts;
}

export function buildRecall(words, start, end, random = Math.random) {
  if (!Number.isInteger(start) || !Number.isInteger(end) || end - start < 2) return null;
  const target = selectTarget(words, start, end);
  if (!target) return null;

  const decoys = pickDecoys(words, start, end, wordKey(target.word), random);
  if (decoys.length < 2) return null;

  const choices = shuffle([
    { label: target.word.original, correct: true },
    { label: decoys[0].original, correct: false },
    { label: decoys[1].original, correct: false },
  ], random).map((choice, id) => ({
    id,
    label: choice.label,
    correct: choice.correct,
  }));

  return {
    phase: 'ask',
    choices,
    sentence: sentenceAround(words, target.index, end),
    correct: null,
    points: 0,
  };
}

function closest(words, start, end, excludeLast) {
  if (end - start < 1) return null;
  const center = start + (end - start - 1) / 2;
  let best = null;
  for (let i = start; i < end; i += 1) {
    if (excludeLast && end - start > 1 && i === end - 1) continue;
    if (letterCount(words[i]) < MIN_LETTERS) continue;
    if (!wordKey(words[i])) continue;
    const distance = Math.abs(i - center);
    if (!best || distance < best.distance || (distance === best.distance && i < best.index)) {
      best = { index: i, word: words[i], distance };
    }
  }
  return best;
}

function pickDecoys(words, start, end, targetKey, random) {
  const banned = new Set();
  for (let i = start; i < end; i += 1) {
    const key = wordKey(words[i]);
    if (key) banned.add(key);
  }
  if (targetKey) banned.add(targetKey);

  const earlier = [];
  const later = [];
  const seen = new Set();
  const take = (index, bucket) => {
    if (bucket.length >= NEAREST_DECOYS) return;
    const word = words[index];
    if (letterCount(word) < MIN_LETTERS) return;
    const key = wordKey(word);
    if (!key || banned.has(key) || seen.has(key)) return;
    seen.add(key);
    bucket.push(word);
  };

  for (let i = start - 1; i >= 0; i -= 1) take(i, earlier);
  for (let i = end; i < words.length; i += 1) take(i, later);

  const pool = earlier.length >= 2 ? earlier : [...earlier, ...later].slice(0, NEAREST_DECOYS);
  if (pool.length < 2) return [];
  return shuffle(pool, random).slice(0, 2);
}

function letterCount(word) {
  const chars = String(word?.original ?? '').match(/\p{L}/gu);
  return chars ? chars.length : 0;
}

function endsSentence(original) {
  return /[.!?…]["')\]]*$/u.test(String(original ?? ''));
}

function shuffle(items, random) {
  const copy = items.slice();
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.min(i, Math.floor(Number(random()) * (i + 1)));
    const swap = copy[i];
    copy[i] = copy[j];
    copy[j] = swap;
  }
  return copy;
}
