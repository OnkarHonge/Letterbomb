import { matchingPace, PACE_PRESETS } from '../engine/config.js';
import { missLine } from '../engine/quadrant.js';
import { must, setText } from './dom.js';
import {
  advanceScroll,
  beginScroll,
  nextLineUnder,
  scrollTopForReadingLine,
  scrollWasTaken,
} from './scroll.js';

/** The pace name for the line that stays up in full screen. */
export function paceLabel(config) {
  const id = matchingPace(config || {});
  return id ? PACE_PRESETS[id].label : 'Custom';
}

/** Seconds still on the clock, for the line that stays up in full screen. */
export function secondsLeftLabel(snap) {
  let ms = null;
  if (snap.status === 'frozen') ms = snap.freezeLeftMs;
  else if (snap.status === 'playing') ms = snap.deadlineMs * (1 - Number(snap.progress) || 0);
  else if (snap.status === 'paused' && snap.deadlineMs) ms = snap.deadlineMs;
  if (ms == null || !Number.isFinite(ms)) return '';
  const seconds = Math.max(0, ms / 1000);
  return seconds >= 10 ? `${Math.round(seconds)}s` : `${seconds.toFixed(1)}s`;
}

/** Which corner guides to draw while a run or the drill is active. */
export function cornerBoard({ showCornerLabels, showCornerGrid, active }) {
  const labels = Boolean(active && showCornerLabels);
  const grid = Boolean(active && showCornerGrid);
  return { board: labels || grid, labels, grid };
}

export function missRule(freezeSec) {
  return freezeSec > 0
    ? 'Hits build a streak. A miss freezes the board, then you continue.'
    : 'Hits build a streak. A miss moves straight on.';
}

export function pauseRule(responded) {
  if (responded) {
    return 'That letter already counted. Resume moves on. Click a word to move the highlight.';
  }
  return 'This word starts fresh when you resume. Click a word to move the highlight.';
}

export function stepHint() {
  return 'Left arrow restarts this sentence, then steps to the previous one. Right arrow skips to the next sentence. Previous and Next above the text do the same.';
}

/** A wide space is named Pause. A dash stays visible and is still a gap. */
export function wordMarks(word) {
  const gap = Boolean(word?.isGap);
  const pass = Boolean(word) && !word.isTarget;
  const classes = ['word'];
  if (pass) classes.push('is-pass');
  if (gap) classes.push('is-gap');
  const wide = gap && /^\s+$/.test(String(word?.original ?? ''));
  return {
    className: classes.join(' '),
    pass,
    gap,
    label: wide ? 'Pause' : '',
  };
}

function fillWord(node, word) {
  node.replaceChildren();
  node.removeAttribute('aria-label');
  if (!word) return;
  if (!word.displayChar) {
    node.textContent = word.original;
    const { label } = wordMarks(word);
    if (label) node.setAttribute('aria-label', label);
    return;
  }
  node.append(word.before);
  const mark = document.createElement('span');
  mark.className = 'first';
  mark.textContent = word.displayChar;
  node.append(mark, word.after);
}

