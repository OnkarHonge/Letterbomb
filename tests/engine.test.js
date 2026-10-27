import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, sanitizeConfig } from '../src/engine/config.js';
import {
  LONG_WORD_LETTERS,
  PUNCTUATION_MARKS,
  VOWELS,
  applyFilter,
  countWords,
  parseText,
  wordKey,
} from '../src/engine/parseText.js';
import { pointsForHit } from '../src/engine/scoring.js';
import { wordDeadlineMs } from '../src/engine/timing.js';

describe('parseText', () => {
  it('returns no words for empty input', () => {
    expect(parseText('')).toEqual([]);
    expect(parseText('   \n  ')).toEqual([]);
    expect(countWords('')).toBe(0);
  });

  it('skips quotes and keeps the first letter', () => {
    const [word] = parseText('"(Hello)"');
    expect(word.before).toBe('"(');
    expect(word.displayChar).toBe('H');
    expect(word.after).toBe('ello)"');
    expect(word.targetChar).toBe('H');
    expect(word.hasPunctuation).toBe(false);
    expect(word.isTarget).toBe(true);
  });

  it('folds accented letters onto a keyboard key', () => {
    const [word] = parseText('Éclair');
    expect(word.displayChar).toBe('É');
    expect(word.targetChar).toBe('E');
    expect(word.isCapital).toBe(true);
    expect(word.isVowel).toBe(true);
    expect(wordKey(word)).toBe('éclair');
    expect(wordKey({ original: "don't" })).toBe('dont');
  });

  it('uses one punctuation set and one length for a long word', () => {
    expect(PUNCTUATION_MARKS).toBe('.!?,;:…');
    expect(VOWELS).toBe('AEIOU');
    for (const mark of PUNCTUATION_MARKS) {
      expect(parseText(`word${mark}`)[0].hasPunctuation).toBe(true);
    }
    expect(parseText('word')[0].hasPunctuation).toBe(false);
    expect(parseText('a'.repeat(LONG_WORD_LETTERS))[0].isLong).toBe(true);
    expect(parseText('a'.repeat(LONG_WORD_LETTERS - 1))[0].isLong).toBe(false);
    for (const letter of VOWELS) {
      expect(parseText(letter.toLowerCase())[0].isVowel).toBe(true);
    }
    expect(parseText('y')[0].isVowel).toBe(false);
  });

  it('marks punctuation and word shape', () => {
    const [end, iphone, nasa] = parseText('end. iPhone NASA');
    expect(end.targetChar).toBe('E');
    expect(end.hasPunctuation).toBe(true);
    expect(end.isCapital).toBe(false);
    expect(iphone.isCapital).toBe(false);
    expect(iphone.isLong).toBe(true);
    expect(nasa.isCapital).toBe(true);
    expect(nasa.isLong).toBe(true);
  });

  it('joins wrapped lines and keeps blank lines as paragraphs', () => {
    const words = parseText('Hello world.\n\nNext line\nstill same');
    expect(words.map((word) => word.original)).toEqual([
      'Hello',
      'world.',
      'Next',
      'line',
      'still',
      'same',
    ]);
    expect(words[2].breakBefore).toBe(true);
    expect(words[3].breakBefore).toBe(false);
    expect(words[1].hasPunctuation).toBe(true);
  });

  it('treats a token with no letter as a gap', () => {
    const [marks, word] = parseText('... Hello');
    expect(marks.targetChar).toBeNull();
    expect(marks.isTarget).toBe(false);
    expect(marks.isGap).toBe(true);
    expect(word.targetChar).toBe('H');
    expect(word.isGap).toBe(false);
  });

  it('keeps a dash and a double space as short gaps', () => {
    const words = parseText('Go —  on\nstill');
    expect(words.map((word) => word.original)).toEqual(['Go', '—', '  ', 'on', 'still']);
    expect(words.map((word) => word.isGap)).toEqual([false, true, true, false, false]);
    expect(words[1].isTarget).toBe(false);
    expect(words[1].hasPunctuation).toBe(false);
    expect(parseText('Go on').map((word) => word.original)).toEqual(['Go', 'on']);
    expect(parseText('A   B').map((word) => word.original)).toEqual(['A', '  ', 'B']);
    expect(parseText('A\t\tB').map((word) => word.original)).toEqual(['A', '  ', 'B']);
    expect(parseText('Go  \n\nNext').map((word) => word.original)).toEqual(['Go', 'Next']);
    expect(parseText('Wait.')[0].isGap).toBe(false);
    expect(parseText('—')[0].isGap).toBe(true);

    const retagged = applyFilter(parseText('Go —  on'), 'capital');
    expect(retagged.map((word) => word.isGap)).toEqual([false, true, true, false]);
    expect(retagged.map((word) => word.isTarget)).toEqual([true, false, false, false]);
  });

  it('applies challenge filters', () => {
    const words = parseText('A cat ate NASA', 'vowel');
    expect(words.map((word) => word.isTarget)).toEqual([true, false, true, false]);

    const retagged = applyFilter(parseText('A cat ate NASA'), 'capital');
    expect(retagged.map((word) => word.isTarget)).toEqual([true, false, false, true]);

    const long = parseText('A cat ate something', 'long');
    expect(long.map((word) => word.isTarget)).toEqual([false, false, false, true]);
  });
});

