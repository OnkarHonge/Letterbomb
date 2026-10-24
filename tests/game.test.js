import { describe, expect, it } from 'vitest';
import { PACE_PRESETS, pacePatch } from '../src/engine/config.js';
import { createGame, STATUS } from '../src/engine/game.js';
import { recallBounds, selectTarget } from '../src/engine/recall.js';
import { RECALL_BONUS } from '../src/engine/scoring.js';
import { SPOT_REVEAL_MS } from '../src/engine/spot.js';
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

  it('moves on from a learning pace as soon as the letter is right', () => {
    const game = setup('Concept is', { advanceOnHit: false, roundSize: 0 });
    game.setConfig(pacePatch(PACE_PRESETS.study));
    expect(game.config.advanceOnHit).toBe(true);

    game.start(0);
    expect(game.snapshot(0).deadlineMs).toBe(3800);
    expect(game.press('c', 250)).toBe(true);
    expect(game.snapshot(250)).toMatchObject({ status: STATUS.PLAYING, index: 1, hits: 1 });
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
    const game = setup('Alpha Beta', { advanceOnHit: false, roundSize: 0 });
    game.setConfig(pacePatch(PACE_PRESETS.warmup));
    expect(game.config.advanceOnHit).toBe(false);
    expect(game.config).toMatchObject({
      wpm: PACE_PRESETS.warmup.wpm,
      forgivenessMs: PACE_PRESETS.warmup.forgivenessMs,
      showTargetHud: PACE_PRESETS.warmup.showTargetHud,
    });

    game.start(0);
    expect(game.press('a', 40)).toBe(true);
    expect(game.snapshot(40)).toMatchObject({ status: STATUS.PLAYING, index: 0, hits: 1 });
  });
});

describe('opening pause', () => {
  it('gives the first word a longer window after Start, a breath, and Read again', () => {
    const game = setup('Go Go Go Go', { openingMultiplier: 2, roundSize: 2 });
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
    const game = setup('Go Go the Alpha', { filter: 'capital', openingMultiplier: 2, roundSize: 2 });
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
    const game = setup('Word Beta', { spotCheck: true, spotLookMs: 200, roundSize: 1 });
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
