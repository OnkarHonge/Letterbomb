/**
 * One cloze about a sentence the reader has finished.
 * The blank is a content word inside the stretch just read. The sentence may
 * have started earlier, as long as its ending was read too. The other two
 * answers are content words from other sentences already read, close in shape,
 * and never taken from later text.
 * A stretch that cannot make that question is skipped.
 */

export const RECALL_WINDOW = 40;

const MIN_LETTERS = 5;
const TIER_GAP = 1;
const TIER_LIMIT = 4;
const LENGTH_CAP = 8;
const LENGTH_GAP = 3;
const SENTENCE_LIMIT = 28;

const STOPWORDS = new Set(`
about above across after again against ahead along almost already always among
another around
because become becomes before behind being below beside besides between beyond
cannot could
doing during
either enough every everyone everything
going
having however
itself
maybe might myself
neither never nothing
often other ought ourselves
perhaps quite
rather really
shall should since something still
their theirs themselves there therefore these those though through toward towards
under unless until using
whatever where whether which while whose within without would
yourself yourselves
`.split(/\s+/).filter(Boolean));

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

export function selectTarget(words, start, end, random = Math.random) {
  const question = pickQuestion(words, start, end, random);
  if (!question) return null;
  return { index: question.index, word: question.word };
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
    if (isWideSpace(words[i])) continue;
    parts.push({ text: words[i].original, marked: i === index });
  }
  if (to < end || clipped) parts.push({ text: '…', marked: false });
  return parts;
}

export function blankedSentence(parts) {
  return parts.map((part) => {
    if (!part.marked) return { text: part.text, marked: false };
    const lead = String(part.text).match(/^[^\p{L}\p{N}]+/u)?.[0] ?? '';
    const trail = String(part.text).match(/[^\p{L}\p{N}]+$/u)?.[0] ?? '';
    return { text: '_____', marked: true, blank: true, lead, trail };
  });
}

export function buildRecall(words, start, end, random = Math.random) {
  const question = pickQuestion(words, start, end, random);
  if (!question) return null;

  const blankStarts = question.index === question.span.start;
  const choices = shuffle([
    { label: choiceLabel(words, question.index, blankStarts), correct: true },
    { label: choiceLabel(words, question.decoys[0], blankStarts), correct: false },
    { label: choiceLabel(words, question.decoys[1], blankStarts), correct: false },
  ], random).map((choice, id) => ({
    id,
    label: choice.label,
    correct: choice.correct,
  }));

  return {
    phase: 'ask',
    choices,
    sentence: sentenceAround(words, question.index, end),
    correct: null,
    points: 0,
  };
}

function pickQuestion(words, start, end, random) {
  if (!Number.isInteger(start) || !Number.isInteger(end) || end - start < 2) return null;
  const freq = frequencies(words);
  const ranked = [];

  for (let index = start; index < end; index += 1) {
    if (!isContentWord(words[index])) continue;
    const span = sentenceSpan(words, index);
    if (!spanClosed(words, span) || span.end >= end) continue;
    const key = wordKey(words[index]);
    if (countKey(words, span, key) !== 1) continue;

    const decoys = pickDecoys(words, end, index, span);
    if (decoys.length < 2) continue;
    ranked.push({
      index,
      word: words[index],
      span,
      decoys,
      score: targetScore(words, index, freq),
    });
  }

  if (!ranked.length) return null;
  const center = start + (end - start - 1) / 2;
  ranked.sort((a, b) => (
    b.score - a.score
    || Math.abs(a.index - center) - Math.abs(b.index - center)
    || a.index - b.index
  ));

  const best = ranked[0].score;
  const tier = ranked.filter((item) => item.score >= best - TIER_GAP).slice(0, TIER_LIMIT);
  return tier[roll(random, tier.length)];
}