describe('timing', () => {
  const pace = { wpm: 600, forgivenessMs: 50, punctuationMultiplier: 2 };

  it('converts wpm to a dwell, then adds forgiveness for targets', () => {
    expect(wordDeadlineMs({ hasPunctuation: false, isTarget: false }, pace)).toBe(100);
    expect(wordDeadlineMs({ hasPunctuation: false, isTarget: true }, pace)).toBe(150);
    expect(wordDeadlineMs({ hasPunctuation: true, isTarget: true }, pace)).toBe(250);
  });

  it('multiplies an opening word before forgiveness, then stacks punctuation', () => {
    const pace = { wpm: 600, forgivenessMs: 50, punctuationMultiplier: 2, openingMultiplier: 3 };
    expect(wordDeadlineMs({ isTarget: true, isOpening: true }, pace)).toBe(350);
    expect(wordDeadlineMs({ isTarget: true, hasPunctuation: true, isOpening: true }, pace)).toBe(650);
    expect(wordDeadlineMs({ isTarget: false, isOpening: true }, pace)).toBe(300);
  });

  it('gives a gap a third of the plain slot', () => {
    const pace = { wpm: 600, forgivenessMs: 50, punctuationMultiplier: 2, openingMultiplier: 3 };
    expect(wordDeadlineMs({ isGap: true }, pace)).toBe(33);
    expect(wordDeadlineMs({
      isGap: true,
      hasPunctuation: true,
      isOpening: true,
      isTarget: true,
    }, pace)).toBe(33);
    expect(wordDeadlineMs({ isGap: true }, { wpm: 150, forgivenessMs: 280 })).toBe(133);
    expect(wordDeadlineMs({ isTarget: true }, { wpm: 150, forgivenessMs: 280 })).toBe(680);
  });
});

describe('scoring', () => {
  it('raises the multiplier every ten hits', () => {
    expect(pointsForHit(1)).toBe(100);
    expect(pointsForHit(10)).toBe(200);
    expect(pointsForHit(11)).toBe(200);
    expect(pointsForHit(20)).toBe(300);
  });
});

describe('sanitizeConfig', () => {
  it('keeps defaults and clamps bad values', () => {
    expect(sanitizeConfig(null).wpm).toBe(DEFAULT_CONFIG.wpm);
    expect(sanitizeConfig({ wpm: 1, theme: 'cyberpunk', sound: 'false' })).toMatchObject({
      wpm: 10,
      theme: 'signal',
      sound: true,
    });
    expect(sanitizeConfig({ wpm: 9000, roundSize: 0, fontScale: 2 }).wpm).toBe(800);
    expect(sanitizeConfig({ roundSize: 0 }).roundSize).toBe(0);
    expect(sanitizeConfig({ viewMode: 'nope' }).viewMode).toBe('karaoke');
    expect(sanitizeConfig({ openingMultiplier: 9 }).openingMultiplier).toBe(3);
    expect(sanitizeConfig({ openingMultiplier: 0 }).openingMultiplier).toBe(1);
    expect(sanitizeConfig({ wpm: 150 }).openingMultiplier).toBe(DEFAULT_CONFIG.openingMultiplier);
    expect(sanitizeConfig({ spotLookMs: 10 }).spotLookMs).toBe(200);
    expect(sanitizeConfig({ spotLookMs: 5000 }).spotLookMs).toBe(800);
    expect(sanitizeConfig({ spotCheck: 'yes' }).spotCheck).toBe(false);
    expect(sanitizeConfig({}).spotCheck).toBe(false);
  });
});
