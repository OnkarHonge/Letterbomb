import { sanitizeConfig, DEFAULT_CONFIG } from './config.js';
import { isTerminator, normalizeKey, parseText } from './parseText.js';
import { areaName, zoneForKey, zoneName } from './quadrant.js';
import { pointsForHit } from './scoring.js';
import { wordDeadlineMs } from './timing.js';

/**
 * ReflexRead rules and clock. The page paints snapshots and sends keys.
 * Pass `at` from performance.now() or a test. Time only moves inside tick(),
 * and only while status is playing or frozen.
 *
 * A hit moves on immediately. The owed letter stays out of the snapshot's
 * job for the banner: `answer` is the letter a miss can name.
 */
export const STATUS = {
  IDLE: 'idle',
  PLAYING: 'playing',
  PAUSED: 'paused',
  FROZEN: 'frozen',
  FINISHED: 'finished',
};

const INPUT_LOCK_MS = 35;

export function createGame({ now = () => 0 } = {}) {
  let config = { ...DEFAULT_CONFIG };
  let words = [];
  let labelText = 'Article';
  let status = STATUS.IDLE;
  let index = 0;
  let frontier = 0;
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
  let ascent = 0;
  let maxStreak = 0;
  let hits = 0;
  let misses = 0;
  let reactionTimes = [];
  let events = [];
  let coachSeen = 0;
  let coachZone = null;
  let coachMarks = new Map();

  function emit(event) {
    events.push(event);
  }

  function resetStats() {
    score = 0;
    streak = 0;
    ascent = 0;
    maxStreak = 0;
    hits = 0;
    misses = 0;
    reactionTimes = [];
  }

  function withOpening(word) {
    if (!opening || !word) return word;
    return { ...word, isOpening: true };
  }

  function deadlineFor(word) {
    return wordDeadlineMs(withOpening(word), config);
  }

  function owedKey(word) {
    return word?.targetChar ?? null;
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
    deadlineMs = deadlineFor(word);
    emit({ type: 'word', index });
    noteCoach(word);
  }

  /**
   * The first three new target words of a fresh run light their corner.
   * Continuing a saved place, and a practice word, do not.
   * Pausing and resuming the same word keeps the hint it already had.
   * This hint never reveals the letter.
   */
  function noteCoach(word) {
    if (index < frontier) {
      coachZone = null;
      return;
    }
    if (coachMarks.has(index)) {
      coachZone = coachMarks.get(index);
      return;
    }
    coachZone = null;
    if (word?.isTarget) {
      coachSeen += 1;
      if (coachSeen <= 3) coachZone = zoneForKey(word.targetChar);
    }
    coachMarks.set(index, coachZone);
  }

  function finish() {
    status = STATUS.FINISHED;
    responded = false;
    opening = false;
    missReason = null;
    missedKey = null;
    held = false;
    emit({ type: 'finish', score, maxStreak });
  }

  /**
   * Words before `frontier` were reached, or passed by a jump.
   * Playing them again is practice: no points, and the streak stays.
   */
  function reach(upTo) {
    if (upTo > frontier) frontier = upTo;
  }

  function sentenceSpanAt(cursor) {
    let start = cursor;
    while (start > 0 && !words[start].breakBefore && !isTerminator(words[start - 1].original)) {
      start -= 1;
    }
    let end = cursor;
    while (
      end + 1 < words.length
      && !isTerminator(words[end].original)
      && !words[end + 1].breakBefore
    ) {
      end += 1;
    }
    return { start, end };
  }

  function stepTarget(dir) {
    if (!words[index]) return null;
    const span = sentenceSpanAt(index);
    if (dir > 0) {
      const next = span.end + 1;
      return next < words.length ? next : null;
    }
    if (index > span.start) return span.start;
    if (span.start === 0) return null;
    return sentenceSpanAt(span.start - 1).start;
  }

  function stepLine(dir, dest) {
    if (dir > 0) return 'Next sentence.';
    const span = sentenceSpanAt(index);
    if (span.start === dest && dest !== index) return 'Start of this sentence.';
    return 'Previous sentence.';
  }

  function stepOptions() {
    const allowed = status === STATUS.PAUSED;
    if (!allowed || index < 0 || index >= words.length) {
      return { previous: false, next: false };
    }
    return {
      previous: stepTarget(-1) != null,
      next: stepTarget(1) != null,
    };
  }

  /**
   * Land on `dest` with a full timer.
   * A gap ahead of the furthest word is passed: it does not score.
   */
  function moveTo(dest, at, { stayPaused, grantOpening }) {
    if (responded && index >= frontier && index < words.length) reach(index + 1);
    if (dest > frontier) frontier = dest;
    index = dest;
    responded = false;
    missReason = null;
    missedKey = null;
    held = false;
    opening = false;
    freezeUntil = 0;
    if (grantOpening) pendingOpening = true;

    if (stayPaused) {
      status = STATUS.PAUSED;
      deadlineMs = deadlineFor(words[index]);
      return;
    }

    beginWord(at);
  }

  function advance(at) {
    const next = index + 1;
    reach(next);
    if (next >= words.length) {
      index = words.length;
      finish();
      return;
    }

    index = next;
    beginWord(at);
  }

  function hit(at, reactionOverride) {
    const practice = index < frontier;
    const reaction = reactionOverride !== undefined
      ? reactionOverride
      : Math.max(0, Math.round(at - wordStartedAt));
    let points = 0;
    if (!practice) {
      streak += 1;
      if (streak > maxStreak) maxStreak = streak;
      ascent += 1;
      hits += 1;
      reactionTimes.push(reaction);
      points = pointsForHit(streak);
      score += points;
    }
    responded = true;
    const sentenceEnd = !practice && isTerminator(words[index]?.original);
    emit({
      type: 'hit',
      points,
      reaction,
      streak,
      score,
      maxStreak,
      ascent,
      sentenceEnd,
      practice,
    });
    if (sentenceEnd) {
      emit({ type: 'milestone', ascent });
      ascent = 0;
    }
    advance(at);
  }

  function miss(reason, at, pressed) {
    const practice = index < frontier;
    if (!practice) {
      misses += 1;
      streak = 0;
      ascent = 0;
    }
    responded = true;
    missReason = reason;
    missedKey = pressed;
    emit({
      type: 'miss',
      reason,
      answer: owedKey(words[index]),
      pressed,
      practice,
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
    words = parseText(raw);
    resetStats();
    index = 0;
    frontier = 0;
    status = STATUS.IDLE;
    responded = false;
    missReason = null;
    missedKey = null;
    held = false;
    opening = false;
    pendingOpening = false;
    lastPressAt = Number.NEGATIVE_INFINITY;
    coachSeen = 0;
    coachZone = null;
    coachMarks = new Map();
    epoch += 1;
    emit({ type: 'load', total: words.length });
    return words.length;
  }

  function setConfig(partial) {
    config = sanitizeConfig({ ...config, ...partial });
    if ((status === STATUS.PLAYING || status === STATUS.PAUSED) && words[index]) {
      deadlineMs = deadlineFor(words[index]);
    }
    return { ...config };
  }

  function start(at = now(), options = {}) {
    if (!words.length) return false;
    if (status !== STATUS.IDLE && status !== STATUS.FINISHED) return false;
    resetStats();
    const requested = Number(options?.index);
    const dest = Number.isInteger(requested) && requested > 0 && requested < words.length
      ? requested
      : 0;
    index = dest;
    frontier = dest;
    coachSeen = dest > 0 ? 3 : 0;
    coachZone = null;
    coachMarks = new Map();
    held = false;
    missReason = null;
    missedKey = null;
    lastPressAt = Number.NEGATIVE_INFINITY;
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

  /**
   * Leave a live word paused. A miss that was waiting out its freeze
   * stays answered, so Resume moves on instead of replaying it.
   */
  function settle() {
    if (status === STATUS.PLAYING) return pause();
    if (status !== STATUS.FROZEN) return false;
    status = STATUS.PAUSED;
    held = false;
    freezeUntil = 0;
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
    if (opening) pendingOpening = true;
    beginWord(at);
    return true;
  }

  function cover() {
    pendingOpening = true;
  }

  function jumpTo(target) {
    if (status !== STATUS.PAUSED) return false;
    const nextIndex = Number(target);
    if (!Number.isInteger(nextIndex) || nextIndex < 0 || nextIndex >= words.length) return false;
    moveTo(nextIndex, now(), { stayPaused: true, grantOpening: false });
    emit({ type: 'jump', index });
    return true;
  }

  /**
   * Left restarts the current sentence, then steps to the previous one.
   * Right skips to the next sentence.
   * The landing word stays paused, with the opening pause ready for Resume.
   */
  function stepSentence(direction, at = now()) {
    if (status !== STATUS.PAUSED) return false;
    if (!Number.isFinite(direction) || direction === 0) return false;
    if (index < 0 || index >= words.length) return false;
    const dir = direction < 0 ? -1 : 1;
    const dest = stepTarget(dir);
    if (dest == null || dest === index) return false;
    const line = stepLine(dir, dest);
    moveTo(dest, at, { stayPaused: true, grantOpening: true });
    emit({ type: 'step', direction: dir, index, line });
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

  function press(raw, at = now()) {
    if (status !== STATUS.PLAYING) return false;
    if (at - lastPressAt < INPUT_LOCK_MS) return false;
    const word = words[index];
    if (!word?.isTarget || responded) return false;
    if (at - wordStartedAt >= deadlineMs) return false;
    const key = normalizeKey(raw);
    if (!key || !word.targetChar) return false;
    lastPressAt = at;
    if (key === word.targetChar) hit(at);
    else miss('wrong', at, key);
    return true;
  }

  function pressArea(zone, at = now()) {
    if (status !== STATUS.PLAYING) return false;
    const name = zoneName(zone);
    if (!name) return false;
    const word = words[index];
    if (at - lastPressAt < INPUT_LOCK_MS) return false;
    if (!word?.isTarget || responded) return false;
    if (at - wordStartedAt >= deadlineMs) return false;
    const wanted = zoneForKey(word.targetChar);
    if (!wanted) return false;
    lastPressAt = at;
    if (zone === wanted) hit(at);
    else miss('wrong', at, areaName(zone, word.targetChar));
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
      if (word.isTarget && !responded) miss('timeout', at, null);
      else advance(at);
    }
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
      step: stepOptions(),
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
      answer: word?.isTarget ? word.targetChar : null,
      isTarget: Boolean(word?.isTarget),
      responded,
      missReason,
      missedKey,
      freezeLeftMs,
      coach: coachZone != null,
      coachZone,
      articleLabel: labelText,
      word,
      config: { ...config },
    };
  }

  return {
    load,
    setConfig,
    start,
    pause,
    resume,
    cover,
    jumpTo,
    stepSentence,
    settle,
    sentenceBounds() {
      const cursor = index >= words.length ? words.length - 1 : index;
      if (!words[cursor]) return null;
      const span = sentenceSpanAt(cursor);
      return { start: span.start, end: span.end + 1 };
    },
    hold,
    release,
    press,
    pressArea,
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