function pickDecoys(words, end, targetIndex, span) {
  const blankStarts = targetIndex === span.start;
  const targetProper = isProperName(words, targetIndex);
  const banned = new Set();
  for (let i = span.start; i <= span.end; i += 1) {
    const key = wordKey(words[i]);
    if (key) banned.add(key);
  }

  const targetLabel = choiceLabel(words, targetIndex, blankStarts).toLocaleLowerCase();
  const seen = new Set([targetLabel]);
  const pool = [];

  for (let index = 0; index < end; index += 1) {
    if (index >= span.start && index <= span.end) continue;
    if (!isContentWord(words[index])) continue;
    if (isProperName(words, index) !== targetProper) continue;
    if (!blankStarts && startsSentence(words, index)) continue;
    const fit = decoyFit(words[targetIndex], words[index]);
    if (!fit.usable) continue;
    const key = wordKey(words[index]);
    const label = choiceLabel(words, index, blankStarts).toLocaleLowerCase();
    if (!key || !label || banned.has(key) || seen.has(label)) continue;
    seen.add(label);
    pool.push({ index, ...fit });
  }

  if (!pool.some((item) => item.strong)) return [];
  pool.sort((a, b) => (
    Number(b.strong) - Number(a.strong)
    || Number(b.sameEnding) - Number(a.sameEnding)
    || a.gap - b.gap
    || Math.abs(a.index - targetIndex) - Math.abs(b.index - targetIndex)
    || a.index - b.index
  ));
  return pool.slice(0, 2).map((item) => item.index);
}

function decoyFit(target, decoy) {
  const sameEnding = endingClass(wordKey(target)) === endingClass(wordKey(decoy));
  const gap = Math.abs(letterCount(target) - letterCount(decoy));
  const strong = sameEnding && gap <= LENGTH_GAP;
  return { strong, sameEnding, gap, usable: strong || gap <= LENGTH_GAP };
}

function targetScore(words, index, freq) {
  let score = Math.min(letterCount(words[index]), LENGTH_CAP);
  if (freq.get(wordKey(words[index])) === 1) score += 10;
  if (isProperName(words, index)) score += 6;
  return score;
}

function isContentWord(word) {
  if (letterCount(word) < MIN_LETTERS) return false;
  const key = wordKey(word);
  return Boolean(key) && !STOPWORDS.has(key);
}

function startsSentence(words, index) {
  return index === sentenceSpan(words, index).start;
}

function isProperName(words, index) {
  if (startsSentence(words, index)) return false;
  const bare = bareWord(words[index].original);
  if (!bare) return false;
  const first = bare.charAt(0);
  return first === first.toLocaleUpperCase() && first !== first.toLocaleLowerCase();
}

function choiceLabel(words, index, blankStarts) {
  const label = bareWord(words[index].original);
  if (!label) return '';
  const first = label.charAt(0);
  const rest = label.slice(1);
  if (blankStarts) return first.toLocaleUpperCase() + rest;
  if (isProperName(words, index)) return label;
  return first.toLocaleLowerCase() + rest;
}

function sentenceSpan(words, index) {
  let start = index;
  while (start > 0 && !words[start].breakBefore && !endsSentence(words[start - 1].original)) {
    start -= 1;
  }
  let end = index;
  while (
    end + 1 < words.length
    && !endsSentence(words[end].original)
    && !words[end + 1].breakBefore
  ) {
    end += 1;
  }
  return { start, end };
}

function spanClosed(words, span) {
  if (span.end >= words.length - 1) return true;
  if (endsSentence(words[span.end].original)) return true;
  return Boolean(words[span.end + 1]?.breakBefore);
}

function countKey(words, span, key) {
  let count = 0;
  for (let i = span.start; i <= span.end; i += 1) {
    if (wordKey(words[i]) === key) count += 1;
  }
  return count;
}

function frequencies(words) {
  const freq = new Map();
  for (const word of words) {
    const key = wordKey(word);
    if (!key) continue;
    freq.set(key, (freq.get(key) || 0) + 1);
  }
  return freq;
}

function endingClass(key) {
  if (key.length >= 6 && key.endsWith('ing')) return 'ing';
  if (key.length >= 5 && key.endsWith('ly')) return 'ly';
  if (key.length >= 5 && key.endsWith('ed')) return 'ed';
  return 'other';
}

function bareWord(original) {
  return String(original ?? '').replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
}

function letterCount(word) {
  const chars = String(word?.original ?? '').match(/\p{L}/gu);
  return chars ? chars.length : 0;
}

function endsSentence(original) {
  return /[.!?…]["')\]]*$/u.test(String(original ?? ''));
}

function isWideSpace(word) {
  return /^\s+$/.test(String(word?.original ?? ''));
}

function roll(random, length) {
  const draw = Number(random());
  if (!Number.isFinite(draw)) return 0;
  return Math.min(length - 1, Math.max(0, Math.floor(draw * length)));
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
