import { describe, expect, it } from 'vitest';
import { parseText } from '../src/engine/parseText.js';
import {
  pickPhrases,
  RECITAL_FUSE_SCALE,
  RECITAL_PHRASE_WORDS,
  recitalFuseMs,
  recitalLookMs,
} from '../src/engine/recital.js';

function originals(text) {
  return parseText(text);
}

function groups(text) {
  const words = originals(text);
  return pickPhrases(words).map((span) => ({
    kind: span.kind,
    words: words.slice(span.start, span.end).map((word) => word.original),
  }));
}

describe('recital phrases', () => {
  it('keeps going until a pause, past the old six-word cut', () => {
    expect(groups(
      'Attention Deficit Hyperactivity Disorder is not a lack of attention, but a challenge.',
    )).toEqual([
      {
        kind: 'phrase',
        words: ['Attention', 'Deficit', 'Hyperactivity', 'Disorder', 'is', 'not', 'a', 'lack', 'of', 'attention,'],
      },
      { kind: 'phrase', words: ['but', 'a', 'challenge.'] },
    ]);
  });

  it('breaks a short clause at a comma, a colon, or a full stop', () => {
    expect(groups('Note this: the next idea starts.')).toEqual([
      { kind: 'phrase', words: ['Note', 'this:'] },
      { kind: 'phrase', words: ['the', 'next', 'idea', 'starts.'] },
    ]);
    expect(groups('one, two three four five six seven eight')).toEqual([
      { kind: 'phrase', words: ['one,'] },
      { kind: 'phrase', words: ['two', 'three', 'four', 'five', 'six', 'seven', 'eight'] },
    ]);
    expect(groups('Alpha Beta Golf Hotel India Juliet Kilo Lima')).toEqual([
      {
        kind: 'phrase',
        words: ['Alpha', 'Beta', 'Golf', 'Hotel', 'India', 'Juliet', 'Kilo', 'Lima'],
      },
    ]);
    expect(groups('Hi there.')).toEqual([{ kind: 'phrase', words: ['Hi', 'there.'] }]);
    expect(groups('Go.')).toEqual([{ kind: 'phrase', words: ['Go.'] }]);
  });

  it('breaks at the other marks that ask for a pause', () => {
    expect(groups('One? Two! Three; four… five.')).toEqual([
      { kind: 'phrase', words: ['One?'] },
      { kind: 'phrase', words: ['Two!'] },
      { kind: 'phrase', words: ['Three;'] },
      { kind: 'phrase', words: ['four…'] },
      { kind: 'phrase', words: ['five.'] },
    ]);
  });

  it('ends a long sentence on the finished piece nearest ten words', () => {
    expect(RECITAL_PHRASE_WORDS).toBe(10);
    const opening = [
      'Setting', 'up', 'a', 'Google', 'Cloud', 'project',
      'and', 'configuring', 'authentication',
    ];
    expect(groups(
      'Setting up a Google Cloud project and configuring authentication lets you call Google Cloud APIs from your applications.',
    )).toEqual([
      { kind: 'phrase', words: opening },
      {
        kind: 'phrase',
        words: [
          'lets', 'you', 'call', 'Google', 'Cloud', 'APIs',
          'from', 'your', 'applications.',
        ],
      },
    ]);
    expect(groups(
      'Setting up a Google Cloud project and configuring authentication lets you call Google Cloud APIs.',
    )).toEqual([
      { kind: 'phrase', words: opening },
      { kind: 'phrase', words: ['lets', 'you', 'call', 'Google', 'Cloud', 'APIs.'] },
    ]);
  });

  it('keeps a finished clause of twelve words or fewer in one phrase', () => {
    expect(groups('Setting up a Google Cloud project and configuring authentication.')).toEqual([
      {
        kind: 'phrase',
        words: [
          'Setting', 'up', 'a', 'Google', 'Cloud', 'project',
          'and', 'configuring', 'authentication.',
        ],
      },
    ]);
    expect(groups(
      'Setting up a Google Cloud project and configuring authentication for them now.',
    )).toEqual([
      {
        kind: 'phrase',
        words: [
          'Setting', 'up', 'a', 'Google', 'Cloud', 'project', 'and',
          'configuring', 'authentication', 'for', 'them', 'now.',
        ],
      },
    ]);
  });

  it('picks the shorter piece when two finished cuts are equally close', () => {
    expect(groups(
      'Setting up a Google Cloud project and configuring authentication for them right now.',
    )).toEqual([
      {
        kind: 'phrase',
        words: [
          'Setting', 'up', 'a', 'Google', 'Cloud', 'project',
          'and', 'configuring', 'authentication',
        ],
      },
      { kind: 'phrase', words: ['for', 'them', 'right', 'now.'] },
    ]);
  });

  it('ends a word past ten when that piece is the closer one', () => {
    expect(groups(
      'Setting up a Google Cloud project and then the whole team calls them from home now.',
    )).toEqual([
      {
        kind: 'phrase',
        words: [
          'Setting', 'up', 'a', 'Google', 'Cloud', 'project',
          'and', 'then', 'the', 'whole', 'team',
        ],
      },
      { kind: 'phrase', words: ['calls', 'them', 'from', 'home', 'now.'] },
    ]);
  });

  it('keeps a name intact when no piece inside it is finished', () => {
    expect(groups(
      'Alpha Beta Golf Hotel India Juliet Kilo Lima Mike November Oscar Papa Quebec',
    )).toEqual([
      {
        kind: 'phrase',
        words: [
          'Alpha', 'Beta', 'Golf', 'Hotel', 'India', 'Juliet', 'Kilo', 'Lima',
          'Mike', 'November', 'Oscar', 'Papa', 'Quebec',
        ],
      },
    ]);
  });

  it('keeps a modifier with the noun it describes', () => {
    expect(groups(
      'and rhythmic tactile responses transforms passive text consumption into an active gaming experience.',
    )).toEqual([
      {
        kind: 'phrase',
        words: [
          'and', 'rhythmic', 'tactile', 'responses', 'transforms',
          'passive', 'text', 'consumption',
        ],
      },
      { kind: 'phrase', words: ['into', 'an', 'active', 'gaming', 'experience.'] },
    ]);
    expect(groups(
      'such that measuring the quantum spin state of one instantly dictates the state of its paired partner.',
    )).toEqual([
      {
        kind: 'phrase',
        words: [
          'such', 'that', 'measuring', 'the', 'quantum', 'spin', 'state', 'of', 'one',
        ],
      },
      {
        kind: 'phrase',
        words: [
          'instantly', 'dictates', 'the', 'state', 'of', 'its', 'paired', 'partner.',
        ],
      },
    ]);
  });

  it('starts a new phrase on a blank line and keeps a wrapped line together', () => {
    expect(groups('Alpha Beta\nGolf Hotel India')).toEqual([
      { kind: 'phrase', words: ['Alpha', 'Beta', 'Golf', 'Hotel', 'India'] },
    ]);
    expect(groups('Alpha Beta\n\nGolf Hotel India')).toEqual([
      { kind: 'phrase', words: ['Alpha', 'Beta'] },
      { kind: 'phrase', words: ['Golf', 'Hotel', 'India'] },
    ]);
    expect(groups(
      'Setting up a Google Cloud project and configuring authentication lets you call Google Cloud APIs from your applications\n\nGolf Hotel',
    )).toEqual([
      {
        kind: 'phrase',
        words: [
          'Setting', 'up', 'a', 'Google', 'Cloud', 'project',
          'and', 'configuring', 'authentication',
        ],
      },
      {
        kind: 'phrase',
        words: [
          'lets', 'you', 'call', 'Google', 'Cloud', 'APIs',
          'from', 'your', 'applications',
        ],
      },
      { kind: 'phrase', words: ['Golf', 'Hotel'] },
    ]);
  });

  it('keeps a letterless beat between phrases', () => {
    expect(groups('Alpha  Beta Golf Hotel India')).toEqual([
      { kind: 'phrase', words: ['Alpha'] },
      { kind: 'pass', words: ['  '] },
      { kind: 'phrase', words: ['Beta', 'Golf', 'Hotel', 'India'] },
    ]);
  });

  it('gives the look twice the words and the riff twice a plain slot', () => {
    const words = originals('Alpha Beta Golf Hotel');
    const config = { wpm: 600, forgivenessMs: 0, punctuationMultiplier: 1, openingMultiplier: 1 };
    expect(recitalLookMs(words, config)).toBe(800);
    expect(recitalLookMs(words, { ...config, openingMultiplier: 2 }, true)).toBe(1000);
    const marked = originals('Alpha Beta Golf Hotel,');
    expect(recitalLookMs(marked, { ...config, punctuationMultiplier: 2 })).toBe(1000);
    expect(RECITAL_FUSE_SCALE).toBe(2);
    expect(recitalFuseMs({ wpm: 150, forgivenessMs: 280 })).toBe(800);
    expect(recitalFuseMs({ wpm: 150, forgivenessMs: 0 })).toBe(800);
    expect(recitalFuseMs({ wpm: 600 })).toBe(200);
  });
});