export function createPainter() {
  const arena = must('arena');
  const karaoke = must('karaoke');
  const timer = must('timer');
  const timerFill = must('timer-fill');
  const strike = must('strike');
  const strikeText = must('strike-text');
  const strikeSub = must('strike-sub');
  const pauseBar = must('pause-bar');
  const overlay = must('overlay');
  const panelIdle = must('panel-idle');
  const panelDone = must('panel-done');
  const idleMiss = must('idle-miss');
  const idleBest = must('idle-best');
  const quadrantBoard = must('quadrant-board');
  const quadrantGrid = must('quadrant-grid');
  const quadrantLabels = must('quadrant-labels');
  const sentenceStep = must('sentence-step');
  const sentencePrev = must('sentence-prev');
  const sentenceNext = must('sentence-next');
  const previousButtons = [sentencePrev, must('pause-prev'), must('strike-prev')];
  const nextButtons = [sentenceNext, must('pause-next'), must('strike-next')];
  const pauseCopy = must('pause-copy');
  const idleStart = must('idle-start');
  const idleRestart = must('idle-restart');
  const idlePlace = must('idle-place');
  const cornerPads = must('corner-pads');
  const runPlace = must('run-place');
  const runPace = must('run-pace');
  const runStreak = must('run-streak');
  const runSeconds = must('run-seconds');
  const drillPanel = must('drill');
  const drillLetter = must('drill-letter');
  const drillNote = must('drill-note');
  const drillTally = must('drill-tally');
  const doneScore = must('done-score');
  const doneStreak = must('done-streak');
  const doneBest = must('done-best');
  const doneNote = must('done-note');
  const hudStreak = must('hud-streak');
  const articleMeta = must('article-meta');
  const keypadDock = must('keypad-dock');
  const toggleKeypad = must('toggle-keypad');
  const toggleKeys = must('toggle-keys');
  const toggleSound = must('toggle-sound');

  const state = {
    token: '',
    activeEl: null,
    layout: '',
    status: '',
    theme: '',
    scroll: null,
    reduceMotion: false,
    forceSnap: false,
    pendingReveal: null,
    marking: false,
  };

  function userTookScroll() {
    state.scroll = null;
  }

  karaoke.addEventListener('wheel', userTookScroll, { passive: true });
  karaoke.addEventListener('scroll', () => {
    if (scrollWasTaken(state.scroll, karaoke.scrollTop)) state.scroll = null;
  }, { passive: true });

  function renderSlice(words, start, end) {
    const fragment = document.createDocumentFragment();
    for (let i = start; i < end; i += 1) {
      const word = words[i];
      if (word.breakBefore && i !== start) {
        const gap = document.createElement('span');
        gap.className = 'break';
        fragment.append(gap);
      }
      const span = document.createElement('span');
      span.className = wordMarks(word).className;
      span.dataset.i = String(i);
      fillWord(span, word);
      fragment.append(span);
    }
    karaoke.replaceChildren(fragment);
  }

  function previewBelow(el) {
    const words = [...karaoke.querySelectorAll('.word')].map((word) => ({
      top: word.offsetTop,
      height: word.offsetHeight,
    }));
    return nextLineUnder(words, el.offsetTop, el.offsetHeight);
  }

  function writeScroll(top) {
    if (top == null || Math.abs(top - karaoke.scrollTop) < 1) return;
    if (state.scroll) state.scroll.applying = true;
    karaoke.scrollTop = top;
    if (state.scroll) state.scroll.applying = false;
  }

  function moveScroll(top) {
    const step = beginScroll({
      current: karaoke.scrollTop,
      target: top,
      now: performance.now(),
      motion: state.scroll,
      smooth: !state.reduceMotion && !state.forceSnap,
    });
    state.scroll = step.motion;
    writeScroll(step.scrollTop);
  }

  function stepScroll() {
    const step = advanceScroll(state.scroll, performance.now(), !state.reduceMotion);
    state.scroll = step.motion;
    writeScroll(step.scrollTop);
  }

  function reveal(el) {
    if (!el || karaoke.hidden) return;
    const { lineHeight, nextLineBottom } = previewBelow(el);
    moveScroll(scrollTopForReadingLine({
      scrollTop: karaoke.scrollTop,
      viewHeight: karaoke.clientHeight,
      wordTop: el.offsetTop,
      wordHeight: el.offsetHeight,
      lineHeight,
      nextLineBottom,
    }));
  }

  function wordEl(index) {
    return karaoke.querySelector(`[data-i="${index}"]`);
  }

  function syncActive(snap, words) {
    const finished = snap.status === 'finished' || snap.total === 0;
    const el = !finished && snap.word ? wordEl(snap.index) : null;

    if (state.activeEl && state.activeEl !== el) {
      state.activeEl.classList.remove('active');
      const word = words[Number(state.activeEl.dataset.i)];
      if (word && wordMarks(word).pass) state.activeEl.classList.add('is-pass');
    }
    if (el) {
      el.classList.add('active');
      el.classList.remove('is-pass');
    }

    const wordChanged = el !== state.activeEl;
    state.activeEl = el;
    if (!el) {
      state.layout = '';
      state.scroll = null;
      state.pendingReveal = null;
      return;
    }

    const layout = String(karaoke.clientHeight);
    state.pendingReveal = wordChanged || layout !== state.layout
      ? { el, snap: state.forceSnap }
      : null;
    state.layout = layout;
    state.forceSnap = false;
  }

  function flushReveal() {
    const pending = state.pendingReveal;
    if (!pending) return;
    state.pendingReveal = null;
    state.forceSnap = pending.snap;
    reveal(pending.el);
    state.forceSnap = false;
  }

  function ensureWindow(snap, words) {
    const token = String(snap.epoch);
    if (token !== state.token) {
      renderSlice(words, 0, words.length);
      state.token = token;
      state.activeEl = null;
      state.layout = '';
      state.scroll = null;
      state.forceSnap = true;
    }
    syncActive(snap, words);
  }

  function paint(snap, words, extras) {
    const { config } = snap;
    if (state.theme !== config.theme) {
      state.theme = config.theme;
      document.documentElement.dataset.theme = config.theme;
    }
    document.body.classList.toggle('reduce-motion', config.reducedMotion);
    state.reduceMotion = config.reducedMotion;
    document.body.classList.toggle('is-paused', snap.status === 'paused');

    if (snap.status === 'frozen' && state.status !== 'frozen') {
      arena.classList.remove('is-struck');
      void arena.offsetWidth;
      arena.classList.add('is-struck');
    }
    state.status = snap.status;
    state.marking = Boolean(extras?.marking);

    const drilling = Boolean(extras?.drill?.on);
    karaoke.hidden = drilling;
    ensureWindow(snap, words);
    flushReveal();
    stepScroll();

    const remaining = snap.status === 'frozen' ? 0 : 1 - snap.progress;
    timerFill.style.transform = `scaleX(${Math.max(0, Math.min(1, remaining))})`;
    timer.classList.toggle('is-armed', snap.status === 'playing');
    timer.classList.toggle('is-low', snap.status === 'playing' && snap.progress > 0.72);
    timer.classList.toggle('is-frozen', snap.status === 'frozen');
    const remainingPct = String(Math.round(Math.max(0, Math.min(1, remaining)) * 100));
    if (timer.getAttribute('aria-valuenow') !== remainingPct) {
      timer.setAttribute('aria-valuenow', remainingPct);
    }

    setText(hudStreak, String(snap.streak));

    const shown = !snap.total
      ? 0
      : snap.status === 'finished'
        ? Math.min(snap.index, snap.total)
        : Math.min(snap.index + 1, snap.total);
    setText(
      articleMeta,
      extras?.drill?.on
        ? 'Corner drill'
        : snap.total ? `${snap.articleLabel} · ${shown} / ${snap.total}` : 'No article loaded',
    );

    strike.hidden = snap.status !== 'frozen';
    if (snap.status === 'frozen') {
      setText(strikeText, missLine(snap.missReason, snap.missedKey, snap.answer));
      setText(strikeSub, `Moving on in ${Math.max(0, snap.freezeLeftMs / 1000).toFixed(1)} s`);
    }

    pauseBar.hidden = snap.status !== 'paused';
    setText(pauseCopy, pauseRule(snap.responded));
    setText(idleMiss, missRule(config.freezeSec));
    const showOverlay = snap.status === 'idle' || snap.status === 'finished';
    overlay.hidden = drilling || !showOverlay;
    drillPanel.hidden = !drilling;
    drillLetter.classList.toggle('is-miss', extras?.drill?.mark === 'miss');
    setText(drillLetter, extras?.drill?.letter || '');
    setText(drillNote, extras?.drill?.note || '');
    setText(
      drillTally,
      drilling ? `${extras.drill.hits} right · streak ${extras.drill.streak}` : '',
    );
    panelIdle.hidden = snap.status !== 'idle';
    panelDone.hidden = snap.status !== 'finished';
    idleStart.disabled = snap.total === 0;
    const resumeAt = Number(extras?.continueIndex) || 0;
    const continuing = snap.status === 'idle' && resumeAt > 0 && resumeAt < snap.total;
    setText(idleStart, continuing ? 'Continue' : 'Start');
    idleRestart.hidden = !continuing;
    idlePlace.hidden = !continuing;
    if (continuing) setText(idlePlace, `Word ${resumeAt + 1} of ${snap.total}`);

    sentenceStep.hidden = drilling || snap.status !== 'paused';
    const placeCount = !snap.total
      ? 0
      : snap.status === 'finished'
        ? Math.min(snap.index, snap.total)
        : Math.min(snap.index + 1, snap.total);
    setText(runPlace, snap.total ? `${placeCount} of ${snap.total}` : '');
    setText(runPace, paceLabel(config));
    setText(runStreak, `Streak ${snap.streak}`);
    setText(runSeconds, secondsLeftLabel(snap));
    for (const button of previousButtons) button.disabled = !snap.step?.previous;
    for (const button of nextButtons) button.disabled = !snap.step?.next;

    const best = extras?.best;
    const hasBest = Boolean(best && (best.streak > 0 || best.score > 0));
    idleBest.hidden = !hasBest;
    if (hasBest) {
      setText(
        idleBest,
        `Best streak ${best.streak} · Best score ${best.score.toLocaleString()}`,
      );
    }

    setText(doneScore, snap.score.toLocaleString());
    setText(doneStreak, String(snap.maxStreak));
    setText(doneBest, String(best?.streak || 0));
    doneNote.hidden = !extras?.recordNote;
    setText(doneNote, extras?.recordNote || '');

    const runActive = snap.status === 'playing' || snap.status === 'paused' || snap.status === 'frozen';
    const guides = cornerBoard({
      showCornerLabels: config.showCornerLabels,
      showCornerGrid: config.showCornerGrid,
      active: snap.status === 'playing' || Boolean(extras?.drill?.on),
    });
    const showPads = snap.status === 'playing' || drilling;
    cornerPads.hidden = !showPads;
    const labelPads = Boolean(showPads && (config.showCornerLabels || drilling));
    cornerPads.classList.toggle('is-labeled', labelPads);
    for (const pad of cornerPads.querySelectorAll('[data-zone]')) {
      pad.classList.toggle('is-hot', pad.dataset.zone === snap.coachZone);
    }
    quadrantBoard.hidden = !guides.board;
    quadrantGrid.hidden = !guides.grid;
    quadrantLabels.hidden = !guides.labels || labelPads;
    keypadDock.hidden = !config.showKeypad;
    toggleKeypad.setAttribute('aria-expanded', String(config.showKeypad));
    toggleKeys.setAttribute('aria-pressed', String(config.showKeypad));
    toggleKeys.classList.toggle('is-on', config.showKeypad);

    toggleSound.classList.toggle('is-off', !config.sound);
    toggleSound.setAttribute('aria-pressed', String(config.sound));
    toggleSound.setAttribute('aria-label', config.sound ? 'Turn sound off' : 'Turn sound on');
    setText(toggleSound.querySelector('.full'), config.sound ? 'Sound on' : 'Sound off');
    setText(toggleSound.querySelector('.short'), config.sound ? 'Snd' : 'Off');

    if (!runActive && !drilling) timer.classList.remove('is-armed', 'is-low', 'is-frozen');
  }

  return { paint };
}
