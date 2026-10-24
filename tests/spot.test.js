import { describe, expect, it } from 'vitest';
import { parseText } from '../src/engine/parseText.js';
import {
  cueChars,
  hiddenWordLabel,
  pickCue,
  pickSpotIds,
  spotFace,
  spotLookMs,
} from '../src/engine/spot.js';

const LONG = 'Word Beta Golf Room Kind Note Jump Vivid Extra Lucky';

describe('spot check schedule', () => {
  it('picks one word in each group of five longer targets', () => {
    const words = parseText(LONG);
    expect(pickSpotIds(words, () => 0)).toEqual([0, 5]);
  });

  it('keeps an ordinary longer word between spot checks', () => {
    const words = parseText(LONG);
    const rolls = [0.99, 0];
    let index = 0;
    const ids = pickSpotIds(words, () => rolls[index++]);
    expect(ids).toEqual([4, 6]);
    expect(index).toBe(2);
  });

  it('leaves a short tail ordinary and still checks a short article', () => {
    expect(pickSpotIds(parseText('Word Beta Golf Room Kind Note Jump'), () => 0)).toEqual([0]);
    expect(pickSpotIds(parseText('Alpha'), () => 0)).toEqual([0]);
    expect(pickSpotIds(parseText('to be'), () => 0)).toEqual([]);
  });

  it('counts only longer words that need a key', () => {
    const mixed = parseText('Word to Beta Golf Room Kind Note Jump Vivid Extra Lucky');
    expect(pickSpotIds(mixed, () => 0)).toEqual([0, 6]);
    const capitals = parseText('alpha Alpha waits', 'capital');
    expect(pickSpotIds(capitals, () => 0)).toEqual([1]);
  });

  it('treats a bad roll as the first slot', () => {
    expect(pickSpotIds(parseText('Word Beta Golf Room Kind'), () => Number.NaN)).toEqual([0]);
  });
});

describe('spot check letters', () => {
  it('offers every letter and digit, and skips punctuation', () => {
    expect(cueChars('well-known,').map((item) => item.key).join('')).toBe('WELLKNOWN');
    expect(cueChars("it's 4th").map((item) => item.key).join('')).toBe('ITS4TH');
    const label = hiddenWordLabel('Word', 3);
    expect(label).toBe('Hidden word. Marked block 4 of 4.');
    expect(hiddenWordLabel('Word', 9)).toBe('Hidden word.');
  });

  it('picks any pressable character, including the last', () => {
    expect(pickCue('Word', () => 0)).toMatchObject({ index: 0, key: 'W' });
    expect(pickCue('Word', () => 0.8)).toMatchObject({ index: 3, key: 'D' });
    expect(pickCue('beta4', () => 0.99)).toMatchObject({ key: '4' });
    expect(pickCue('Éclair', () => 0)).toMatchObject({ index: 0, key: 'E' });
    expect(pickCue('---')).toBeNull();
    expect(pickCue('Word', () => Number.NaN).key).toBe('W');
  });

  it('draws a look, then blocks, then the owed letter', () => {
    expect(spotFace(null, 'playing')).toBe('first');
    expect(spotFace('look', 'playing')).toBe('plain');
    expect(spotFace('answer', 'playing')).toBe('blocks');
    expect(spotFace('answer', 'paused')).toBe('blocks');
    expect(spotFace('answer', 'frozen')).toBe('cue');
    expect(spotFace('reveal', 'playing')).toBe('cue');
  });
});

describe('spot check look', () => {
  const config = { spotLookMs: 350, punctuationMultiplier: 1.5, openingMultiplier: 2 };

  it('adds a little time for longer words and then stops', () => {
    expect(spotLookMs({ original: 'Word' }, config)).toBe(350);
    expect(spotLookMs({ original: 'Words' }, config)).toBe(380);
    expect(spotLookMs({ original: 'abcdefghijklmnopqrst' }, config)).toBe(650);
  });

  it('stretches for punctuation and the opening pause', () => {
    expect(spotLookMs({ original: 'Word', hasPunctuation: true }, config)).toBe(525);
    expect(spotLookMs({ original: 'Word', isOpening: true }, config)).toBe(700);
    expect(spotLookMs({ original: 'Word,', hasPunctuation: true, isOpening: true }, config)).toBe(1050);
    expect(spotLookMs({ original: 'Word' })).toBe(350);
  });
});
