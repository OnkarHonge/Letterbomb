import { sanitizeConfig, DEFAULT_CONFIG } from './config.js';
import { applyFilter, isTerminator, normalizeKey, parseText } from './parseText.js';
import { blankedSentence, buildRecall, recallBounds } from './recall.js';
import { RECALL_BONUS, pointsForHit } from './scoring.js';
import { areaName, zoneForKey, zoneName } from './quadrant.js';
import { pickPhrases, recitalFuseMs, recitalLookMs } from './recital.js';
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
  let frontier = 0;
  let roundWords = 0;
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
  let recall = null;
  let events = [];
  let spots = new Map();
  let spotPhase = null;
  let phraseSpans = [];
  let recital = null;
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

  function spotLive() {
    return config.spotCheck && config.playMode !== 'recital';
  }

  function isSpot(word) {
    return Boolean(spotLive() && word?.isTarget && word.isLong && spots.has(word.id));
  }

  function cueFor(word) {
    return isSpot(word) ? spots.get(word.id) : null;
  }

  function owedKey(word) {
    if (recital && word?.targetChar) return word.targetChar;
    return cueFor(word)?.key ?? word?.targetChar ?? null;
  }

  function spanContaining(target) {
    return phraseSpans.find((span) => target >= span.start && target < span.end) || null;
  }

  function phaseDeadline(word) {
    if (spotPhase === 'reveal') return SPOT_REVEAL_MS;
    if (spotPhase === 'look' && isSpot(word)) return lookFor(word);
    return deadlineFor(word);
  }

  function fillSpots() {
    spots = new Map();
    if (!spotLive()) return;
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

  function openLook(span, at) {
    const phraseWords = words.slice(span.start, span.end);
    opening = Boolean(pendingOpening);
    if (opening) pendingOpening = false;
    const lookMs = recitalLookMs(phraseWords, config, opening);
    recital = { start: span.start, end: span.end, phase: 'look', lookMs };
    index = span.start;
    status = STATUS.PLAYING;
    responded = false;
    missReason = null;
    missedKey = null;
    spotPhase = null;
    wordStartedAt = at;
    deadlineMs = lookMs;
    emit({ type: 'word', index });
  }

  function enterRiff(at, cursor) {
    reach(cursor, true);
    index = cursor;
    recital.phase = 'riff';
    responded = false;
    missReason = null;
    missedKey = null;
    wordStartedAt = at;
    deadlineMs = recitalFuseMs(config);
    emit({ type: 'word', index });
  }

  function beginWord(at) {
    const span = spanContaining(index);
    if (config.playMode === 'recital' && span?.kind === 'phrase' && span.start === index) {
      openLook(span, at);
      return;
    }

    recital = null;
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
    noteCoach(word);
  }

  /**
   * The first three new target words of a fresh run light their corner.
   * Continuing a saved place, a practice word, recital, and a spot check do not.
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
    const eligible = config.playMode === 'words' && word?.isTarget && !isSpot(word);
    if (eligible) {
      coachSeen += 1;
      if (coachSeen <= 3) coachZone = zoneForKey(word.targetChar);
    }
    coachMarks.set(index, coachZone);
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
    recital = null;
    opening = false;
    missReason = null;
    missedKey = null;
    held = false;
    if (config.endQuestion) openRecall();
    else recall = null;
    emit({ type: 'finish', score, maxStreak, recall: Boolean(recall) });
  }

  /**
   * Words before `frontier` were reached, or passed by a jump.
   * Playing them again is practice: no points, and the streak stays.
   * Only a forward step through new words counts toward the breath.
   */
  function reach(upTo, credit) {
    if (upTo <= frontier) return;
    if (credit) roundWords += upTo - frontier;
    frontier = upTo;
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

  function recitalPhrases() {
    return phraseSpans.filter((span) => span.kind === 'phrase');
  }

  function recitalSpanAt(cursor) {
    return recitalPhrases().find((span) => cursor >= span.start && cursor < span.end) || null;
  }

  function recitalStep(dir) {
    const phrases = recitalPhrases();
    if (!phrases.length) return null;
    const current = phrases.findIndex((span) => index >= span.start && index < span.end);
    if (dir > 0) {
      if (current >= 0) return phrases[current + 1]?.start ?? null;
      return phrases.find((span) => span.start > index)?.start ?? null;
    }
    if (current >= 0) {
      if (index > phrases[current].start) return phrases[current].start;
      return phrases[current - 1]?.start ?? null;
    }
    for (let i = phrases.length - 1; i >= 0; i -= 1) {
      if (phrases[i].start < index) return phrases[i].start;
    }
    return null;
  }

  function stepTarget(dir) {
    if (!words[index]) return null;
    if (config.playMode === 'recital') return recitalStep(dir);
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
    const unit = config.playMode === 'recital' ? 'phrase' : 'sentence';
    if (dir > 0) return `Next ${unit}.`;
    const span = config.playMode === 'recital' ? recitalSpanAt(index) : sentenceSpanAt(index);
    const start = span?.start;
    if (start === dest && dest !== index) {
      return config.playMode === 'recital' ? 'Start of this phrase.' : 'Start of this sentence.';
    }
    return `Previous ${unit}.`;
  }

  function roundPlace() {
    const place = index < frontier ? roundWords : roundWords + 1;
    return Math.max(1, place);
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
   * A gap ahead of the furthest word is passed: it does not score and
   * it does not count toward the breath. The breath's start stays put.
   */
  function moveTo(dest, at, { stayPaused, grantOpening }) {
    if (responded && index >= frontier && index < words.length) reach(index + 1, true);
    if (dest > frontier) frontier = dest;
    index = dest;
    responded = false;
    missReason = null;
    missedKey = null;
    held = false;
    spotPhase = null;
    opening = false;
    freezeUntil = 0;
    if (grantOpening) pendingOpening = true;

    const span = config.playMode === 'recital' ? spanContaining(index) : null;
    const phrase = span?.kind === 'phrase' && span.start === index ? span : null;
    if (stayPaused) {
      status = STATUS.PAUSED;
      if (phrase) {
        const lookMs = recitalLookMs(words.slice(phrase.start, phrase.end), config, false);
        recital = { start: phrase.start, end: phrase.end, phase: 'look', lookMs };
        deadlineMs = lookMs;
      } else {
        recital = null;
        deadlineMs = deadlineFor(words[index]);
      }
      return;
    }

    beginWord(at);
  }

  function advance(at) {
    let next = index + 1;
    if (recital?.phase === 'reveal') {
      next = recital.end;
      recital = null;
    }
    const from = index;
    const frontierBefore = frontier;
    reach(next, true);
    if (next >= words.length) {
      index = words.length;
      recital = null;
      finish();
      return;
    }

    index = next;
    const counted = from >= frontierBefore;
    const roundReady = counted && config.roundSize > 0 && roundWords >= config.roundSize;
    if (roundReady && isTerminator(words[next - 1]?.original)) {
      status = STATUS.BREAK;
      responded = false;
      spotPhase = null;
      recital = null;
      opening = false;
      missReason = null;
      missedKey = null;
      openRecall();
      emit({ type: 'break', completed: roundWords, recall: Boolean(recall) });
      return;
    }

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
    if (spotPhase === 'answer') {
      spotPhase = 'reveal';
      wordStartedAt = at;
      deadlineMs = SPOT_REVEAL_MS;
      return;
    }
    if (recital) return;
    if (config.advanceOnHit) advance(at);
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
    words = parseText(raw, config.filter);
    resetStats();
    index = 0;
    roundStartIndex = 0;
    frontier = 0;
    roundWords = 0;
    status = STATUS.IDLE;
    responded = false;
    missReason = null;
    missedKey = null;
    held = false;
    opening = false;
    pendingOpening = false;
    spotPhase = null;
    recital = null;
    phraseSpans = [];
    spots = new Map();
    coachSeen = 0;
    coachZone = null;
    coachMarks = new Map();
    lastPressAt = Number.NEGATIVE_INFINITY;
    epoch += 1;
    emit({ type: 'load', total: words.length });
    return words.length;
  }

  function setConfig(partial) {
    const previousFilter = config.filter;
    config = sanitizeConfig({ ...config, ...partial });
    if (config.filter !== previousFilter) {
      words = applyFilter(words, config.filter);
      epoch += 1;
    }
    if (spotLive() && spots.size === 0 && status !== STATUS.IDLE && status !== STATUS.FINISHED) {
      fillSpots();
    }
    if (!spotLive() && spotPhase && spotPhase !== 'reveal') spotPhase = null;
    if ((status === STATUS.PLAYING || status === STATUS.PAUSED) && words[index]) {
      if (recital?.phase === 'look') {
        const lookMs = recitalLookMs(words.slice(recital.start, recital.end), config, opening);
        recital.lookMs = lookMs;
        deadlineMs = lookMs;
      } else if (recital?.phase === 'riff') {
        deadlineMs = recitalFuseMs(config);
      } else {
        deadlineMs = phaseDeadline(words[index]);
      }
    }
    return { ...config };
  }

  function start(at = now(), options = {}) {
    if (!words.length) return false;
    if (recallLocked()) return false;
    if (status !== STATUS.IDLE && status !== STATUS.FINISHED) return false;
    resetStats();
    const requested = Number(options?.index);
    const dest = Number.isInteger(requested) && requested > 0 && requested < words.length
      ? requested
      : 0;
    index = dest;
    roundStartIndex = dest;
    frontier = dest;
    coachSeen = dest > 0 ? 3 : 0;
    coachZone = null;
    coachMarks = new Map();
    roundWords = 0;
    held = false;
    missReason = null;
    missedKey = null;
    lastPressAt = Number.NEGATIVE_INFINITY;
    spots = new Map();
    spotPhase = null;
    recital = null;
    phraseSpans = pickPhrases(words);
    if (spotLive()) fillSpots();
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
    if (recital?.phase === 'riff') {
      status = STATUS.PLAYING;
      wordStartedAt = at;
      deadlineMs = recitalFuseMs(config);
      return true;
    }
    if (recital?.phase === 'look') {
      status = STATUS.PLAYING;
      if (pendingOpening) {
        opening = true;
        pendingOpening = false;
      }
      const lookMs = recitalLookMs(words.slice(recital.start, recital.end), config, opening);
      recital.lookMs = lookMs;
      wordStartedAt = at;
      deadlineMs = lookMs;
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
    roundWords = 0;
    pendingOpening = true;
    beginWord(at);
    return true;
  }

  function jumpTo(target) {
    if (status !== STATUS.PAUSED) return false;
    const nextIndex = Number(target);
    if (!Number.isInteger(nextIndex) || nextIndex < 0 || nextIndex >= words.length) return false;
    const span = config.playMode === 'recital' ? spanContaining(nextIndex) : null;
    const dest = span?.kind === 'phrase' ? span.start : nextIndex;
    moveTo(dest, now(), { stayPaused: true, grantOpening: false });
    emit({ type: 'jump', index });
    return true;
  }

  /**
   * Left restarts the current sentence, then steps to the previous one.
   * Right skips to the next sentence. Recital uses phrases instead.
   * The landing word starts clean, with the opening pause on its first target.
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
    const word = words[index];
    if (recital?.phase === 'look') {
      if (at - wordStartedAt >= deadlineMs) return false;
      const key = normalizeKey(raw);
      const expected = words[recital.start]?.targetChar;
      if (!key || key !== expected) return false;
      if (at - lastPressAt < INPUT_LOCK_MS) return false;
      lastPressAt = at;
      hit(at, 0);
      if (recital.end - recital.start <= 1) {
        recital = null;
        advance(at);
      } else {
        enterRiff(at, recital.start + 1);
      }
      return true;
    }
    if (recital?.phase === 'riff') {
      if (at - lastPressAt < INPUT_LOCK_MS) return false;
      if (!word?.targetChar || responded) return false;
      if (at - wordStartedAt >= deadlineMs) return false;
      const key = normalizeKey(raw);
      if (!key) return false;
      lastPressAt = at;
      if (key === word.targetChar) {
        hit(at);
        if (index + 1 >= recital.end) {
          recital = null;
          advance(at);
        } else {
          enterRiff(at, index + 1);
        }
      } else {
        recital.phase = 'reveal';
        miss('wrong', at, key);
      }
      return true;
    }
    if (at - lastPressAt < INPUT_LOCK_MS) return false;
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

  function pressArea(zone, at = now()) {
    if (status !== STATUS.PLAYING || recital) return false;
    const name = zoneName(zone);
    if (!name) return false;
    const word = words[index];
    if (at - lastPressAt < INPUT_LOCK_MS) return false;
    if (!word?.isTarget || responded) return false;
    if (spotPhase === 'look' || spotPhase === 'reveal') return false;
    if (at - wordStartedAt >= deadlineMs) return false;
    const expected = spotPhase === 'answer' ? cueFor(word)?.key : word.targetChar;
    const wanted = zoneForKey(expected);
    if (!wanted) return false;
    lastPressAt = at;
    if (zone === wanted) hit(at);
    else miss('wrong', at, areaName(zone, expected));
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
      if (recital?.phase === 'look') {
        enterRiff(at, recital.start);
        return;
      }
      if (recital?.phase === 'riff') {
        recital.phase = 'reveal';
        miss('timeout', at, null);
        return;
      }
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
    if (recital) {
      if (recital.phase === 'riff') return null;
      return word?.targetChar ?? null;
    }
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

  function recitalView() {
    if (!recital) return null;
    return {
      phase: recital.phase,
      start: recital.start,
      end: recital.end,
      length: recital.end - recital.start,
      place: index - recital.start + 1,
    };
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
      roundWords,
      roundPlace: roundPlace(),
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
      answer: snapshotAnswer(word),
      coach: Boolean(coachZone),
      coachZone,
      spot: spotView(word),
      recital: recitalView(),
      isTarget: Boolean(recital ? word?.targetChar : word?.isTarget),
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
    answerRecall,
    acknowledgeRecall,
    recallLocked,
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
