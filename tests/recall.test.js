import { describe, expect, it } from 'vitest';
import { PRESETS } from '../src/data/presets.js';
import { parseText } from '../src/engine/parseText.js';
import {
  blankedSentence,
  buildRecall,
  recallBounds,
  selectTarget,
  sentenceAround,
  wordKey,
} from '../src/engine/recall.js';

const PAIRED = 'Bravo quietly rests. Delta gently stays.';

describe('recall', () => {
  it('blanks a content word and shows that sentence', () => {
    const words = parseText(PAIRED);
    const recall = buildRecall(words, 0, words.length, () => 0);
    expect(selectTarget(words, 0, words.length, () => 0).word.original).toBe('quietly');
    expect(recall.choices.find((choice) => choice.correct).label).toBe('quietly');
    expect(recall.choices.map((choice) => choice.label).sort()).toEqual([
      'gently',
      'quietly',
      'stays',
    ]);
    expect(recall.sentence.map((part) => part.text)).toEqual(['Bravo', 'quietly', 'rests.']);
    expect(recall.sentence.filter((part) => part.marked).map((part) => part.text)).toEqual(['quietly']);
  });

  it('varies the blank among close content words', () => {
    const words = parseText('Alpha quietly rests. Bravo gently stays.');
    expect(selectTarget(words, 0, words.length, () => 0).word.original).toBe('quietly');
    expect(selectTarget(words, 0, words.length, () => 0.99).word.original).toBe('gently');
  });

  it('draws decoys from other sentences already read', () => {
    const words = parseText(`${PAIRED} Future words appear afterward.`);
    const recall = buildRecall(words, 0, 6, () => 0);
    const labels = recall.choices.map((choice) => choice.label.toLocaleLowerCase());
    expect(labels).toContain('gently');
    expect(labels).not.toContain('future');
    expect(labels).not.toContain('appear');
    expect(labels).not.toContain('afterward');
  });

  it('skips a stretch that cannot make a fair question', () => {
    const words = parseText('People traveled across before. Horses moved through after.');
    expect(buildRecall(words, 0, 4, () => 0)).toBeNull();
    expect(buildRecall(parseText('Go go go go.'), 0, 4, () => 0)).toBeNull();
  });

  it('skips function words when it builds the question', () => {
    const words = parseText('People traveled across before. Horses moved through after.');
    const recall = buildRecall(words, 0, words.length, () => 0);
    expect(recall.choices.find((choice) => choice.correct).label).toBe('Horses');
    expect(recall.choices.map((choice) => choice.label)).not.toContain('across');
    expect(recall.choices.map((choice) => choice.label)).not.toContain('before');
    expect(recall.choices.map((choice) => choice.label)).not.toContain('through');
    expect(recall.sentence.map((part) => (part.marked ? `[${part.text}]` : part.text)).join(' ')).toBe(
      '[Horses] moved through after.',
    );
  });

  it('does not lowercase a sentence-initial word into a mid-sentence decoy', () => {
    const words = parseText(PRESETS.find((preset) => preset.id === 'stoic').text);
    const recall = buildRecall(words, 0, 40, () => 0);
    expect(recall.choices.find((choice) => choice.correct).label).toBe('obstacle');
    expect(recall.choices.map((choice) => choice.label)).not.toContain('realize');
    expect(recall.choices.map((choice) => choice.label).sort()).toEqual([
      'obstacle',
      'outside',
      'strength',
    ]);
  });

  it('keeps a name in sentence case and capitalizes the other sentence-initial answers', () => {
    const words = parseText('Captain Vance met Admiral Nemo. Major Keel watched silent ships.');
    const recall = buildRecall(words, 0, words.length, () => 0);
    expect(recall.choices.find((choice) => choice.correct).label).toBe('Captain');
    expect(recall.choices.map((choice) => choice.label).sort()).toEqual([
      'Captain',
      'Major',
      'Silent',
    ]);
    expect(recall.sentence.map((part) => part.text)).toEqual([
      'Captain',
      'Vance',
      'met',
      'Admiral',
      'Nemo.',
    ]);
  });

  it('keeps quotes and parentheses beside the blank', () => {
    const words = parseText('Bravo (quietly) rests. Delta gently stays.');
    const recall = buildRecall(words, 0, words.length, () => 0);
    expect(recall.choices.find((choice) => choice.correct).label).toBe('quietly');
    expect(blankedSentence(recall.sentence).find((part) => part.blank)).toEqual({
      text: '_____',
      marked: true,
      blank: true,
      lead: '(',
      trail: ')',
    });
  });

  it('does not blank a word that repeats inside its sentence', () => {
    const repeated = parseText(
      'Boats drifted gently and boats drifted gently. Horses moved quickly and horses moved quickly.',
    );
    expect(buildRecall(repeated, 0, repeated.length, () => 0)).toBeNull();

    const words = parseText(
      'Harbor lights faded quietly and harbor lights returned. Boats drifted gently onward.',
    );
    const recall = buildRecall(words, 0, words.length, () => 0);
    expect(recall.choices.find((choice) => choice.correct).label).toBe('returned');
    expect(recall.choices.map((choice) => choice.label)).not.toContain('lights');
    expect(recall.choices.map((choice) => choice.label)).not.toContain('harbor');
    const lights = recall.sentence.filter((part) => wordKey({ original: part.text }) === 'lights');
    expect(lights).toHaveLength(2);
    expect(lights.every((part) => !part.marked)).toBe(true);
    expect(blankedSentence(recall.sentence).find((part) => part.blank)).toMatchObject({
      lead: '',
      trail: '.',
    });
  });

  it('does not blank a sentence the stretch has not finished', () => {
    const words = parseText('Bravo quietly rests. Delta gently stays nearby today.');
    const recall = buildRecall(words, 0, 6, () => 0);
    expect(recall.choices.find((choice) => choice.correct).label).toBe('quietly');
    expect(recall.sentence.map((part) => part.text)).toEqual(['Bravo', 'quietly', 'rests.']);
    expect(recall.choices.map((choice) => choice.label)).not.toContain('nearby');
    expect(recall.choices.map((choice) => choice.label)).not.toContain('today');
  });

  it('blanks a finished sentence that started before this stretch', () => {
    const words = parseText('Delta began before quietly. Alpha gently stays.');
    const recall = buildRecall(words, 3, words.length, () => 0);
    expect(recall.choices.find((choice) => choice.correct).label).toBe('quietly');
    expect(recall.sentence.map((part) => part.text)).toEqual([
      'Delta',
      'began',
      'before',
      'quietly.',
    ]);
  });

  it('closes a sentence at a paragraph break', () => {
    const words = parseText('Bravo quietly rests\n\nDelta gently stays.');
    const recall = buildRecall(words, 0, words.length, () => 0);
    expect(recall.choices.find((choice) => choice.correct).label).toBe('quietly');
    expect(recall.sentence.map((part) => part.text)).toEqual(['Bravo', 'quietly', 'rests']);
  });

  it('does not offer a name as a decoy for a common word', () => {
    const words = parseText('Bravo quietly rests beside Vance. Delta gently stays.');
    const recall = buildRecall(words, 0, words.length, () => 0);
    expect(recall.choices.find((choice) => choice.correct).label).toBe('quietly');
    expect(recall.choices.map((choice) => choice.label).sort()).toEqual([
      'gently',
      'quietly',
      'stays',
    ]);
  });

  it('strips punctuation from the buttons and keeps it beside the blank', () => {
    const words = parseText(PAIRED);
    const recall = buildRecall(words, 0, words.length, () => 0);
    for (const choice of recall.choices) {
      expect(choice.label).not.toMatch(/[.,;:!?]/);
    }
    expect(blankedSentence([
      { text: 'classical', marked: false },
      { text: 'supercomputers.', marked: true },
    ])).toEqual([
      { text: 'classical', marked: false },
      { text: '_____', marked: true, blank: true, lead: '', trail: '.' },
    ]);
  });

  it('shrinks a whole article so the question stays near the end', () => {
    const words = parseText(PAIRED);
    expect(recallBounds(words, 0, words.length)).toEqual({ start: 3, end: 6 });
    expect(recallBounds(words, 0, 4)).toEqual({ start: 0, end: 4 });
    expect(selectTarget(words, 3, 6, () => 0).word.original).toBe('gently');
  });

  it('keeps a whole-article question inside the last forty words', () => {
    const words = namedWords(100);
    expect(recallBounds(words, 0, words.length)).toEqual({ start: 60, end: 100 });
  });

  it('stops the shown sentence at the words already read', () => {
    const words = parseText('alpha bravo charlie delta echo foxtrot golf hotel');
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

  it('builds a fair cloze for every built-in article', () => {
    for (const preset of PRESETS) {
      const words = parseText(preset.text);
      let start = 0;
      let asked = 0;
      while (start < words.length) {
        const end = Math.min(words.length, start + 40);
        const bounds = recallBounds(words, start, end);
        const recall = buildRecall(words, bounds.start, bounds.end, () => 0);
        if (recall) {
          asked += 1;
          expectFair(recall, words, bounds);
        }
        if (end === words.length) break;
        start = end;
      }
      expect(asked).toBeGreaterThan(0);
    }
  });
});

function expectFair(recall, words, bounds) {
  const labels = recall.choices.map((choice) => choice.label);
  expect(new Set(labels).size).toBe(3);
  const correct = recall.choices.find((choice) => choice.correct).label;
  const correctKey = wordKey({ original: correct });
  expect(correctKey.length).toBeGreaterThanOrEqual(5);
  for (const label of labels) {
    expect(label).not.toMatch(/[.,;:!?]/);
  }

  const marked = recall.sentence.filter((part) => part.marked);
  expect(marked).toHaveLength(1);
  expect(wordKey({ original: marked[0].text })).toBe(correctKey);
  expect(
    recall.sentence.filter((part) => wordKey({ original: part.text }) === correctKey),
  ).toHaveLength(1);
  expect(
    words.slice(bounds.start, bounds.end).some((word) => wordKey(word) === correctKey),
  ).toBe(true);

  const shown = new Set(
    recall.sentence
      .filter((part) => !part.marked)
      .map((part) => wordKey({ original: part.text }))
      .filter(Boolean),
  );
  for (const label of labels) {
    if (label === correct) continue;
    const key = wordKey({ original: label });
    expect(shown.has(key)).toBe(false);
    expect(words.slice(0, bounds.end).some((word) => wordKey(word) === key)).toBe(true);
  }
}

function namedWords(count) {
  return parseText(
    Array.from({ length: count }, (_, index) => `word${String(index).padStart(4, '0')}`).join(' '),
  );
}
