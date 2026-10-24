import { sanitizeConfig, DEFAULT_CONFIG } from './config.js';
import { applyFilter, normalizeKey, parseText } from './parseText.js';
import { blankedSentence, buildRecall, recallBounds } from './recall.js';
import { RECALL_BONUS, pointsForHit } from './scoring.js';
import { SPOT_REVEAL_MS, pickCue, pickSpotIds, spotLookMs } from './spot.js';
import { wordDeadlineMs } from './timing.js';

/**
 * ReflexRead rules and clock. The page paints snapshots and sends keys.
 * Pass `at` from performance.now() or a test. Time only moves inside tick(),
 * and only while status is playing or frozen.
 *
 * Add a mechanic here, with a test, before wiring it to the DOM.
 */
export const STATUS = {
  IDLE: 'idle',
  PLAYING: 'playing',
  PAUSED: 'paused',
  FROZEN: 'frozen',
  BREAK: 'break',
  FINISHED: 'finished',
};

const INPUT_LOCK_MS = 35;

export function createGame({ now = () => 0, random = Math.random } = {}) {
  let config = { ...DEFAULT_CONFIG };
  let words = [];
  let labelText = 'Article';
  let status = STATUS.IDLE;
  let index = 0;
  let roundStartIndex = 0;
  let wordStartedAt = 0;
  let deadlineMs = 0;
  let responded = false;
  let opening = false;
  let pendingOpening = false;
  let missReason = null;
  let missedKey = null;
  let freezeUntil = 0;
  let freezeRemaining = 0;
  let held = false;
  let lastPressAt = Number.NEGATIVE_INFINITY;
  let epoch = 0;
  let score = 0;
  let streak = 0;
  let maxStreak = 0;
  let hits = 0;
  let misses = 0;
  let reactionTimes = [];
  let recall = null;
  let events = [];
  let spots = new Map();
  let spotPhase = null;

  function emit(event) {
    events.push(event);
  }

  function resetStats() {
    score = 0;
    streak = 0;
    maxStreak = 0;
    hits = 0;
    misses = 0;
    reactionTimes = [];
    recall = null;
  }

  function withOpening(word) {
    if (!opening || !word) return word;
    return { ...word, isOpening: true };
  }

  function deadlineFor(word) {
    return wordDeadlineMs(withOpening(word), config);
  }

  function lookFor(word) {
    return spotLookMs(withOpening(word), config);
  }

  function isSpot(word) {
    return Boolean(config.spotCheck && word?.isTarget && word.isLong && spots.has(word.id));
  }

  function cueFor(word) {
    return isSpot(word) ? spots.get(word.id) : null;
  }

  function owedKey(word) {
    return cueFor(word)?.key ?? word?.targetChar ?? null;
  }

  function phaseDeadline(word) {
    if (spotPhase === 'reveal') return SPOT_REVEAL_MS;
    if (spotPhase === 'look' && isSpot(word)) return lookFor(word);
    return deadlineFor(word);
  }

  function fillSpots() {
    spots = new Map();
    if (!config.spotCheck) return;
    for (const id of pickSpotIds(words, random)) {
      const word = words[id];
      if (!word || word.id !== id) continue;
      const cue = pickCue(word.original, random);
      if (!cue) continue;
      spots.set(id, { index: cue.index, key: cue.key });
    }
  }

  function enterAnswer(at) {
    spotPhase = 'answer';
    wordStartedAt = at;
    deadlineMs = deadlineFor(words[index]);
  }

  function beginWord(at) {
    status = STATUS.PLAYING;
    responded = false;
    missReason = null;
    missedKey = null;
    wordStartedAt = at;
    const word = words[index];
    opening = Boolean(word?.isTarget && pendingOpening);
    if (opening) pendingOpening = false;
    if (isSpot(word)) {
      spotPhase = 'look';
      deadlineMs = lookFor(word);
    } else {
      spotPhase = null;
      deadlineMs = deadlineFor(word);
    }
    emit({ type: 'word', index });
  }

  function openRecall() {
    const bounds = recallBounds(words, roundStartIndex, index);
    recall = buildRecall(words, bounds.start, bounds.end, random);
  }

  function recallLocked() {
    return Boolean(recall && recall.phase !== 'ready');
  }

  function finish() {
    status = STATUS.FINISHED;
    responded = false;
    spotPhase = null;
    opening = false;
    missReason = null;
    missedKey = null;
    held = false;
    openRecall();
    emit({ type: 'finish', score, maxStreak, recall: Boolean(recall) });
  }

  function advance(at) {
    const next = index + 1;
    if (next >= words.length) {
      index = words.length;
      finish();
      return;
    }

    const doneInRound = next - roundStartIndex;
    index = next;
    if (config.roundSize > 0 && doneInRound >= config.roundSize) {
      status = STATUS.BREAK;
      responded = false;
      spotPhase = null;
      opening = false;
      missReason = null;
      missedKey = null;
      openRecall();
      emit({ type: 'break', completed: doneInRound, recall: Boolean(recall) });
      return;
    }

    beginWord(at);
  }

  function hit(at) {
    const reaction = Math.max(0, Math.round(at - wordStartedAt));
    streak += 1;
    if (streak > maxStreak) maxStreak = streak;
    hits += 1;
    reactionTimes.push(reaction);
    const points = pointsForHit(streak);
    score += points;
    responded = true;
    emit({ type: 'hit', points, reaction, streak, score, maxStreak });
    if (streak % 10 === 0) emit({ type: 'milestone', streak });
    if (spotPhase === 'answer') {
      spotPhase = 'reveal';
      wordStartedAt = at;
      deadlineMs = SPOT_REVEAL_MS;
      return;
    }
    if (config.advanceOnHit) advance(at);
  }

  function miss(reason, at, pressed) {
    misses += 1;
    streak = 0;
    responded = true;
    missReason = reason;
    missedKey = pressed;
    emit({
      type: 'miss',
      reason,
      answer: owedKey(words[index]),
      pressed,
    });

    const freezeMs = Math.round(Math.max(0, config.freezeSec) * 1000);
    if (freezeMs <= 0) {
      advance(at);
      return;
    }

    status = STATUS.FROZEN;
    freezeUntil = at + freezeMs;
    held = false;
  }

  function load(raw, label = 'Custom') {
    labelText = label || 'Custom';
    words = parseText(raw, config.filter);
    resetStats();
    index = 0;
    roundStartIndex = 0;
    status = STATUS.IDLE;
    responded = false;
    missReason = null;
    missedKey = null;
    held = false;
    opening = false;
    pendingOpening = false;
    spotPhase = null;
    spots = new Map();
    lastPressAt = Number.NEGATIVE_INFINITY;
    epoch += 1;
    emit({ type: 'load', total: words.length });
    return words.length;
  }

  function setConfig(partial) {
    const previousFilter = config.filter;
    const wasSpot = config.spotCheck;
    config = sanitizeConfig({ ...config, ...partial });
    if (config.filter !== previousFilter) {
      words = applyFilter(words, config.filter);
      epoch += 1;
    }
    if (
      config.spotCheck
      && !wasSpot
      && spots.size === 0
      && status !== STATUS.IDLE
      && status !== STATUS.FINISHED
    ) {
      fillSpots();
    }
    if (!config.spotCheck && spotPhase && spotPhase !== 'reveal') spotPhase = null;
    if ((status === STATUS.PLAYING || status === STATUS.PAUSED) && words[index]) {
      deadlineMs = phaseDeadline(words[index]);
    }
    return { ...config };
  }

  function start(at = now()) {
    if (!words.length) return false;
    if (recallLocked()) return false;
    if (status !== STATUS.IDLE && status !== STATUS.FINISHED) return false;
    resetStats();
    index = 0;
    roundStartIndex = 0;
    held = false;
    missReason = null;
    missedKey = null;
    lastPressAt = Number.NEGATIVE_INFINITY;
    spots = new Map();
    spotPhase = null;
    if (config.spotCheck) fillSpots();
    emit({ type: 'start' });
    pendingOpening = true;
    beginWord(at);
    return true;
  }

  function pause() {
    if (status !== STATUS.PLAYING) return false;
    status = STATUS.PAUSED;
    emit({ type: 'pause' });
    return true;
  }

  function resume(at = now()) {
    if (status !== STATUS.PAUSED) return false;
    emit({ type: 'resume' });
    if (index >= words.length) {
      finish();
      return true;
    }
    if (responded) {
      advance(at);
      return true;
    }
    const word = words[index];
    if (spotPhase === 'answer' && isSpot(word)) {
      if (pendingOpening) {
        opening = true;
        pendingOpening = false;
      }
      status = STATUS.PLAYING;
      wordStartedAt = at;
      deadlineMs = deadlineFor(word);
      return true;
    }
    if (opening) pendingOpening = true;
    beginWord(at);
    return true;
  }

  function cover() {
    pendingOpening = true;
  }

  function continueRound(at = now()) {
    if (status !== STATUS.BREAK) return false;
    if (recallLocked()) return false;
    recall = null;
    if (index >= words.length) {
      finish();
      return true;
    }
    roundStartIndex = index;
    pendingOpening = true;
    beginWord(at);
    return true;
  }

  function jumpTo(target) {
    if (status !== STATUS.PAUSED) return false;
    const nextIndex = Number(target);
    if (!Number.isInteger(nextIndex) || nextIndex < 0 || nextIndex >= words.length) return false;
    index = nextIndex;
    roundStartIndex = nextIndex;
    responded = false;
    missReason = null;
    missedKey = null;
    opening = false;
    spotPhase = null;
    deadlineMs = deadlineFor(words[index]);
    emit({ type: 'jump', index });
    return true;
  }

  function hold(at = now()) {
    if (status !== STATUS.FROZEN || held) return false;
    freezeRemaining = Math.max(0, freezeUntil - at);
    held = true;
    return true;
  }

  function release(at = now()) {
    if (!held) return false;
    freezeUntil = at + freezeRemaining;
    held = false;
    return true;
  }

  function answerRecall(choiceId) {
    if (!recall || recall.phase !== 'ask') return false;
    const id = Number(choiceId);
    const choice = recall.choices.find((item) => item.id === id);
    if (!choice) return false;

    if (choice.correct) {
      score += RECALL_BONUS;
      recall.phase = 'ready';
      recall.correct = true;
      recall.points = RECALL_BONUS;
      emit({ type: 'recall-hit', points: RECALL_BONUS, score, maxStreak });
      return true;
    }

    recall.phase = 'reveal';
    recall.correct = false;
    recall.points = 0;
    emit({ type: 'recall-miss' });
    return true;
  }

  function acknowledgeRecall() {
    if (!recall || recall.phase !== 'reveal') return false;
    recall.phase = 'ready';
    emit({ type: 'recall-ready' });
    return true;
  }

  function press(raw, at = now()) {
    if (status !== STATUS.PLAYING) return false;
    if (at - lastPressAt < INPUT_LOCK_MS) return false;
    const word = words[index];
    if (!word?.isTarget || responded) return false;
    if (spotPhase === 'look' || spotPhase === 'reveal') return false;
    if (at - wordStartedAt >= deadlineMs) return false;
    const key = normalizeKey(raw);
    if (!key) return false;
    const expected = spotPhase === 'answer' ? cueFor(word)?.key : word.targetChar;
    if (!expected) return false;
    lastPressAt = at;
    if (key === expected) hit(at);
    else miss('wrong', at, key);
    return true;
  }

  function tick(at = now()) {
    if (held) return;
    if (!words.length) return;

    if (status === STATUS.FROZEN) {
      if (at >= freezeUntil) advance(at);
      return;
    }

    if (status !== STATUS.PLAYING) return;
    if (!words[index]) {
      finish();
      return;
    }

    if (at - wordStartedAt >= deadlineMs) {
      const word = words[index];
      if (spotPhase === 'look') {
        enterAnswer(at);
        return;
      }
      if (spotPhase === 'reveal') {
        advance(at);
        return;
      }
      if (word.isTarget && !responded) miss('timeout', at, null);
      else advance(at);
    }
  }

  function snapshotAnswer(word) {
    if (!word?.isTarget) return null;
    if (isSpot(word) && spotPhase) {
      if (spotPhase === 'reveal' || status === STATUS.FROZEN) return spots.get(word.id).key;
      return null;
    }
    return word.targetChar;
  }

  function spotView(word) {
    if (!spotPhase || !isSpot(word)) return null;
    const cue = spots.get(word.id);
    if (!cue) return null;
    return { phase: spotPhase, cueIndex: cue.index };
  }

  function snapshot(at = now()) {
    const word = words[index] || null;
    const total = words.length;
    let progress = 0;
    if (status === STATUS.PLAYING && deadlineMs > 0) {
      progress = clamp01((at - wordStartedAt) / deadlineMs);
    } else if (status === STATUS.FROZEN) {
      progress = 1;
    }

    const attempts = hits + misses;
    let freezeLeftMs = 0;
    if (status === STATUS.FROZEN) {
      freezeLeftMs = held ? freezeRemaining : Math.max(0, freezeUntil - at);
    }

    return {
      status,
      epoch,
      index,
      total,
      roundSize: config.roundSize,
      roundStart: roundStartIndex,
      progress,
      deadlineMs,
      score,
      streak,
      maxStreak,
      hits,
      misses,
      accuracy: attempts ? Math.round((hits / attempts) * 100) : null,
      avgReaction: reactionTimes.length
        ? Math.round(reactionTimes.reduce((sum, value) => sum + value, 0) / reactionTimes.length)
        : null,
      answer: snapshotAnswer(word),
      spot: spotView(word),
      isTarget: Boolean(word?.isTarget),
      responded,
      missReason,
      missedKey,
      freezeLeftMs,
      articleLabel: labelText,
      word,
      recall: publicRecall(),
      config: { ...config },
    };
  }

  function publicRecall() {
    if (!recall) return null;
    return {
      phase: recall.phase,
      choices: recall.choices.map(({ id, label }) => ({ id, label })),
      sentence: recall.phase === 'ask'
        ? blankedSentence(recall.sentence)
        : recall.phase === 'reveal'
          ? recall.sentence
          : null,
      correct: recall.correct,
      points: recall.points,
    };
  }

  return {
    load,
    setConfig,
    start,
    pause,
    resume,
    cover,
    continueRound,
    jumpTo,
    hold,
    release,
    answerRecall,
    acknowledgeRecall,
    recallLocked,
    press,
    tick,
    snapshot,
    consumeEvents() {
      const batch = events;
      events = [];
      return batch;
    },
    get status() {
      return status;
    },
    get held() {
      return held;
    },
    get words() {
      return words;
    },
    get config() {
      return { ...config };
    },
  };
}

function clamp01(value) {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}
