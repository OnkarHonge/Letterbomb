import { describe, expect, it } from 'vitest';
import { parseText } from '../src/engine/parseText.js';
import {
  buildRecall,
  recallBounds,
  selectTarget,
  sentenceAround,
} from '../src/engine/recall.js';

const LINE = 'alpha bravo charlie delta echo foxtrot golf hotel';

describe('recall', () => {
  it('picks the longer word nearest the middle, not the last word', () => {
    const words = parseText('The cat sat quietly beside friends today extra');
    expect(selectTarget(words, 0, 7).word.original).toBe('quietly');
  });

  it('falls back to the last word when it is the only long one', () => {
    const words = parseText('The cat sat quietly');
    expect(selectTarget(words, 0, 4).word.original).toBe('quietly');
  });

  it('prefers words already read for the wrong answers', () => {
    const words = parseText(LINE);
    const recall = buildRecall(words, 2, 6, () => 0);
    expect(selectTarget(words, 2, 6).word.original).toBe('delta');
    expect(recall.choices.map((choice) => choice.label).sort()).toEqual([
      'alpha',
      'bravo',
      'delta',
    ]);
  });

  it('uses later words only when earlier ones run out', () => {
    const words = parseText(LINE);
    const recall = buildRecall(words, 0, 4, () => 0);
    const labels = recall.choices.map((choice) => choice.label);
    expect(labels).toContain('bravo');
    for (const label of labels) {
      if (label !== 'bravo') expect(['echo', 'foxtrot', 'golf', 'hotel']).toContain(label);
    }
  });

  it('skips a stretch that cannot make a fair question', () => {
    expect(buildRecall(parseText('Go Go Go Go'), 0, 4, () => 0)).toBeNull();
    expect(buildRecall(parseText(LINE), 0, 8, () => 0)).toBeNull();
  });

  it('shrinks a whole article so earlier words can be wrong answers', () => {
    const words = parseText(LINE);
    expect(recallBounds(words, 0, words.length)).toEqual({ start: 4, end: 8 });
    expect(recallBounds(words, 0, 4)).toEqual({ start: 0, end: 4 });
  });

  it('keeps a whole-article question inside the last forty words', () => {
    const words = namedWords(100);
    expect(recallBounds(words, 0, words.length)).toEqual({ start: 60, end: 100 });
  });

  it('draws wrong answers from the nearest words already read', () => {
    const words = namedWords(20);
    const recall = buildRecall(words, 16, 20, () => 0);
    const wrong = recall.choices
      .map((choice) => choice.label)
      .filter((label) => label !== 'word0017');
    expect(wrong).toHaveLength(2);
    for (const label of wrong) {
      const index = Number(label.slice(4));
      expect(index).toBeGreaterThanOrEqual(8);
      expect(index).toBeLessThan(16);
    }
  });

  it('does not offer a word that already appeared in the round', () => {
    const words = parseText('Reading alpha bravo reading charlie delta echo');
    const recall = buildRecall(words, 3, 7, () => 0);
    expect(recall.choices.map((choice) => choice.label).sort()).toEqual([
      'alpha',
      'bravo',
      'charlie',
    ]);
  });

  it('stops the shown sentence at the words already read', () => {
    const words = parseText(LINE);
    expect(sentenceAround(words, 1, 4).map((part) => part.text)).toEqual([
      'alpha',
      'bravo',
      'charlie',
      'delta',
      '…',
    ]);
  });

  it('keeps the sentence inside its own punctuation and paragraph', () => {
    const words = parseText('Alpha bravo.\n\nCharlie delta echo.');
    const delta = words.findIndex((word) => word.original.startsWith('delta'));
    expect(sentenceAround(words, delta).map((part) => part.text)).toEqual([
      'Charlie',
      'delta',
      'echo.',
    ]);
    expect(sentenceAround(words, delta).some((part) => part.text.startsWith('Alpha'))).toBe(false);
    expect(sentenceAround(words, delta).filter((part) => part.marked)).toEqual([
      { text: 'delta', marked: true },
    ]);
  });

  it('trims a long sentence around the recalled word', () => {
    const words = namedWords(40);
    const parts = sentenceAround(words, 20);
    expect(parts[0]).toEqual({ text: '…', marked: false });
    expect(parts.at(-1)).toEqual({ text: '…', marked: false });
    expect(parts.filter((part) => part.marked)).toEqual([{ text: 'word0020', marked: true }]);
    expect(parts.some((part) => part.text === 'word0000')).toBe(false);
    expect(parts.some((part) => part.text === 'word0039')).toBe(false);
  });
});

function namedWords(count) {
  return parseText(
    Array.from({ length: count }, (_, index) => `word${String(index).padStart(4, '0')}`).join(' '),
  );
}
