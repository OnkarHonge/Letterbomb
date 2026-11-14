import { describe, expect, it } from 'vitest';
import { PACE_PRESETS, pacePatch } from '../src/engine/config.js';
import { createGame, STATUS } from '../src/engine/game.js';
import { wordDeadlineMs } from '../src/engine/timing.js';

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

  

  

  

  

  

  

  it('reads to the end when no full stop arrives after the round length', () => {
    const game = setup('One two three', { roundSize: 1 });
    game.start(0);
    pressLetters(game, ['o', 't', 't']);
    expect(game.status).toBe(STATUS.FINISHED);
    expect(game.consumeEvents().some((event) => event.type === 'break')).toBe(false);
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

  

  it('gives a sentence ending the longer Linger window', () => {
    const game = setup('Idea.', { roundSize: 0, punctuationMultiplier: 1.5 });
    game.setConfig(pacePatch(PACE_PRESETS.linger));
    game.start(0);
    expect(game.snapshot(0).deadlineMs).toBe(9800);
    game.tick(9799);
    expect(game.snapshot(9799)).toMatchObject({ status: STATUS.PLAYING, index: 0 });
  });

  
});

describe('opening pause', () => {
  

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

  

  it('treats a return as practice and still scores the new word', () => {
    const game = setup(PIECE);
    game.start(0);
    game.press('a', 20);
    game.press('b', 60);
    game.press('g', 100);
    game.pause();
    game.stepSentence(-1, 120);
    game.resume(130);
    expect(game.snapshot(120)).toMatchObject({ index: 0, score: 300, streak: 3, hits: 3 });

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
});

describe('the board changes', () => {
  it('lights the corner for the first three target words', () => {
    const game = setup('Alpha Beta Golf Hotel');
    game.start(0);
    expect(game.snapshot(0)).toMatchObject({ coach: true, coachZone: 'nw', answer: 'A' });
    game.press('a', 40);
    expect(game.snapshot(40)).toMatchObject({ coach: true, coachZone: 'nw', index: 1 });
    game.press('b', 80);
    game.press('g', 120);
    expect(game.snapshot(120)).toMatchObject({
      coach: false,
      coachZone: null,
      index: 3,
      answer: 'H',
    });
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
