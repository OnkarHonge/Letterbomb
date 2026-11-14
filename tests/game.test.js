import { describe, expect, it } from 'vitest';
import { PACE_PRESETS, pacePatch } from '../src/engine/config.js';
import { createGame, STATUS } from '../src/engine/game.js';
import { recallBounds, selectTarget } from '../src/engine/recall.js';
import { RECALL_BONUS } from '../src/engine/scoring.js';
import { SPOT_REVEAL_MS } from '../src/engine/spot.js';
import { recitalFuseMs, recitalLookMs } from '../src/engine/recital.js';
import { wordDeadlineMs } from '../src/engine/timing.js';

const CLOZE = 'Bravo quietly rests. Delta gently stays. Foxtrot softly leaves. Hotel calmly waits.';

function pressLetters(game, letters, at = 0) {
  for (const letter of letters) {
    at += 40;
    expect(game.press(letter, at)).toBe(true);
  }
  return at;
}

function setup(text, config = {}, random = () => 0) {
  const game = createGame({ random });
  game.setConfig({
    wpm: 600,
    forgivenessMs: 0,
    freezeSec: 0,
    punctuationMultiplier: 1,
    openingMultiplier: 1,
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
    expect(game.snapshot(20)).toMatchObject({
      index: 0,
      score: 100,
      status: STATUS.PLAYING,
      responded: true,
    });
    game.tick(99);
    expect(game.snapshot(99).index).toBe(0);
    game.tick(100);
    expect(game.snapshot(100)).toMatchObject({ index: 1, misses: 0, score: 100 });
  });

  it('moves on after a pause when the letter was already right', () => {
    const game = setup('Alpha Beta', { advanceOnHit: false, roundSize: 0 });
    game.start(0);
    game.press('a', 20);
    game.pause();
    expect(game.snapshot(30).responded).toBe(true);
    game.resume(40);
    expect(game.snapshot(40)).toMatchObject({ status: STATUS.PLAYING, index: 1 });
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
    const game = setup('Go Go. Go Go. Go', { roundSize: 2 });
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

  it('waits for the next full stop after the round length', () => {
    const game = setup('One two three four. Five', { roundSize: 2 });
    game.start(0);
    expect(game.press('o', 40)).toBe(true);
    expect(game.press('t', 80)).toBe(true);
    expect(game.status).toBe(STATUS.PLAYING);
    expect(game.snapshot().index).toBe(2);
    expect(game.press('t', 120)).toBe(true);
    expect(game.status).toBe(STATUS.PLAYING);
    expect(game.press('f', 160)).toBe(true);
    expect(game.status).toBe(STATUS.BREAK);
    expect(game.snapshot()).toMatchObject({ index: 4, recall: null });
  });

  it('breaks on the full stop that completes the round length', () => {
    const game = setup('One two. Three', { roundSize: 2 });
    game.start(0);
    expect(game.press('o', 40)).toBe(true);
    expect(game.status).toBe(STATUS.PLAYING);
    expect(game.press('t', 80)).toBe(true);
    expect(game.status).toBe(STATUS.BREAK);
    expect(game.snapshot().index).toBe(2);
  });

  it('breaks on a question mark or an exclamation mark after the round length', () => {
    const asked = setup('One two? Three', { roundSize: 2 });
    asked.start(0);
    expect(asked.press('o', 40)).toBe(true);
    expect(asked.status).toBe(STATUS.PLAYING);
    expect(asked.press('t', 80)).toBe(true);
    expect(asked.status).toBe(STATUS.BREAK);
    expect(asked.snapshot().index).toBe(2);

    const shouted = setup('One two! Three', { roundSize: 2 });
    shouted.start(0);
    expect(shouted.press('o', 40)).toBe(true);
    expect(shouted.status).toBe(STATUS.PLAYING);
    expect(shouted.press('t', 80)).toBe(true);
    expect(shouted.status).toBe(STATUS.BREAK);
    expect(shouted.snapshot().index).toBe(2);
  });

  it('does not treat a comma as the breath', () => {
    const game = setup('One two, three. Four', { roundSize: 2 });
    game.start(0);
    const at = pressLetters(game, ['o', 't']);
    expect(game.status).toBe(STATUS.PLAYING);
    expect(game.snapshot().index).toBe(2);
    expect(game.press('t', at + 40)).toBe(true);
    expect(game.status).toBe(STATUS.BREAK);
    expect(game.snapshot().index).toBe(3);
  });

  it('does not break on a full stop that arrives before the round length', () => {
    const game = setup('One. Two three four. Five', { roundSize: 3 });
    game.start(0);
    const at = pressLetters(game, ['o', 't', 't']);
    expect(game.status).toBe(STATUS.PLAYING);
    expect(game.snapshot().index).toBe(3);
    expect(game.press('f', at + 40)).toBe(true);
    expect(game.status).toBe(STATUS.BREAK);
    expect(game.snapshot().index).toBe(4);
  });

  it('reads to the end when no full stop arrives after the round length', () => {
    const game = setup('One two three', { roundSize: 1 });
    game.start(0);
    pressLetters(game, ['o', 't', 't']);
    expect(game.status).toBe(STATUS.FINISHED);
    expect(game.consumeEvents().some((event) => event.type === 'break')).toBe(false);
  });

  it('uses the round length the slider has at the moment of the full stop', () => {
    const game = setup('One two three four. Five', { roundSize: 80 });
    game.start(0);
    pressLetters(game, ['o', 't', 't']);
    expect(game.status).toBe(STATUS.PLAYING);
    game.setConfig({ roundSize: 2 });
    expect(game.press('f', 200)).toBe(true);
    expect(game.status).toBe(STATUS.BREAK);
    expect(game.snapshot().index).toBe(4);
  });

  it('keeps the streak climbing through ten hits when no sentence ends', () => {
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
    const events = game.consumeEvents();
    expect(events.some((event) => event.type === 'milestone')).toBe(false);
    const hits = events.filter((event) => event.type === 'hit');
    expect(hits).toHaveLength(10);
    expect(hits[9]).toMatchObject({ ascent: 10, streak: 10, sentenceEnd: false });
  });

  it.each(['.', '!', '?'])('chords on a word ending in %s and starts the next ascent at one', (mark) => {
    const game = setup(`One${mark} Two`);
    game.start(0);
    game.consumeEvents();
    game.press('o', 40);
    const ended = game.consumeEvents();
    const endHit = ended.findIndex((event) => event.type === 'hit');
    expect(ended[endHit]).toMatchObject({ ascent: 1, streak: 1, sentenceEnd: true });
    expect(ended[endHit + 1]).toMatchObject({ type: 'milestone', ascent: 1 });
    game.press('t', 80);
    const next = game.consumeEvents();
    expect(next.some((event) => event.type === 'milestone')).toBe(false);
    expect(next.find((event) => event.type === 'hit')).toMatchObject({
      ascent: 1,
      streak: 2,
      sentenceEnd: false,
    });
    expect(game.snapshot().streak).toBe(2);
    expect(game.snapshot().score).toBe(200);
  });

  it('keeps the streak and drops only the ascent after a sentence', () => {
    const game = setup('One. Two three');
    game.start(0);
    game.consumeEvents();
    game.press('o', 40);
    game.press('t', 80);
    game.press('t', 120);
    const hits = game.consumeEvents().filter((event) => event.type === 'hit');
    expect(hits.map((event) => event.ascent)).toEqual([1, 1, 2]);
    expect(hits.map((event) => event.streak)).toEqual([1, 2, 3]);
    expect(hits.map((event) => event.sentenceEnd)).toEqual([true, false, false]);
    expect(game.snapshot().score).toBe(300);
  });

  it('does not chord on a comma', () => {
    const game = setup('Go, now');
    game.start(0);
    game.consumeEvents();
    pressLetters(game, ['g', 'n']);
    const events = game.consumeEvents();
    expect(events.some((event) => event.type === 'milestone')).toBe(false);
    expect(events.filter((event) => event.type === 'hit').map((event) => event.ascent)).toEqual([1, 2]);
  });

  it('drops the ascent on a miss without a milestone', () => {
    const game = setup('One two. Three');
    game.start(0);
    game.consumeEvents();
    game.press('o', 40);
    expect(game.press('x', 80)).toBe(true);
    const missed = game.consumeEvents();
    expect(missed.some((event) => event.type === 'milestone')).toBe(false);
    expect(missed.find((event) => event.type === 'miss')).toMatchObject({
      reason: 'wrong',
      answer: 'T',
      pressed: 'X',
    });
    game.press('t', 120);
    expect(game.consumeEvents().find((event) => event.type === 'hit')).toMatchObject({
      ascent: 1,
      streak: 1,
      sentenceEnd: false,
    });
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
    const game = setup(CLOZE, { roundSize: 6 });
    game.start(0);
    const at = pressLetters(game, ['b', 'q', 'r', 'd', 'g', 's']);

    expect(game.status).toBe(STATUS.BREAK);
    expect(selectTarget(game.words, 0, 6, () => 0).word.original).toBe('quietly');
    const snap = game.snapshot(at);
    expect(snap.recall.phase).toBe('ask');
    expect(snap.recall.choices).toHaveLength(3);
    expect(snap.recall.sentence.map((part) => part.text)).toEqual(['Bravo', '_____', 'rests.']);
    expect(snap.recall.sentence.some((part) => part.blank)).toBe(true);
    expect(snap.recall.sentence.some((part) => part.text === 'quietly')).toBe(false);
    expect(game.answerRecall(99)).toBe(false);
    expect(game.acknowledgeRecall()).toBe(false);
    expect(game.snapshot().recall.phase).toBe('ask');
    expect(game.continueRound(at)).toBe(false);
    expect(game.start(at)).toBe(false);

    const wrong = snap.recall.choices.find((choice) => choice.label !== 'quietly');
    expect(['gently', 'stays']).toContain(wrong.label);
    expect(game.answerRecall(wrong.id)).toBe(true);
    expect(game.answerRecall(wrong.id)).toBe(false);
    const revealed = game.snapshot();
    expect(revealed).toMatchObject({ score: 600, streak: 6, misses: 0 });
    expect(revealed.recall.phase).toBe('reveal');
    expect(revealed.recall.sentence.some((part) => part.marked && part.text === 'quietly')).toBe(true);
    expect(revealed.recall.sentence.map((part) => part.text)).not.toContain('Foxtrot');
    expect(game.continueRound(at)).toBe(false);
    expect(game.acknowledgeRecall()).toBe(true);
    expect(game.continueRound(at + 50)).toBe(true);
    expect(game.status).toBe(STATUS.PLAYING);
    expect(game.snapshot().recall).toBeNull();
  });

  it('adds the recall bonus and leaves the streak alone', () => {
    const game = setup(CLOZE, { roundSize: 6 });
    game.start(0);
    const at = pressLetters(game, ['b', 'q', 'r', 'd', 'g', 's']);
    const choice = game.snapshot().recall.choices.find((item) => item.label === 'quietly');
    expect(game.answerRecall(choice.id)).toBe(true);
    expect(game.acknowledgeRecall()).toBe(false);
    expect(game.snapshot()).toMatchObject({
      score: 600 + RECALL_BONUS,
      streak: 6,
      hits: 6,
      misses: 0,
      accuracy: 100,
    });
    expect(game.snapshot().recall).toMatchObject({ phase: 'ready', correct: true, points: RECALL_BONUS });
    expect(game.continueRound(at + 50)).toBe(true);
  });

  it('asks about the last stretch when the article ends inside a round', () => {
    const game = setup(CLOZE, { roundSize: 6 });
    game.start(0);
    let at = pressLetters(game, ['b', 'q', 'r', 'd', 'g', 's']);
    const first = game.snapshot().recall.choices.find((choice) => choice.label === 'quietly');
    expect(game.answerRecall(first.id)).toBe(true);
    expect(game.continueRound(at + 20)).toBe(true);

    at = pressLetters(game, ['f', 's', 'l', 'h', 'c', 'w'], at);
    expect(game.status).toBe(STATUS.FINISHED);
    expect(selectTarget(game.words, 6, 12, () => 0).word.original).toBe('Foxtrot');
    expect(game.snapshot().recall.phase).toBe('ask');
    const labels = game.snapshot().recall.choices.map((choice) => choice.label);
    expect(labels).toContain('Foxtrot');
    for (const label of labels) {
      if (label !== 'Foxtrot') expect(['Delta', 'Stays']).toContain(label);
    }
    expect(game.snapshot().recall.sentence.some((part) => part.blank && part.text === '_____')).toBe(true);
    expect(game.start(at)).toBe(false);

    const right = game.snapshot().recall.choices.find((choice) => choice.label === 'Foxtrot');
    expect(game.answerRecall(right.id)).toBe(true);
    expect(game.snapshot()).toMatchObject({
      status: STATUS.FINISHED,
      score: 1500 + RECALL_BONUS * 2,
      streak: 12,
      hits: 12,
      misses: 0,
      accuracy: 100,
    });
    expect(game.snapshot().recall).toMatchObject({ phase: 'ready', correct: true, points: RECALL_BONUS });
    expect(game.consumeEvents().some((event) => event.type === 'recall-hit' && event.points === RECALL_BONUS)).toBe(true);
    expect(game.start(at + 40)).toBe(true);
  });

  it('skips the question at the end when that choice is off', () => {
    const finished = setup('Bravo quietly rests. Delta gently stays.', { endQuestion: false });
    finished.start(0);
    pressLetters(finished, ['b', 'q', 'r', 'd', 'g', 's']);
    expect(finished.status).toBe(STATUS.FINISHED);
    expect(finished.snapshot().recall).toBeNull();
    expect(finished.start(400)).toBe(true);

    const breathing = setup(CLOZE, { roundSize: 6, endQuestion: false });
    breathing.start(0);
    pressLetters(breathing, ['b', 'q', 'r', 'd', 'g', 's']);
    expect(breathing.status).toBe(STATUS.BREAK);
    expect(breathing.snapshot().recall.phase).toBe('ask');
  });

  it('drops an open recall when a new article is loaded', () => {
    const game = setup(CLOZE, { roundSize: 6 });
    game.start(0);
    pressLetters(game, ['b', 'q', 'r', 'd', 'g', 's']);
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
    const game = setup('Bravo quietly rests. Delta gently stays.');
    game.start(0);
    const at = pressLetters(game, ['b', 'q', 'r', 'd', 'g', 's']);

    expect(game.status).toBe(STATUS.FINISHED);
    const bounds = recallBounds(game.words, 0, game.words.length);
    expect(selectTarget(game.words, bounds.start, bounds.end, () => 0).word.original).toBe('gently');
    expect(game.snapshot().recall.phase).toBe('ask');
    expect(game.snapshot().recall.sentence.some((part) => part.blank)).toBe(true);
    expect(game.start(at)).toBe(false);

    const wrong = game.snapshot().recall.choices.find((choice) => choice.label !== 'gently');
    expect(['quietly', 'rests']).toContain(wrong.label);
    expect(game.answerRecall(wrong.id)).toBe(true);
    expect(game.snapshot().score).toBe(600);
    expect(game.start(at)).toBe(false);
    expect(game.acknowledgeRecall()).toBe(true);
    expect(game.start(at + 50)).toBe(true);
    expect(game.snapshot()).toMatchObject({ status: STATUS.PLAYING, score: 0, recall: null });
  });

  it('passes over punctuation-only tokens', () => {
    const game = setup('... Next', { punctuationMultiplier: 3 });
    const glance = wordDeadlineMs({ isGap: true }, game.config);
    game.start(0);
    expect(game.snapshot(0).deadlineMs).toBe(glance);
    game.tick(glance - 1);
    expect(game.snapshot(glance - 1).index).toBe(0);
    game.tick(glance);
    expect(game.snapshot(glance)).toMatchObject({ index: 1, misses: 0, answer: 'N' });
  });

  it('glances at a dash or a double space, then reads the next word', () => {
    const game = setup('Go —  on', { punctuationMultiplier: 3, openingMultiplier: 3 });
    const glance = wordDeadlineMs({ isGap: true, hasPunctuation: true, isOpening: true }, game.config);
    const keyed = wordDeadlineMs({ isTarget: true }, game.config);
    expect(glance).toBeLessThan(keyed);

    game.start(0);
    game.press('g', 10);
    expect(game.snapshot(10)).toMatchObject({
      index: 1,
      isTarget: false,
      deadlineMs: glance,
      misses: 0,
    });
    game.tick(10 + glance - 1);
    expect(game.snapshot(10 + glance - 1).index).toBe(1);
    game.tick(10 + glance);
    expect(game.snapshot(10 + glance)).toMatchObject({
      index: 2,
      isTarget: false,
      deadlineMs: glance,
      misses: 0,
    });
    game.tick(10 + glance * 2 - 1);
    expect(game.snapshot(10 + glance * 2 - 1).index).toBe(2);
    game.tick(10 + glance * 2);
    expect(game.snapshot(10 + glance * 2)).toMatchObject({ index: 3, answer: 'O', misses: 0 });
  });
});

describe('playing a pace', () => {
  it('holds a Linger word for the full window, then freezes briefly', () => {
    const game = setup('Concept is', { roundSize: 0 });
    game.setConfig(pacePatch(PACE_PRESETS.linger));
    game.start(0);

    expect(game.snapshot(0).deadlineMs).toBe(6800);
    game.tick(6799);
    expect(game.snapshot(6799)).toMatchObject({ status: STATUS.PLAYING, index: 0, misses: 0 });

    game.tick(6800);
    expect(game.snapshot(6800)).toMatchObject({
      status: STATUS.FROZEN,
      index: 0,
      misses: 1,
      missReason: 'timeout',
      freezeLeftMs: 500,
    });
    game.tick(7299);
    expect(game.status).toBe(STATUS.FROZEN);
    game.tick(7300);
    expect(game.snapshot(7300)).toMatchObject({ status: STATUS.PLAYING, index: 1, misses: 1 });
  });

  it('leaves advance-on-hit alone when the pace is Study', () => {
    const game = setup('Concept is', { advanceOnHit: false, showTargetHud: false, roundSize: 0 });
    game.setConfig(pacePatch(PACE_PRESETS.study));
    expect(game.config.advanceOnHit).toBe(false);
    expect(game.config.showTargetHud).toBe(false);

    game.start(0);
    expect(game.snapshot(0).deadlineMs).toBe(3800);
    expect(game.press('c', 250)).toBe(true);
    expect(game.snapshot(250)).toMatchObject({ status: STATUS.PLAYING, index: 0, hits: 1 });
  });

  it('gives a sentence ending the longer Linger window', () => {
    const game = setup('Idea.', { roundSize: 0, punctuationMultiplier: 1.5 });
    game.setConfig(pacePatch(PACE_PRESETS.linger));
    game.start(0);
    expect(game.snapshot(0).deadlineMs).toBe(9800);
    game.tick(9799);
    expect(game.snapshot(9799)).toMatchObject({ status: STATUS.PLAYING, index: 0 });
  });

  it('leaves Advance on a hit alone when the pace is Warmup', () => {
    const game = setup('Alpha Beta', { advanceOnHit: false, showTargetHud: false, roundSize: 0 });
    game.setConfig(pacePatch(PACE_PRESETS.warmup));
    expect(game.config.advanceOnHit).toBe(false);
    expect(game.config.showTargetHud).toBe(false);
    expect(game.config).toMatchObject({
      wpm: PACE_PRESETS.warmup.wpm,
      forgivenessMs: PACE_PRESETS.warmup.forgivenessMs,
    });

    game.start(0);
    expect(game.press('a', 40)).toBe(true);
    expect(game.snapshot(40)).toMatchObject({ status: STATUS.PLAYING, index: 0, hits: 1 });
  });
});

describe('opening pause', () => {
  it('gives the first word a longer window after Start, a breath, and Read again', () => {
    const game = setup('Go Go. Go Go', { openingMultiplier: 2, roundSize: 2 });
    game.start(0);
    expect(game.snapshot(0).deadlineMs).toBe(200);

    game.press('g', 10);
    expect(game.snapshot(10)).toMatchObject({ index: 1, deadlineMs: 100 });
    game.press('g', 50);
    expect(game.status).toBe(STATUS.BREAK);

    game.continueRound(60);
    expect(game.snapshot(60)).toMatchObject({ index: 2, deadlineMs: 200 });
    game.press('g', 100);
    expect(game.snapshot(100)).toMatchObject({ index: 3, deadlineMs: 100 });
    game.press('g', 140);
    expect(game.status).toBe(STATUS.FINISHED);

    game.start(160);
    expect(game.snapshot(160)).toMatchObject({ index: 0, deadlineMs: 200 });
  });

  it('keeps that longer window when the same word is paused', () => {
    const game = setup('Alpha Beta', { openingMultiplier: 2 });
    game.start(0);
    game.pause();
    game.resume(50);
    expect(game.snapshot(50).deadlineMs).toBe(200);
    game.tick(249);
    expect(game.snapshot(249)).toMatchObject({ index: 0, misses: 0 });
    game.tick(250);
    expect(game.snapshot(250)).toMatchObject({ index: 1, deadlineMs: 100, misses: 1 });

    game.pause();
    game.resume(300);
    expect(game.snapshot(300).deadlineMs).toBe(100);
  });

  it('gives a longer window to the word played after a covering window', () => {
    const game = setup('Alpha Beta Gamma', { openingMultiplier: 2 });
    game.start(0);
    game.press('a', 10);
    expect(game.snapshot(10).deadlineMs).toBe(100);

    game.pause();
    game.cover();
    game.resume(40);
    expect(game.snapshot(40)).toMatchObject({ index: 1, deadlineMs: 200 });

    game.press('b', 50);
    game.pause();
    game.cover();
    game.jumpTo(2);
    game.resume(60);
    expect(game.snapshot(60)).toMatchObject({ index: 2, deadlineMs: 200 });
  });

  it('keeps the normal window when a word is chosen during a plain pause', () => {
    const game = setup('Alpha Beta Gamma', { openingMultiplier: 2 });
    game.start(0);
    game.press('a', 10);
    game.pause();
    game.jumpTo(2);
    game.resume(40);
    expect(game.snapshot(40)).toMatchObject({ index: 2, deadlineMs: 100 });
  });

  it('gives the next word a longer window when a window covered the freeze', () => {
    const game = setup('Alpha Beta', { openingMultiplier: 2, freezeSec: 1 });
    game.start(0);
    game.press('z', 10);
    game.cover();
    game.tick(1009);
    expect(game.status).toBe(STATUS.FROZEN);
    game.tick(1010);
    expect(game.snapshot(1010)).toMatchObject({ index: 1, deadlineMs: 200, misses: 1 });
  });

  it('keeps the opening pause on the first key after a dash', () => {
    const game = setup('— Alpha', { openingMultiplier: 2 });
    const glance = wordDeadlineMs({ isGap: true }, game.config);
    game.start(0);
    expect(game.snapshot(0)).toMatchObject({ index: 0, isTarget: false, deadlineMs: glance });
    game.tick(glance - 1);
    expect(game.snapshot(glance - 1).index).toBe(0);
    game.tick(glance);
    expect(game.snapshot(glance)).toMatchObject({ index: 1, answer: 'A', deadlineMs: 200, misses: 0 });
  });

  it('holds the longer window for the first word that needs a key', () => {
    const game = setup('the Alpha Stays', { filter: 'capital', openingMultiplier: 2 });
    game.start(0);
    expect(game.snapshot(0)).toMatchObject({ index: 0, isTarget: false, deadlineMs: 100 });
    game.tick(100);
    expect(game.snapshot(100)).toMatchObject({ index: 1, answer: 'A', deadlineMs: 200, misses: 0 });
    game.tick(299);
    expect(game.snapshot(299).index).toBe(1);
    game.tick(300);
    expect(game.snapshot(300)).toMatchObject({ index: 2, answer: 'S', deadlineMs: 100, misses: 1 });
  });

  it('holds that longer window after a breath when the next word needs no key', () => {
    const game = setup('Go Go. the Alpha', { filter: 'capital', openingMultiplier: 2, roundSize: 2 });
    game.start(0);
    expect(game.snapshot(0)).toMatchObject({ answer: 'G', deadlineMs: 200 });
    game.press('g', 10);
    game.press('g', 50);
    expect(game.status).toBe(STATUS.BREAK);

    game.continueRound(60);
    expect(game.snapshot(60)).toMatchObject({ index: 2, isTarget: false, deadlineMs: 100 });
    game.tick(159);
    expect(game.snapshot(159).index).toBe(2);
    game.tick(160);
    expect(game.snapshot(160)).toMatchObject({ index: 3, answer: 'A', deadlineMs: 200, misses: 0 });
  });

  it('adds punctuation on top of the opening word only', () => {
    const game = setup('Hi, Ho', { punctuationMultiplier: 2, openingMultiplier: 3 });
    game.start(0);
    expect(game.snapshot(0).deadlineMs).toBe(600);
    game.tick(599);
    expect(game.snapshot(599)).toMatchObject({ index: 0, misses: 0 });
    game.tick(600);
    expect(game.snapshot(600)).toMatchObject({ index: 1, deadlineMs: 100, misses: 1 });
  });

  it('applies a covering window once', () => {
    const game = setup('Alpha Beta', { openingMultiplier: 2 });
    game.start(0);
    game.pause();
    game.cover();
    game.cover();
    game.resume(20);
    expect(game.snapshot(20).deadlineMs).toBe(200);
  });

  it('does not hand the longer window to the next word after the letter was already right', () => {
    const game = setup('Alpha Beta', { openingMultiplier: 2, advanceOnHit: false });
    game.start(0);
    game.press('a', 20);
    game.pause();
    game.resume(40);
    expect(game.snapshot(40)).toMatchObject({ index: 1, deadlineMs: 100, misses: 0 });
  });

  it('gives a longer window after the breath question is done', () => {
    const game = setup(CLOZE, { openingMultiplier: 2, roundSize: 6 });
    game.start(0);
    const at = pressLetters(game, ['b', 'q', 'r', 'd', 'g', 's']);
    expect(game.status).toBe(STATUS.BREAK);
    expect(game.continueRound(at)).toBe(false);

    const choice = game.snapshot().recall.choices.find((item) => item.label === 'quietly');
    expect(game.answerRecall(choice.id)).toBe(true);
    expect(game.continueRound(at + 20)).toBe(true);
    expect(game.snapshot(at + 20)).toMatchObject({ index: 6, deadlineMs: 200 });
    expect(game.press('f', at + 60)).toBe(true);
    expect(game.snapshot(at + 60)).toMatchObject({ index: 7, deadlineMs: 100 });
  });

  it('keeps the opening pause when a pace is chosen', () => {
    const game = setup('Concept', { openingMultiplier: 3, roundSize: 0 });
    game.setConfig(pacePatch(PACE_PRESETS.linger));
    expect(game.config).toMatchObject({
      wpm: PACE_PRESETS.linger.wpm,
      forgivenessMs: PACE_PRESETS.linger.forgivenessMs,
      openingMultiplier: 3,
    });
    game.start(0);
    expect(game.snapshot(0).deadlineMs).toBe(
      wordDeadlineMs({ isTarget: true, isOpening: true }, game.config),
    );
  });

  it('uses the opening pause chosen while a window is open', () => {
    const game = setup('Alpha Beta', { openingMultiplier: 2 });
    game.start(0);
    game.press('a', 10);
    game.pause();
    game.cover();
    game.setConfig({ openingMultiplier: 3 });
    game.resume(40);
    expect(game.snapshot(40)).toMatchObject({ index: 1, deadlineMs: 300 });
  });

  it('follows the slider while the opening word is still up', () => {
    const game = setup('Alpha', { openingMultiplier: 2 });
    game.start(0);
    expect(game.snapshot(0).deadlineMs).toBe(200);
    game.setConfig({ openingMultiplier: 3 });
    expect(game.snapshot(0).deadlineMs).toBe(300);
  });
});

describe('spot check', () => {
  function sequence(...values) {
    let index = 0;
    return () => values[Math.min(index++, values.length - 1)];
  }

  it('leaves an ordinary word on the first letter', () => {
    const game = setup('Word Beta', { spotCheck: true, spotLookMs: 200 });
    game.start(0);
    expect(game.snapshot(0)).toMatchObject({
      spot: { phase: 'look', cueIndex: 0 },
      answer: null,
      deadlineMs: 200,
    });
    expect(game.press('w', 20)).toBe(false);
    expect(game.snapshot(20)).toMatchObject({ index: 0, misses: 0, score: 0 });

    game.tick(199);
    expect(game.snapshot(199).spot.phase).toBe('look');
    game.tick(200);
    expect(game.snapshot(200)).toMatchObject({
      spot: { phase: 'answer', cueIndex: 0 },
      answer: null,
      deadlineMs: 100,
      misses: 0,
    });

    expect(game.press('w', 220)).toBe(true);
    expect(game.consumeEvents().find((event) => event.type === 'hit').reaction).toBe(20);
    expect(game.snapshot(220)).toMatchObject({
      index: 0,
      score: 100,
      spot: { phase: 'reveal' },
      answer: 'W',
    });
    game.tick(220 + SPOT_REVEAL_MS - 1);
    expect(game.snapshot(619).index).toBe(0);
    game.tick(220 + SPOT_REVEAL_MS);
    expect(game.snapshot(620)).toMatchObject({
      index: 1,
      spot: null,
      answer: 'B',
      score: 100,
    });
    expect(game.press('b', 650)).toBe(true);
    expect(game.status).toBe(STATUS.FINISHED);
  });

  it('asks for the marked letter, not the first one', () => {
    const game = setup('Word Beta', { spotCheck: true, spotLookMs: 200, freezeSec: 1 }, sequence(0, 0.8));
    game.start(0);
    game.tick(200);
    expect(game.snapshot(200).spot.cueIndex).toBe(3);
    expect(game.press('w', 220)).toBe(true);
    expect(game.consumeEvents().find((event) => event.type === 'miss')).toMatchObject({
      answer: 'D',
      pressed: 'W',
    });
    expect(game.snapshot(220)).toMatchObject({
      status: STATUS.FROZEN,
      answer: 'D',
      spot: { phase: 'answer', cueIndex: 3 },
      misses: 1,
    });
    game.tick(1220);
    expect(game.snapshot(1220)).toMatchObject({ index: 1, answer: 'B', spot: null });
  });

  it('still takes the short beat when advance-on-hit is off', () => {
    const game = setup('Word Beta', { spotCheck: true, spotLookMs: 200, advanceOnHit: false });
    game.start(0);
    game.tick(200);
    game.press('w', 210);
    game.tick(210 + SPOT_REVEAL_MS);
    expect(game.snapshot(610)).toMatchObject({ index: 1, answer: 'B' });
    game.press('b', 630);
    expect(game.snapshot(630)).toMatchObject({ index: 1, hits: 2, responded: true });
  });

  it('keeps short words on the first letter', () => {
    const game = setup('to Word', { spotCheck: true, spotLookMs: 200 });
    game.start(0);
    expect(game.snapshot(0)).toMatchObject({ answer: 'T', spot: null, index: 0 });
    game.press('t', 20);
    expect(game.snapshot(20)).toMatchObject({ index: 1, spot: { phase: 'look' }, answer: null });
  });

  it('restarts the look after a pause, and restarts only the answer once the blocks are up', () => {
    const game = setup('Word', { spotCheck: true, spotLookMs: 200 });
    game.start(0);
    game.tick(150);
    game.pause();
    game.resume(1000);
    expect(game.snapshot(1000)).toMatchObject({ spot: { phase: 'look', cueIndex: 0 }, deadlineMs: 200 });
    game.tick(1199);
    expect(game.snapshot(1199).spot.phase).toBe('look');
    game.tick(1200);
    expect(game.snapshot(1200).spot.phase).toBe('answer');
    game.tick(1250);
    game.pause();
    game.resume(2000);
    expect(game.snapshot(2000)).toMatchObject({
      spot: { phase: 'answer', cueIndex: 0 },
      answer: null,
      deadlineMs: 100,
    });
    expect(game.press('w', 2050)).toBe(true);
    expect(game.snapshot(2050).spot.phase).toBe('reveal');
  });

  it('stretches the look on the opening word', () => {
    const game = setup('Word', { spotCheck: true, spotLookMs: 200, openingMultiplier: 2 });
    game.start(0);
    expect(game.snapshot(0).deadlineMs).toBe(400);
    game.tick(400);
    expect(game.snapshot(400)).toMatchObject({ spot: { phase: 'answer' }, deadlineMs: 200 });
  });

  it('stays off during a recital and comes back for Words', () => {
    const recital = setup('Word Beta', { spotCheck: true, playMode: 'recital', spotLookMs: 200 });
    recital.start(0);
    expect(recital.snapshot(0).spot).toBeNull();
    expect(recital.snapshot(0).recital.phase).toBe('look');
    expect(recital.config.spotCheck).toBe(true);

    const words = setup('Word Beta', { spotCheck: true, playMode: 'recital', spotLookMs: 200 });
    words.setConfig({ playMode: 'words' });
    words.start(0);
    expect(words.snapshot(0).spot.phase).toBe('look');

    const open = setup('Word Beta', { spotCheck: true, spotLookMs: 200 });
    open.start(0);
    expect(open.snapshot(0).spot.phase).toBe('look');
    open.pause();
    open.setConfig({ playMode: 'recital' });
    expect(open.config.spotCheck).toBe(true);
    open.resume(50);
    expect(open.snapshot(50)).toMatchObject({ spot: null, answer: 'W' });
  });

  it('can be turned on during a pause, and a pace leaves it alone', () => {
    const game = setup('Word Beta', { spotLookMs: 400 });
    game.setConfig({ spotCheck: true, spotLookMs: 400 });
    game.setConfig(pacePatch(PACE_PRESETS.linger));
    expect(game.config.spotCheck).toBe(true);
    expect(game.config.spotLookMs).toBe(400);

    const quiet = setup('Word', { spotCheck: false, spotLookMs: 200 });
    quiet.start(0);
    expect(quiet.snapshot(0).spot).toBeNull();
    quiet.pause();
    quiet.setConfig({ spotCheck: true });
    quiet.resume(50);
    expect(quiet.snapshot(50).spot.phase).toBe('look');
    quiet.pause();
    quiet.setConfig({ spotCheck: false });
    quiet.resume(80);
    expect(quiet.snapshot(80)).toMatchObject({ spot: null, answer: 'W' });
    expect(quiet.press('w', 100)).toBe(true);
  });

  it('drops the spot check before the breath screen', () => {
    const game = setup('Word. Beta', { spotCheck: true, spotLookMs: 200, roundSize: 1 });
    game.start(0);
    game.tick(200);
    game.press('w', 220);
    game.tick(220 + SPOT_REVEAL_MS);
    expect(game.snapshot(620)).toMatchObject({ status: STATUS.BREAK, index: 1, spot: null });
  });

  it('stretches the look on a word with punctuation', () => {
    const game = setup('Word, Beta', { spotCheck: true, spotLookMs: 200, punctuationMultiplier: 2 });
    game.start(0);
    expect(game.snapshot(0).deadlineMs).toBe(400);
    game.tick(399);
    expect(game.snapshot(399).spot.phase).toBe('look');
    game.tick(400);
    expect(game.snapshot(400)).toMatchObject({ spot: { phase: 'answer' }, deadlineMs: 200, misses: 0 });
  });

  it('reports the marked letter when the answer window ends', () => {
    const game = setup('Word Beta', { spotCheck: true, spotLookMs: 200 }, sequence(0, 0.8));
    game.start(0);
    game.tick(200);
    game.tick(299);
    expect(game.snapshot(299)).toMatchObject({ index: 0, misses: 0 });
    game.tick(300);
    expect(game.consumeEvents().find((event) => event.type === 'miss')).toMatchObject({
      reason: 'timeout',
      answer: 'D',
      pressed: null,
    });
    expect(game.snapshot(300)).toMatchObject({ index: 1, answer: 'B', misses: 1, spot: null });
  });

  it('ignores a key during the reveal and does not let a look press block the answer', () => {
    const game = setup('Word', { spotCheck: true, spotLookMs: 200 });
    game.start(0);
    expect(game.press('w', 190)).toBe(false);
    game.tick(200);
    expect(game.press('w', 210)).toBe(true);
    expect(game.press('z', 230)).toBe(false);
    expect(game.snapshot(230)).toMatchObject({
      index: 0,
      misses: 0,
      score: 100,
      spot: { phase: 'reveal' },
    });
    game.tick(210 + SPOT_REVEAL_MS - 1);
    expect(game.status).toBe(STATUS.PLAYING);
  });

  it('follows the look slider while that word is still up', () => {
    const game = setup('Word', { spotCheck: true, spotLookMs: 200 });
    game.start(0);
    game.setConfig({ spotLookMs: 500 });
    expect(game.snapshot(0).deadlineMs).toBe(500);
    game.tick(499);
    expect(game.snapshot(499).spot.phase).toBe('look');
    game.tick(500);
    expect(game.snapshot(500).spot.phase).toBe('answer');
  });

  it('keeps the assigned letter when the highlight moves during a pause', () => {
    const game = setup(
      'Word Beta Golf Room Kind Note Jump Vivid Extra Lucky',
      { spotCheck: true, spotLookMs: 200 },
    );
    game.start(0);
    game.pause();
    expect(game.jumpTo(5)).toBe(true);
    game.resume(40);
    expect(game.snapshot(40)).toMatchObject({
      index: 5,
      answer: null,
      spot: { phase: 'look', cueIndex: 0 },
    });
    game.pause();
    game.jumpTo(1);
    game.resume(80);
    expect(game.snapshot(80)).toMatchObject({ index: 1, spot: null, answer: 'B' });
  });

  it('gives a covered look the opening pause', () => {
    const game = setup('to Word', { spotCheck: true, spotLookMs: 200, openingMultiplier: 2 });
    game.start(0);
    game.press('t', 20);
    expect(game.snapshot(20)).toMatchObject({ index: 1, deadlineMs: 200, spot: { phase: 'look' } });
    game.pause();
    game.cover();
    game.resume(50);
    expect(game.snapshot(50).deadlineMs).toBe(400);
  });

  it('accepts the folded key for an accented spot check', () => {
    const game = setup('Éclair', { spotCheck: true, spotLookMs: 200 });
    game.start(0);
    expect(game.snapshot(0).deadlineMs).toBe(260);
    game.tick(260);
    expect(game.press('é', 280)).toBe(true);
    expect(game.snapshot(280)).toMatchObject({ score: 100, spot: { phase: 'reveal' }, answer: 'E' });
  });

  it('can mark a digit', () => {
    const game = setup('beta4', { spotCheck: true, spotLookMs: 200 }, sequence(0.99));
    game.start(0);
    game.tick(200);
    expect(game.snapshot(200).spot.cueIndex).toBe(4);
    expect(game.press('4', 220)).toBe(true);
    expect(game.snapshot(220)).toMatchObject({ score: 100, answer: '4' });
  });

  it('spot-checks the long words when short words are filtered out', () => {
    const game = setup('to Word', { spotCheck: true, spotLookMs: 200, filter: 'long' });
    game.start(0);
    expect(game.snapshot(0)).toMatchObject({ index: 0, isTarget: false, spot: null });
    game.tick(100);
    expect(game.snapshot(100)).toMatchObject({ index: 1, spot: { phase: 'look' }, answer: null, misses: 0 });
  });

  it('picks again when the article is read again', () => {
    const rolls = [0, 0, 0, 0.8];
    let index = 0;
    const game = setup('Word', { spotCheck: true, spotLookMs: 200 }, () => rolls[index++]);
    game.start(0);
    expect(game.snapshot(0).spot.cueIndex).toBe(0);
    game.load('Word', 'Fixture');
    game.start(10);
    expect(game.snapshot(10).spot.cueIndex).toBe(3);
  });
});

describe('recital', () => {
  const LINE = 'Alpha Beta Golf Hotel';
  const CLOUD = 'Setting up a Google Cloud project and configuring authentication lets you call Google Cloud APIs from your applications.';

  it('opens a long sentence on its first finished piece', () => {
    const game = setup(CLOUD, { playMode: 'recital', wpm: 60 });
    game.start(0);
    expect(game.snapshot(0)).toMatchObject({
      recital: { phase: 'look', start: 0, end: 9, length: 9, place: 1 },
    });
    pressLetters(game, 'suagcpaca');
    expect(game.snapshot()).toMatchObject({
      index: 9,
      recital: { phase: 'look', start: 9, end: 18, length: 9, place: 1 },
    });
  });

  it('reads the phrase, then hides it and takes the rest from memory', () => {
    const game = setup(LINE, { playMode: 'recital' });
    game.start(0);
    expect(game.snapshot(0)).toMatchObject({
      index: 0,
      deadlineMs: 800,
      answer: 'A',
      spot: null,
      recital: { phase: 'look', start: 0, end: 4, place: 1, length: 4 },
    });
    expect(game.press('z', 10)).toBe(false);
    expect(game.press('a', 20)).toBe(true);
    expect(game.snapshot(20)).toMatchObject({
      index: 1,
      deadlineMs: 200,
      answer: null,
      score: 100,
      streak: 1,
      avgReaction: 0,
      recital: { phase: 'riff', place: 2 },
    });
    expect(game.press('b', 60)).toBe(true);
    expect(game.snapshot(60).avgReaction).toBe(20);
    expect(game.press('g', 100)).toBe(true);
    expect(game.press('h', 140)).toBe(true);
    expect(game.status).toBe(STATUS.FINISHED);
    expect(game.snapshot().recital).toBeNull();
  });

  it('goes dark on its own and a miss ends the phrase', () => {
    const game = setup(LINE, { playMode: 'recital' });
    game.start(0);
    game.tick(799);
    expect(game.snapshot(799).recital.phase).toBe('look');
    game.tick(800);
    expect(game.snapshot(800)).toMatchObject({
      index: 0,
      answer: null,
      misses: 0,
      recital: { phase: 'riff', place: 1 },
    });
    game.tick(1000);
    expect(game.snapshot(1000)).toMatchObject({
      status: STATUS.FINISHED,
      hits: 0,
      misses: 1,
      recital: null,
    });
  });

  it('shows the owed letter and skips the rest of the phrase', () => {
    const game = setup(LINE, { playMode: 'recital', freezeSec: 1 });
    game.start(0);
    game.press('a', 20);
    expect(game.press('z', 60)).toBe(true);
    expect(game.snapshot(60)).toMatchObject({
      status: STATUS.FROZEN,
      index: 1,
      misses: 1,
      answer: 'B',
      missReason: 'wrong',
      missedKey: 'Z',
      recital: { phase: 'reveal', place: 2 },
    });
    game.tick(1059);
    expect(game.status).toBe(STATUS.FROZEN);
    game.tick(1060);
    expect(game.snapshot(1060)).toMatchObject({
      status: STATUS.FINISHED,
      misses: 1,
      hits: 1,
    });
  });

  it('keeps a one-word phrase visible until the look runs out', () => {
    const seen = setup('Alpha', { playMode: 'recital' });
    seen.start(0);
    expect(seen.press('a', 10)).toBe(true);
    expect(seen.status).toBe(STATUS.FINISHED);
    expect(seen.snapshot().hits).toBe(1);

    const dark = setup('Alpha', { playMode: 'recital' });
    dark.start(0);
    dark.tick(200);
    expect(dark.snapshot(200)).toMatchObject({ recital: { phase: 'riff', length: 1 }, answer: null });
    expect(dark.press('a', 220)).toBe(true);
    expect(dark.status).toBe(STATUS.FINISHED);
  });

  it('moves on a hit even when advance on a hit is off', () => {
    const game = setup(LINE, { playMode: 'recital', advanceOnHit: false });
    game.start(0);
    game.press('a', 20);
    expect(game.snapshot(20).recital.phase).toBe('riff');
    expect(game.snapshot(20).index).toBe(1);
  });

  it('gives every word a key when the filter would skip it', () => {
    const game = setup('to Word', { playMode: 'recital', filter: 'long' });
    game.start(0);
    expect(game.snapshot(0).isTarget).toBe(true);
    expect(game.press('t', 20)).toBe(true);
    expect(game.snapshot(20)).toMatchObject({ index: 1, recital: { phase: 'riff' }, answer: null });
    expect(game.press('w', 60)).toBe(true);
    expect(game.status).toBe(STATUS.FINISHED);
  });

  it('does not run a spot check', () => {
    const game = setup('Word Beta', { playMode: 'recital', spotCheck: true, spotLookMs: 200 });
    game.start(0);
    expect(game.snapshot(0).spot).toBeNull();
    expect(game.snapshot(0).recital.phase).toBe('look');
    game.press('w', 20);
    expect(game.snapshot(20)).toMatchObject({ recital: { phase: 'riff' }, spot: null, answer: null });
  });

  it('restarts the look, and restarts only the fuse', () => {
    const game = setup(LINE, { playMode: 'recital' });
    game.start(0);
    game.tick(100);
    game.pause();
    game.resume(500);
    expect(game.snapshot(500)).toMatchObject({ recital: { phase: 'look' }, deadlineMs: 800 });
    expect(game.snapshot(500).progress).toBe(0);
    game.press('a', 520);
    game.pause();
    game.resume(900);
    expect(game.snapshot(900)).toMatchObject({
      index: 1,
      deadlineMs: 200,
      recital: { phase: 'riff', place: 2 },
      answer: null,
    });
    expect(game.snapshot(900).progress).toBe(0);
  });

  it('resumes a jump at the start of that phrase', () => {
    const game = setup('Alpha Beta Golf Hotel India Juliet, Kilo Lima', { playMode: 'recital' });
    game.start(0);
    game.pause();
    expect(game.jumpTo(7)).toBe(true);
    expect(game.snapshot(0)).toMatchObject({
      index: 6,
      recital: { phase: 'look', start: 6, end: 8, length: 2 },
    });
    game.resume(40);
    expect(game.snapshot(40).recital.phase).toBe('look');
    expect(game.press('k', 50)).toBe(true);
    expect(game.snapshot(50)).toMatchObject({ index: 7, recital: { phase: 'riff' } });
  });

  it('stretches the look for the opening and for punctuation, and keeps the fuse plain', () => {
    const opened = setup(LINE, { playMode: 'recital', openingMultiplier: 2 });
    opened.start(0);
    expect(opened.snapshot(0).deadlineMs).toBe(1000);

    const marked = setup('Alpha Beta Golf Hotel,', { playMode: 'recital', punctuationMultiplier: 2 });
    marked.start(0);
    expect(marked.snapshot(0).deadlineMs).toBe(1000);
    marked.press('a', 20);
    expect(marked.snapshot(20).deadlineMs).toBe(200);

    const forgiven = setup(LINE, { playMode: 'recital', forgivenessMs: 280 });
    forgiven.start(0);
    forgiven.press('a', 20);
    expect(forgiven.snapshot(20).deadlineMs).toBe(recitalFuseMs({ wpm: 600 }));
  });

  it('follows the reading speed while the phrase is up', () => {
    const game = setup(LINE, { playMode: 'recital' });
    game.start(0);
    game.setConfig({ wpm: 300 });
    expect(game.snapshot(0).deadlineMs).toBe(1600);
  });

  it('waits for a full stop before a breath, even when the phrase has ended', () => {
    const game = setup('Alpha Beta Golf Hotel India Juliet, Kilo Lima. Mike November', {
      playMode: 'recital',
      roundSize: 3,
    });
    game.start(0);
    game.press('a', 20);
    game.press('b', 60);
    game.press('g', 100);
    game.press('h', 140);
    game.press('i', 180);
    game.press('j', 220);
    expect(game.snapshot(220)).toMatchObject({ status: STATUS.PLAYING, index: 6, recital: { phase: 'look' } });
    game.press('k', 260);
    game.press('l', 300);
    expect(game.snapshot(300)).toMatchObject({ status: STATUS.BREAK, index: 8, recital: null, hits: 8 });
  });

  it('finishes the phrase already up, then follows the new mode', () => {
    const game = setup('Alpha Beta Golf Hotel India Juliet, Kilo Lima', { playMode: 'recital' });
    game.start(0);
    game.setConfig({ playMode: 'words' });
    expect(game.snapshot(0).recital.phase).toBe('look');
    game.press('a', 20);
    expect(game.snapshot(20).recital.phase).toBe('riff');
    game.press('b', 60);
    game.press('g', 100);
    game.press('h', 140);
    game.press('i', 180);
    game.press('j', 220);
    expect(game.snapshot(220)).toMatchObject({ index: 6, recital: null, answer: 'K' });
  });

  it('starts at the next phrase when it is turned on mid-run', () => {
    const game = setup('Alpha Beta Golf Hotel India Juliet, Kilo Lima');
    game.start(0);
    expect(game.snapshot(0).recital).toBeNull();
    game.press('a', 20);
    game.setConfig({ playMode: 'recital' });
    game.press('b', 60);
    game.press('g', 100);
    game.press('h', 140);
    game.press('i', 180);
    game.press('j', 220);
    expect(game.snapshot(220)).toMatchObject({
      index: 6,
      recital: { phase: 'look', start: 6, end: 8 },
    });
  });

  it('leaves the mode alone when a pace is chosen', () => {
    const game = setup(LINE, { playMode: 'recital' });
    game.setConfig(pacePatch(PACE_PRESETS.linger));
    expect(game.config.playMode).toBe('recital');
    expect(game.config.spotCheck).toBe(false);
  });

  it('gives a covered look the opening pause', () => {
    const game = setup('Go. Alpha Beta Golf Hotel', { playMode: 'recital', openingMultiplier: 2 });
    game.start(0);
    expect(game.snapshot(0).deadlineMs).toBe(400);
    game.press('g', 20);
    expect(game.snapshot(20)).toMatchObject({ index: 1, deadlineMs: 800, recital: { phase: 'look' } });
    game.pause();
    game.cover();
    game.resume(80);
    expect(game.snapshot(80).deadlineMs).toBe(1000);
  });

  it('accepts the folded key for an accented recital word', () => {
    const game = setup('Éclair Beta Golf Hotel', { playMode: 'recital' });
    game.start(0);
    expect(game.press('é', 20)).toBe(true);
    expect(game.snapshot(20)).toMatchObject({ recital: { phase: 'riff' }, score: 100 });
  });
});

describe('quadrant taps', () => {
  it('scores the corner that owns the first letter and still takes a key', () => {
    const game = setup('Alpha Hotel');
    game.start(0);
    expect(game.pressArea('nw', 20)).toBe(true);
    expect(game.snapshot(20)).toMatchObject({ index: 1, score: 100, streak: 1 });
    expect(game.press('h', 80)).toBe(true);
    expect(game.status).toBe(STATUS.FINISHED);
  });

  it('misses the wrong corner and names that area', () => {
    const game = setup('Alpha', { freezeSec: 1 });
    game.start(0);
    expect(game.pressArea('se', 20)).toBe(true);
    expect(game.snapshot(20)).toMatchObject({
      status: STATUS.FROZEN,
      misses: 1,
      missedKey: 'T–Z',
      answer: 'A',
    });
  });

  it('scores the corner that owns a digit and names the number group on a miss', () => {
    const game = setup('4 cats', { freezeSec: 1 });
    game.start(0);
    expect(game.pressArea('nw', 20)).toBe(true);
    expect(game.snapshot(20)).toMatchObject({
      status: STATUS.FROZEN,
      misses: 1,
      missedKey: '0–2',
      answer: '4',
    });
    const next = setup('4 cats');
    next.start(0);
    expect(next.pressArea('ne', 20)).toBe(true);
    expect(next.snapshot(20)).toMatchObject({ index: 1, score: 100, streak: 1 });
  });

  it('answers a spot check by the marked letter’s corner', () => {
    const game = setup('Word Beta', { spotCheck: true, spotLookMs: 200, freezeSec: 1 });
    game.start(0);
    expect(game.pressArea('se', 20)).toBe(false);
    game.tick(200);
    expect(game.pressArea('se', 220)).toBe(true);
    expect(game.snapshot(220)).toMatchObject({
      score: 100,
      spot: { phase: 'reveal' },
      answer: 'W',
    });
  });

  it('names the wrong corner on a spot check', () => {
    const game = setup('Word', { spotCheck: true, spotLookMs: 200, freezeSec: 1 });
    game.start(0);
    game.tick(200);
    expect(game.pressArea('nw', 220)).toBe(true);
    expect(game.snapshot(220)).toMatchObject({
      status: STATUS.FROZEN,
      misses: 1,
      missedKey: 'A–G',
      answer: 'W',
      spot: { phase: 'answer' },
    });
  });

  it('answers a marked digit by its corner', () => {
    const game = setup('beta4', { spotCheck: true, spotLookMs: 200 }, () => 0.99);
    game.start(0);
    game.tick(200);
    expect(game.pressArea('ne', 220)).toBe(true);
    expect(game.snapshot(220)).toMatchObject({ score: 100, answer: '4', spot: { phase: 'reveal' } });
  });

  it('does not take a corner during recital', () => {
    const game = setup('Alpha Beta Golf Hotel', { playMode: 'recital' });
    game.start(0);
    expect(game.pressArea('nw', 20)).toBe(false);
    expect(game.snapshot(20)).toMatchObject({ score: 0, recital: { phase: 'look' } });
  });
});

describe('sentence step', () => {
  const PIECE = 'Alpha Beta Gamma. Hotel India. Kilo.';

  it('skips to the next sentence and keeps the streak', () => {
    const game = setup(PIECE, { openingMultiplier: 2 });
    game.start(0);
    game.press('a', 20);
    expect(game.stepSentence(1, 30)).toBe(false);
    game.pause();
    expect(game.stepSentence(1, 40)).toBe(true);
    expect(game.consumeEvents().find((event) => event.type === 'step')).toMatchObject({
      direction: 1,
      index: 3,
      line: 'Next sentence.',
    });
    expect(game.snapshot(40)).toMatchObject({
      status: STATUS.PAUSED,
      index: 3,
      score: 100,
      streak: 1,
      hits: 1,
      misses: 0,
      roundStart: 0,
      roundWords: 1,
      step: { previous: true, next: true },
    });
    expect(game.snapshot(40).word.original).toBe('Hotel');
    game.resume(40);
    expect(game.snapshot(40)).toMatchObject({
      status: STATUS.PLAYING,
      index: 3,
      deadlineMs: 200,
      progress: 0,
    });
  });

  it('restarts the current sentence before it steps back', () => {
    const game = setup(PIECE, { openingMultiplier: 2 });
    game.start(0);
    game.press('a', 20);
    game.pause();
    expect(game.stepSentence(-1, 40)).toBe(true);
    expect(game.consumeEvents().find((event) => event.type === 'step').line).toBe(
      'Start of this sentence.',
    );
    expect(game.snapshot(40)).toMatchObject({
      index: 0,
      score: 100,
      streak: 1,
      status: STATUS.PAUSED,
    });
    game.resume(40);
    expect(game.snapshot(40).deadlineMs).toBe(200);

    game.press('a', 60);
    game.press('b', 100);
    game.press('g', 140);
    game.pause();
    expect(game.stepSentence(-1, 160)).toBe(true);
    expect(game.consumeEvents().find((event) => event.type === 'step').line).toBe(
      'Previous sentence.',
    );
    expect(game.snapshot(160).index).toBe(0);
  });

  it('does nothing at the ends, on a breath, or before the round starts', () => {
    const idle = setup('Alpha Beta.');
    expect(idle.stepSentence(1, 0)).toBe(false);
    expect(idle.stepSentence(-1, 0)).toBe(false);
    idle.start(0);
    idle.pause();
    expect(idle.stepSentence(-1, 10)).toBe(false);
    idle.resume(15);
    idle.press('a', 20);
    idle.pause();
    expect(idle.stepSentence(1, 40)).toBe(false);
    expect(idle.snapshot(40).index).toBe(1);
    idle.resume(50);
    idle.press('b', 60);
    expect(idle.status).toBe(STATUS.FINISHED);
    expect(idle.stepSentence(-1, 80)).toBe(false);

    const breath = setup('Alpha Beta. Golf.', { roundSize: 2 });
    breath.start(0);
    breath.press('a', 20);
    breath.press('b', 60);
    expect(breath.status).toBe(STATUS.BREAK);
    expect(breath.stepSentence(1, 80)).toBe(false);
    expect(breath.stepSentence(-1, 80)).toBe(false);
  });

  it('treats a return as practice and still scores the new word', () => {
    const game = setup(PIECE);
    game.start(0);
    game.press('a', 20);
    game.press('b', 60);
    game.press('g', 100);
    game.pause();
    game.stepSentence(-1, 120);
    expect(game.snapshot(120)).toMatchObject({ index: 0, score: 300, streak: 3, hits: 3 });

    game.resume(130);
    game.press('z', 140);
    expect(game.snapshot(140)).toMatchObject({
      index: 1,
      score: 300,
      streak: 3,
      hits: 3,
      misses: 0,
      accuracy: 100,
    });
    game.press('b', 180);
    game.press('g', 220);
    expect(game.press('h', 260)).toBe(true);
    expect(game.snapshot(260)).toMatchObject({
      index: 4,
      score: 400,
      streak: 4,
      hits: 4,
      misses: 0,
    });
  });

  it('does not let a skip burn the round, and keeps the breath start', () => {
    const game = setup(PIECE, { roundSize: 2 });
    game.start(0);
    game.pause();
    game.stepSentence(1, 10);
    expect(game.snapshot(10)).toMatchObject({ index: 3, roundWords: 0, roundStart: 0, roundPlace: 1 });
    game.resume(20);
    game.press('h', 30);
    expect(game.status).toBe(STATUS.PLAYING);
    expect(game.snapshot(30).roundWords).toBe(1);
    game.press('i', 70);
    expect(game.snapshot(70)).toMatchObject({
      status: STATUS.BREAK,
      index: 5,
      roundWords: 2,
      roundStart: 0,
    });
  });

  it('leaves a paused jump on the same breath', () => {
    const game = setup(PIECE, { roundSize: 10 });
    game.start(0);
    game.press('a', 20);
    game.pause();
    expect(game.jumpTo(4)).toBe(true);
    expect(game.snapshot()).toMatchObject({
      status: STATUS.PAUSED,
      index: 4,
      roundStart: 0,
      roundWords: 1,
    });
  });

  it('cancels a freeze and stays paused until resume', () => {
    const frozen = setup(PIECE, { freezeSec: 1, openingMultiplier: 2 });
    frozen.start(0);
    frozen.press('z', 10);
    expect(frozen.status).toBe(STATUS.FROZEN);
    expect(frozen.stepSentence(1, 30)).toBe(false);
    expect(frozen.settle()).toBe(true);
    expect(frozen.status).toBe(STATUS.PAUSED);
    expect(frozen.stepSentence(1, 30)).toBe(true);
    expect(frozen.snapshot(30)).toMatchObject({
      status: STATUS.PAUSED,
      index: 3,
      misses: 1,
      streak: 0,
    });
    frozen.resume(40);
    expect(frozen.snapshot(40)).toMatchObject({
      status: STATUS.PLAYING,
      index: 3,
      deadlineMs: 200,
      progress: 0,
    });

    const paused = setup(PIECE, { openingMultiplier: 2 });
    paused.start(0);
    paused.press('a', 20);
    paused.pause();
    expect(paused.stepSentence(-1, 40)).toBe(true);
    expect(paused.snapshot(40)).toMatchObject({ status: STATUS.PAUSED, index: 0 });
    paused.resume(80);
    expect(paused.snapshot(80)).toMatchObject({
      status: STATUS.PLAYING,
      index: 0,
      deadlineMs: 200,
      progress: 0,
    });
  });

  it('splits on a blank line and keeps a comma inside the sentence', () => {
    const paragraphs = setup('Alpha Beta\n\nGolf Hotel.');
    paragraphs.start(0);
    paragraphs.pause();
    expect(paragraphs.stepSentence(1, 10)).toBe(true);
    expect(paragraphs.snapshot(10).word.original).toBe('Golf');

    const comma = setup('Alpha, Beta. Golf.');
    comma.start(0);
    comma.pause();
    expect(comma.stepSentence(1, 10)).toBe(true);
    expect(comma.snapshot(10).word.original).toBe('Golf.');
  });

  it('clears a spot check and starts the destination word clean', () => {
    const game = setup('Word Beta. Go now.', { spotCheck: true, spotLookMs: 200 });
    game.start(0);
    expect(game.snapshot(0).spot.phase).toBe('look');
    game.pause();
    expect(game.stepSentence(1, 20)).toBe(true);
    expect(game.snapshot(20)).toMatchObject({
      index: 2,
      spot: null,
      misses: 0,
      status: STATUS.PAUSED,
    });
    expect(game.snapshot(20).word.original).toBe('Go');
  });

  it('steps recital by phrase and opens that phrase on its look', () => {
    const game = setup('Alpha, Beta. Golf Hotel.', { playMode: 'recital', openingMultiplier: 2 });
    game.start(0);
    game.pause();
    expect(game.stepSentence(1, 10)).toBe(true);
    game.resume(10);
    expect(game.snapshot(10).word.original).toBe('Beta.');
    expect(game.snapshot(10).recital.phase).toBe('look');
    const beta = game.words.slice(game.snapshot(10).recital.start, game.snapshot(10).recital.end);
    expect(game.snapshot(10).deadlineMs).toBe(recitalLookMs(beta, game.config, true));
    expect(game.snapshot(10)).toMatchObject({ score: 0, hits: 0 });

    const words = setup('Alpha, Beta. Golf Hotel.');
    words.start(0);
    words.pause();
    words.stepSentence(1, 10);
    expect(words.snapshot(10).word.original).toBe('Golf');

    const line = setup('Alpha Beta. Golf Hotel.', { playMode: 'recital' });
    line.start(0);
    line.press('a', 20);
    line.pause();
    expect(line.stepSentence(-1, 40)).toBe(true);
    expect(line.consumeEvents().find((event) => event.type === 'step').line).toBe(
      'Start of this phrase.',
    );
    expect(line.snapshot(40)).toMatchObject({
      index: 0,
      recital: { phase: 'look' },
      score: 100,
      streak: 1,
    });
    line.stepSentence(1, 60);
    expect(line.stepSentence(1, 80)).toBe(false);
    expect(line.snapshot(80).recital.phase).toBe('look');
  });
});

describe('the board changes', () => {
  it('lights the corner for the first three target words and hides that letter', () => {
    const game = setup('Alpha Beta Golf Hotel');
    game.setConfig({ showTargetHud: true });
    game.start(0);
    expect(game.snapshot(0)).toMatchObject({ coach: true, coachZone: 'nw', answer: 'A' });
    game.press('a', 40);
    expect(game.snapshot(40)).toMatchObject({ coach: true, coachZone: 'nw', index: 1 });
    game.press('b', 80);
    game.press('g', 120);
    expect(game.snapshot(120)).toMatchObject({ coach: false, coachZone: null, index: 3, answer: 'H' });
  });

  it('does not light a corner again when the same word is resumed', () => {
    const game = setup('Alpha Beta');
    game.start(0);
    expect(game.snapshot(0).coachZone).toBe('nw');
    game.pause();
    game.resume(20);
    expect(game.snapshot(20)).toMatchObject({ index: 0, coach: true, coachZone: 'nw' });
  });

  it('continues at a saved word and skips the corner hint', () => {
    const game = setup('Alpha Beta Golf Hotel');
    game.start(0, { index: 2 });
    expect(game.snapshot(0)).toMatchObject({
      status: STATUS.PLAYING,
      index: 2,
      coach: false,
      coachZone: null,
    });
    expect(game.snapshot(0).word.original).toBe('Golf');
    expect(game.press('g', 10)).toBe(true);
    expect(game.snapshot(10)).toMatchObject({ index: 3, score: 100 });
  });

  it('parks a miss as a pause, and Resume moves on', () => {
    const game = setup('Alpha Beta', { freezeSec: 1 });
    game.start(0);
    game.press('z', 10);
    expect(game.status).toBe(STATUS.FROZEN);
    expect(game.settle()).toBe(true);
    expect(game.snapshot(10)).toMatchObject({ status: STATUS.PAUSED, index: 0, misses: 1 });
    game.resume(20);
    expect(game.snapshot(20)).toMatchObject({ status: STATUS.PLAYING, index: 1, misses: 1 });
  });

  it('names the sentence around the current word', () => {
    const game = setup('Alpha Beta. Golf Hotel.');
    game.start(0);
    game.press('a', 10);
    game.pause();
    expect(game.sentenceBounds()).toEqual({ start: 0, end: 2 });
  });
});
