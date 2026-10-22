import { describe, expect, it } from 'vitest';
import { createGame, STATUS } from '../src/engine/game.js';
import { recallBounds, selectTarget } from '../src/engine/recall.js';
import { RECALL_BONUS } from '../src/engine/scoring.js';

function setup(text, config = {}) {
  const game = createGame();
  game.setConfig({
    wpm: 600,
    forgivenessMs: 0,
    freezeSec: 0,
    punctuationMultiplier: 1,
    roundSize: 0,
    advanceOnHit: true,
    ...config,
  });
  game.load(text, 'Fixture');
  game.consumeEvents();
  return game;
}

describe('game', () => {
  it('scores a correct key and moves on', () => {
    const game = setup('Alpha Beta');
    expect(game.start(0)).toBe(true);
    expect(game.press('a', 20)).toBe(true);
    expect(game.snapshot(20)).toMatchObject({
      status: STATUS.PLAYING,
      index: 1,
      score: 100,
      streak: 1,
      hits: 1,
      misses: 0,
    });
    expect(game.press('b', 80)).toBe(true);
    expect(game.status).toBe(STATUS.FINISHED);
    expect(game.snapshot().score).toBe(200);
  });

  it('accepts the folded key for an accented word', () => {
    const game = setup('Éclair');
    game.start(0);
    expect(game.press('é', 10)).toBe(true);
    expect(game.status).toBe(STATUS.FINISHED);
    expect(game.snapshot().score).toBe(100);
  });

  it('freezes on the wrong key, then continues', () => {
    const game = setup('Alpha Beta', { freezeSec: 1 });
    game.start(0);
    expect(game.press('z', 20)).toBe(true);
    expect(game.snapshot(20)).toMatchObject({
      status: STATUS.FROZEN,
      index: 0,
      streak: 0,
      misses: 1,
      score: 0,
      missReason: 'wrong',
      missedKey: 'Z',
    });
    expect(game.press('a', 30)).toBe(false);
    game.tick(1019);
    expect(game.status).toBe(STATUS.FROZEN);
    game.tick(1020);
    expect(game.snapshot(1020)).toMatchObject({
      status: STATUS.PLAYING,
      index: 1,
      misses: 1,
    });
  });

  it('holds a freeze while a modal is open', () => {
    const game = setup('Alpha Beta', { freezeSec: 1 });
    game.start(0);
    game.press('z', 10);
    expect(game.hold(400)).toBe(true);
    game.tick(2000);
    expect(game.status).toBe(STATUS.FROZEN);
    expect(game.snapshot(2000).index).toBe(0);
    expect(game.release(2000)).toBe(true);
    game.tick(2609);
    expect(game.status).toBe(STATUS.FROZEN);
    game.tick(2610);
    expect(game.snapshot(2610).index).toBe(1);
    expect(game.status).toBe(STATUS.PLAYING);
  });

  it('misses when the window ends, once', () => {
    const game = setup('Alpha Beta');
    game.start(0);
    game.tick(99);
    expect(game.status).toBe(STATUS.PLAYING);
    game.tick(100);
    expect(game.snapshot(100)).toMatchObject({
      status: STATUS.PLAYING,
      index: 1,
      misses: 1,
      missReason: null,
    });
  });

  it('does not miss a word the filter skips', () => {
    const game = setup('The cat sat', { filter: 'capital', freezeSec: 0 });
    game.start(0);
    game.tick(100);
    expect(game.snapshot(100)).toMatchObject({ index: 1, misses: 1, status: STATUS.PLAYING });
    expect(game.press('x', 150)).toBe(false);
    game.tick(200);
    expect(game.snapshot(200).misses).toBe(1);
    expect(game.snapshot(200).index).toBe(2);
    game.tick(300);
    expect(game.status).toBe(STATUS.FINISHED);
    expect(game.snapshot().misses).toBe(1);
  });

  it('waits out the word when advance-on-hit is off', () => {
    const game = setup('Alpha Beta', { advanceOnHit: false });
    game.start(0);
    game.press('a', 20);
    expect(game.snapshot(20)).toMatchObject({ index: 0, score: 100, status: STATUS.PLAYING });
    game.tick(99);
    expect(game.snapshot(99).index).toBe(0);
    game.tick(100);
    expect(game.snapshot(100)).toMatchObject({ index: 1, misses: 0, score: 100 });
  });

  it('gives the current word a fresh window after pause', () => {
    const game = setup('Alpha Beta');
    game.start(0);
    game.tick(90);
    expect(game.pause()).toBe(true);
    game.tick(5000);
    expect(game.snapshot(5000)).toMatchObject({ status: STATUS.PAUSED, index: 0, misses: 0 });
    game.resume(5000);
    game.tick(5090);
    expect(game.snapshot(5090)).toMatchObject({ status: STATUS.PLAYING, index: 0, misses: 0 });
    game.tick(5100);
    expect(game.snapshot(5100).misses).toBe(1);
  });

  it('moves the reticle only while paused', () => {
    const game = setup('Alpha Beta Gamma');
    game.start(0);
    expect(game.jumpTo(2)).toBe(false);
    game.pause();
    expect(game.jumpTo(2)).toBe(true);
    game.resume(100);
    expect(game.press('g', 130)).toBe(true);
    expect(game.status).toBe(STATUS.FINISHED);
    expect(game.snapshot().score).toBe(100);
  });

  it('ignores a second key tapped immediately after a hit', () => {
    const game = setup('Alpha Beta');
    game.start(0);
    game.press('a', 10);
    expect(game.press('b', 30)).toBe(false);
    expect(game.snapshot(30)).toMatchObject({ index: 1, score: 100, misses: 0 });
    expect(game.press('b', 45)).toBe(true);
    expect(game.status).toBe(STATUS.FINISHED);
  });

  it('keeps a longer window on punctuation', () => {
    const game = setup('Hi, Ho', { punctuationMultiplier: 2 });
    game.start(0);
    game.tick(199);
    expect(game.snapshot(199)).toMatchObject({ index: 0, misses: 0 });
    game.tick(200);
    expect(game.snapshot(200).misses).toBe(1);
  });

  it('breaks a round and then finishes the article', () => {
    const game = setup('Go Go Go Go Go', { roundSize: 2 });
    game.start(0);
    const press = (at) => expect(game.press('g', at)).toBe(true);

    press(40);
    press(80);
    expect(game.status).toBe(STATUS.BREAK);
    expect(game.snapshot().recall).toBeNull();
    expect(game.press('g', 120)).toBe(false);
    expect(game.continueRound(200)).toBe(true);
    expect(game.snapshot(200).index).toBe(2);

    press(240);
    press(280);
    expect(game.status).toBe(STATUS.BREAK);
    game.continueRound(300);
    press(340);
    expect(game.status).toBe(STATUS.FINISHED);
    expect(game.snapshot().recall).toBeNull();
    expect(game.snapshot().score).toBe(500);
    expect(game.snapshot().maxStreak).toBe(5);
    expect(game.start(400)).toBe(true);
  });

  it('plays a milestone on the tenth hit', () => {
    const game = setup('Go '.repeat(10).trim());
    game.start(0);
    let time = 0;
    for (let i = 0; i < 10; i += 1) {
      time += 40;
      game.press('g', time);
    }
    const snap = game.snapshot(time);
    expect(snap.score).toBe(1100);
    expect(snap.maxStreak).toBe(10);
    expect(game.status).toBe(STATUS.FINISHED);
    expect(game.consumeEvents().some((event) => event.type === 'milestone')).toBe(true);
  });

  it('does not restart a run that is already moving', () => {
    const game = setup('Alpha Beta');
    game.start(0);
    game.press('a', 20);
    expect(game.start(50)).toBe(false);
    expect(game.snapshot().score).toBe(100);
    expect(game.snapshot().index).toBe(1);
  });

  it('resets when a new article is loaded', () => {
    const game = setup('Alpha');
    game.start(0);
    game.press('a', 20);
    expect(game.status).toBe(STATUS.FINISHED);
    expect(game.load('Beta Gamma', 'Next')).toBe(2);
    expect(game.snapshot()).toMatchObject({
      status: STATUS.IDLE,
      score: 0,
      index: 0,
      articleLabel: 'Next',
    });
  });

  it('finishes immediately when the only word is missed and freeze is off', () => {
    const game = setup('Go');
    game.start(0);
    game.press('x', 10);
    expect(game.status).toBe(STATUS.FINISHED);
    expect(game.snapshot()).toMatchObject({ misses: 1, score: 0 });
  });

  it('holds the breath screen until the recall is answered', () => {
    const game = setup('alpha bravo charlie delta echo foxtrot golf hotel', { roundSize: 4 });
    game.start(0);
    let at = 0;
    for (const letter of ['a', 'b', 'c', 'd']) {
      at += 40;
      expect(game.press(letter, at)).toBe(true);
    }

    expect(game.status).toBe(STATUS.BREAK);
    expect(selectTarget(game.words, 0, 4).word.original).toBe('bravo');
    const snap = game.snapshot(at);
    expect(snap.recall.phase).toBe('ask');
    expect(snap.recall.sentence).toBeNull();
    expect(snap.recall.choices).toHaveLength(3);
    expect(snap.recall.choices[0]).toEqual({
      id: expect.any(Number),
      label: expect.any(String),
    });
    expect(game.answerRecall(99)).toBe(false);
    expect(game.acknowledgeRecall()).toBe(false);
    expect(game.snapshot().recall.phase).toBe('ask');
    expect(game.continueRound(at)).toBe(false);
    expect(game.start(at)).toBe(false);

    const wrong = snap.recall.choices.find((choice) => choice.label !== 'bravo');
    expect(['echo', 'foxtrot', 'golf', 'hotel']).toContain(wrong.label);
    expect(game.answerRecall(wrong.id)).toBe(true);
    expect(game.answerRecall(wrong.id)).toBe(false);
    const revealed = game.snapshot();
    expect(revealed).toMatchObject({ score: 400, streak: 4, misses: 0 });
    expect(revealed.recall.phase).toBe('reveal');
    expect(revealed.recall.sentence.some((part) => part.marked && part.text === 'bravo')).toBe(true);
    expect(revealed.recall.sentence.map((part) => part.text)).not.toContain('echo');
    expect(game.continueRound(at)).toBe(false);
    expect(game.acknowledgeRecall()).toBe(true);
    expect(game.continueRound(at + 50)).toBe(true);
    expect(game.status).toBe(STATUS.PLAYING);
    expect(game.snapshot().recall).toBeNull();
  });

  it('adds the recall bonus and leaves the streak alone', () => {
    const game = setup('alpha bravo charlie delta echo foxtrot golf hotel', { roundSize: 4 });
    game.start(0);
    let at = 0;
    for (const letter of ['a', 'b', 'c', 'd']) {
      at += 40;
      game.press(letter, at);
    }
    const choice = game.snapshot().recall.choices.find((item) => item.label === 'bravo');
    expect(game.answerRecall(choice.id)).toBe(true);
    expect(game.acknowledgeRecall()).toBe(false);
    expect(game.snapshot()).toMatchObject({
      score: 400 + RECALL_BONUS,
      streak: 4,
      hits: 4,
      misses: 0,
      accuracy: 100,
    });
    expect(game.snapshot().recall).toMatchObject({ phase: 'ready', correct: true, points: RECALL_BONUS });
    expect(game.continueRound(at + 50)).toBe(true);
  });

  it('asks about the last stretch when the article ends inside a round', () => {
    const text = 'alpha bravo charlie delta echo foxtrot golf hotel';
    const game = setup(text, { roundSize: 4 });
    game.start(0);
    let at = 0;
    const press = (letter) => {
      at += 40;
      expect(game.press(letter, at)).toBe(true);
    };

    for (const letter of ['a', 'b', 'c', 'd']) press(letter);
    const first = game.snapshot().recall.choices.find((choice) => choice.label === 'bravo');
    expect(game.answerRecall(first.id)).toBe(true);
    expect(game.continueRound(at + 20)).toBe(true);

    for (const letter of ['e', 'f', 'g', 'h']) press(letter);
    expect(game.status).toBe(STATUS.FINISHED);
    expect(selectTarget(game.words, 4, 8).word.original).toBe('foxtrot');
    expect(game.snapshot().recall.phase).toBe('ask');
    const labels = game.snapshot().recall.choices.map((choice) => choice.label);
    expect(labels).toContain('foxtrot');
    for (const label of labels) {
      if (label !== 'foxtrot') expect(['alpha', 'bravo', 'charlie', 'delta']).toContain(label);
    }
    expect(game.start(at)).toBe(false);

    const right = game.snapshot().recall.choices.find((choice) => choice.label === 'foxtrot');
    expect(game.answerRecall(right.id)).toBe(true);
    expect(game.snapshot()).toMatchObject({
      status: STATUS.FINISHED,
      score: 800 + RECALL_BONUS * 2,
      streak: 8,
      hits: 8,
      misses: 0,
      accuracy: 100,
    });
    expect(game.snapshot().recall).toMatchObject({ phase: 'ready', correct: true, points: RECALL_BONUS });
    expect(game.consumeEvents().some((event) => event.type === 'recall-hit' && event.points === RECALL_BONUS)).toBe(true);
    expect(game.start(at + 40)).toBe(true);
  });

  it('drops an open recall when a new article is loaded', () => {
    const game = setup('alpha bravo charlie delta echo foxtrot golf hotel', { roundSize: 4 });
    game.start(0);
    let at = 0;
    for (const letter of ['a', 'b', 'c', 'd']) {
      at += 40;
      game.press(letter, at);
    }
    expect(game.snapshot().recall.phase).toBe('ask');
    expect(game.load('Beta Gamma', 'Next')).toBe(2);
    expect(game.snapshot()).toMatchObject({
      status: STATUS.IDLE,
      score: 0,
      recall: null,
      articleLabel: 'Next',
    });
    expect(game.start(0)).toBe(true);
  });

  it('asks once at the end when rounds are off', () => {
    const game = setup('alpha bravo charlie delta echo foxtrot golf hotel');
    game.start(0);
    let at = 0;
    for (const letter of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']) {
      at += 40;
      expect(game.press(letter, at)).toBe(true);
    }

    expect(game.status).toBe(STATUS.FINISHED);
    const bounds = recallBounds(game.words, 0, game.words.length);
    expect(selectTarget(game.words, bounds.start, bounds.end).word.original).toBe('foxtrot');
    expect(game.snapshot().recall.phase).toBe('ask');
    expect(game.start(at)).toBe(false);

    const wrong = game.snapshot().recall.choices.find((choice) => choice.label !== 'foxtrot');
    expect(['alpha', 'bravo', 'charlie', 'delta']).toContain(wrong.label);
    expect(game.answerRecall(wrong.id)).toBe(true);
    expect(game.snapshot().score).toBe(800);
    expect(game.start(at)).toBe(false);
    expect(game.acknowledgeRecall()).toBe(true);
    expect(game.start(at + 50)).toBe(true);
    expect(game.snapshot()).toMatchObject({ status: STATUS.PLAYING, score: 0, recall: null });
  });

  it('passes over punctuation-only tokens', () => {
    const game = setup('... Next');
    game.start(0);
    game.tick(100);
    expect(game.snapshot(100)).toMatchObject({ index: 1, misses: 0, answer: 'N' });
  });
});
