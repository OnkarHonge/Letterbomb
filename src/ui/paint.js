import { must, setText } from './dom.js';
import {
  advanceScroll,
  beginScroll,
  nextLineUnder,
  scrollTopForReadingLine,
  scrollWasTaken,
} from './scroll.js';

export function missRule(freezeSec) {
  return freezeSec > 0
    ? 'Hits build a streak. A miss freezes the board, then you continue.'
    : 'Hits build a streak. A miss moves straight on.';
}

export function pauseRule(responded) {
  return responded
    ? 'That letter already counted. Resume moves on. Click a word to move the highlight.'
    : 'This word starts fresh when you resume. Click a word to move the highlight.';
}

export const RECALL_QUESTION = 'Which word fills the blank?';

export function roundNote(roundSize) {
  return roundSize > 0
    ? `A breath screen shows up every ${roundSize} words and asks you to fill a blank from that stretch.`
    : 'Rounds are off, so the article runs straight through. One fill-in question waits at the end.';
}

export function recallHeading(phase) {
  if (phase === 'reveal') return 'That word was here.';
  if (phase === 'ask') return 'Which word was here?';
  return '';
}

export function recallPrompt(finished) {
  const lead = finished ? 'Article complete.' : 'Round complete.';
  return `${lead} ${RECALL_QUESTION}`;
}

function recallMount(prefix) {
  return {
    root: must(`${prefix}-recall`),
    choices: must(`${prefix}-choices`),
    sentence: must(`${prefix}-sentence`),
    ack: must(`${prefix}-ack`),
    hint: must(`${prefix}-recall-hint`),
  };
}

function syncRecall(mount, snap, state, keyName) {
  const recall = snap.recall;
  const asking = Boolean(recall && recall.phase !== 'ready');
  mount.root.hidden = !asking;
  if (!asking) {
    state[keyName] = '';
    return;
  }

  const revealing = recall.phase === 'reveal';
  mount.choices.hidden = revealing;
  mount.sentence.hidden = false;
  mount.ack.hidden = !revealing;

  const key = [
    snap.epoch,
    snap.status,
    snap.index,
    recall.phase,
    recall.choices.map((choice) => `${choice.id}:${choice.label}`).join('|'),
    (recall.sentence || []).map((part) => `${part.blank ? '_' : ''}${part.marked ? '*' : ''}${part.text}`).join(' '),
  ].join(':');
  if (key === state[keyName]) return;
  state[keyName] = key;

  mount.choices.replaceChildren();
  if (!revealing) {
    for (const choice of recall.choices) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn recall-choice';
      button.dataset.recall = String(choice.id);
      button.textContent = choice.label;
      mount.choices.append(button);
    }
  }
  fillSentence(mount.sentence, recall.sentence || []);
}

function fillSentence(node, parts) {
  node.replaceChildren();
  parts.forEach((part, index) => {
    if (index > 0) node.append(' ');
    if (part.blank) {
      if (part.lead) node.append(part.lead);
      const blank = document.createElement('span');
      blank.className = 'recall-blank';
      blank.setAttribute('role', 'img');
      blank.setAttribute('aria-label', 'blank');
      blank.textContent = part.text;
      node.append(blank);
      if (part.trail) node.append(part.trail);
      return;
    }
    if (!part.marked) {
      node.append(part.text);
      return;
    }
    const mark = document.createElement('mark');
    mark.className = 'recall-mark';
    mark.textContent = part.text;
    node.append(mark);
  });
}

function fillWord(node, word) {
  node.replaceChildren();
  if (!word) return;
  if (!word.displayChar) {
    node.textContent = word.original;
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
  const rsvp = must('rsvp');
  const rsvpPrev = must('rsvp-prev');
  const rsvpCurrent = must('rsvp-current');
  const rsvpNext = must('rsvp-next');
  const timer = must('timer');
  const timerFill = must('timer-fill');
  const strike = must('strike');
  const strikeText = must('strike-text');
  const strikeSub = must('strike-sub');
  const pauseBar = must('pause-bar');
  const overlay = must('overlay');
  const panelIdle = must('panel-idle');
  const panelBreak = must('panel-break');
  const panelDone = must('panel-done');
  const idleBest = must('idle-best');
  const idleRound = must('idle-round');
  const idleMiss = must('idle-miss');
  const pauseCopy = must('pause-copy');
  const idleStart = must('idle-start');
  const breakTitle = must('break-title');
  const breakCopy = must('break-copy');
  const breakRest = must('break-rest');
  const breakResult = must('break-result');
  const breakContinue = must('break-continue');
  const breakHint = must('break-hint');
  const doneTitle = must('done-title');
  const doneSummary = must('done-summary');
  const doneResult = must('done-result');
  const doneAgain = must('done-again');
  const breakRecall = recallMount('break');
  const doneRecall = recallMount('done');
  const doneScore = must('done-score');
  const doneStreak = must('done-streak');
  const doneAccuracy = must('done-accuracy');
  const doneReaction = must('done-reaction');
  const doneNote = must('done-note');
  const hudStreak = must('hud-streak');
  const hudScore = must('hud-score');
  const hudPop = must('hud-pop');
  const hudTargetLabel = must('hud-target-label');
  const hudTarget = must('hud-target');
  const hudPace = must('hud-pace');
  const hudAccuracy = must('hud-accuracy');
  const articleMeta = must('article-meta');
  const roundMeta = must('round-meta');
  const keypadDock = must('keypad-dock');
  const keypadBody = must('keypad-body');
  const toggleKeypad = must('toggle-keypad');
  const toggleSound = must('toggle-sound');
  const toggleFocus = must('toggle-focus');
  const statScore = must('stat-score');
  const statStreak = must('stat-streak');
  const statAccuracy = must('stat-accuracy');
  const statReaction = must('stat-reaction');
  const statHits = must('stat-hits');
  const statMisses = must('stat-misses');
  const statWords = must('stat-words');
  const statBest = must('stat-best');
  const keys = [...document.querySelectorAll('.key')];

  const state = {
    token: '',
    activeEl: null,
    layout: '',
    rsvpKey: '',
    hot: '\u0000',
    status: '',
    theme: '',
    scale: '',
    popToken: 0,
    breakRecall: '',
    doneRecall: '',
    scroll: null,
    reduceMotion: false,
    forceSnap: false,
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
      span.className = word.isTarget ? 'word' : 'word is-pass';
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
    const next = scrollTopForReadingLine({
      scrollTop: karaoke.scrollTop,
      viewHeight: karaoke.clientHeight,
      wordTop: el.offsetTop,
      wordHeight: el.offsetHeight,
      lineHeight,
      nextLineBottom,
    });
    moveScroll(next);
  }

  function syncActive(snap) {
    if (snap.status === 'finished' || snap.total === 0) {
      state.activeEl?.classList.remove('active');
      state.activeEl = null;
      return;
    }

    const el = karaoke.querySelector(`[data-i="${snap.index}"]`);
    const wordChanged = el !== state.activeEl;
    if (wordChanged) {
      state.activeEl?.classList.remove('active');
      state.activeEl = el;
      el?.classList.add('active');
    }
    if (!el || snap.config.viewMode !== 'karaoke') {
      state.layout = '';
      state.scroll = null;
      return;
    }

    const layout = `${snap.config.fontScale}:${snap.config.focusMode}:${karaoke.clientHeight}`;
    if (wordChanged || layout !== state.layout) reveal(el);
    state.layout = layout;
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
    syncActive(snap);
  }

  function syncRsvp(snap, words) {
    const key = `${snap.epoch}:${snap.index}:${snap.status}:${snap.word?.original ?? ''}:${snap.isTarget}`;
    if (key === state.rsvpKey) return;
    state.rsvpKey = key;
    const prev = snap.index > 0 ? words[snap.index - 1] : null;
    const next = snap.index + 1 < words.length ? words[snap.index + 1] : null;
    setText(rsvpPrev, prev?.original || '');
    setText(rsvpNext, next?.original || '');
    if (!snap.word) setText(rsvpCurrent, snap.status === 'finished' ? 'Done' : '');
    else fillWord(rsvpCurrent, snap.word);
    rsvp.classList.toggle('is-pass', Boolean(snap.word) && !snap.isTarget);
  }

  function paint(snap, words, extras) {
    const { config } = snap;
    if (state.theme !== config.theme) {
      state.theme = config.theme;
      document.documentElement.dataset.theme = config.theme;
    }
    const scale = String(config.fontScale);
    if (state.scale !== scale) {
      state.scale = scale;
      document.documentElement.style.setProperty('--read-scale', scale);
    }
    document.body.classList.toggle('is-focus', config.focusMode);
    document.body.classList.toggle('reduce-motion', config.reducedMotion);
    state.reduceMotion = config.reducedMotion;
    document.body.classList.toggle('is-paused', snap.status === 'paused');

    if (snap.status === 'frozen' && state.status !== 'frozen') {
      arena.classList.remove('is-struck');
      void arena.offsetWidth;
      arena.classList.add('is-struck');
    }
    state.status = snap.status;

    karaoke.hidden = config.viewMode !== 'karaoke';
    rsvp.hidden = config.viewMode !== 'rsvp';
    timer.hidden = !config.showTimeBar;
    ensureWindow(snap, words);
    stepScroll();
    syncRsvp(snap, words);

    const remaining = snap.status === 'frozen' ? 0 : 1 - snap.progress;
    timerFill.style.transform = `scaleX(${Math.max(0, Math.min(1, remaining))})`;
    timer.classList.toggle('is-armed', snap.status === 'playing');
    timer.classList.toggle('is-low', snap.status === 'playing' && snap.progress > 0.72);
    timer.classList.toggle('is-frozen', snap.status === 'frozen');
    const remainingPct = String(Math.round(Math.max(0, Math.min(1, remaining)) * 100));
    if (timer.getAttribute('aria-valuenow') !== remainingPct) {
      timer.setAttribute('aria-valuenow', remainingPct);
    }

    const playing = snap.status === 'playing' || snap.status === 'paused' || snap.status === 'frozen';
    let targetLabel = 'Up next';
    let targetValue = '—';
    if (!snap.word) {
      targetValue = '—';
    } else if (!snap.isTarget) {
      targetLabel = playing ? 'No key' : 'Up next';
    } else if (!config.showTargetHud && snap.status === 'playing') {
      targetLabel = 'First letter';
      targetValue = '•';
    } else {
      targetLabel = playing ? 'First letter' : 'Up next';
      targetValue = snap.answer || '—';
    }
    setText(hudTargetLabel, targetLabel);
    setText(hudTarget, targetValue);
    setText(hudStreak, String(snap.streak));
    setText(hudScore, snap.score.toLocaleString());
    setText(hudPace, String(config.wpm));
    setText(hudAccuracy, snap.accuracy == null ? '—' : `${snap.accuracy}%`);

    const shown = !snap.total
      ? 0
      : snap.status === 'finished' || snap.status === 'break'
        ? Math.min(snap.index, snap.total)
        : Math.min(snap.index + 1, snap.total);
    setText(
      articleMeta,
      snap.total ? `${snap.articleLabel} · ${shown} / ${snap.total}` : 'No article loaded',
    );

    if (config.roundSize > 0 && snap.total && snap.status !== 'finished') {
      roundMeta.hidden = false;
      setText(
        roundMeta,
        snap.status === 'break'
          ? 'Round complete'
          : `Round ${snap.index - snap.roundStart + 1} / ${config.roundSize}`,
      );
    } else {
      roundMeta.hidden = true;
    }

    strike.hidden = snap.status !== 'frozen';
    if (snap.status === 'frozen') {
      const sentence = snap.missReason === 'wrong'
        ? `That key was ${snap.missedKey}. This letter is ${snap.answer}.`
        : `Time ran out. This letter is ${snap.answer}.`;
      setText(strikeText, sentence);
      setText(strikeSub, `Moving on in ${Math.max(0, snap.freezeLeftMs / 1000).toFixed(1)} s`);
    }

    pauseBar.hidden = snap.status !== 'paused';
    setText(pauseCopy, pauseRule(snap.responded));
    setText(idleMiss, missRule(config.freezeSec));
    const showOverlay = snap.status === 'idle' || snap.status === 'break' || snap.status === 'finished';
    overlay.hidden = !showOverlay;
    panelIdle.hidden = snap.status !== 'idle';
    panelBreak.hidden = snap.status !== 'break';
    panelDone.hidden = snap.status !== 'finished';
    idleStart.disabled = snap.total === 0;

    setText(idleRound, roundNote(config.roundSize));
    const finishedRound = snap.status === 'break'
      ? Math.max(0, snap.index - snap.roundStart)
      : config.roundSize;
    setText(
      breakCopy,
      `You finished a round of ${finishedRound} words. Your streak stays. This is a pause, not a penalty.`,
    );
    syncRecall(breakRecall, snap, state, 'breakRecall');
    syncRecall(doneRecall, snap, state, 'doneRecall');
    const asking = Boolean(snap.recall && snap.recall.phase !== 'ready');
    const revealing = snap.recall?.phase === 'reveal';
    breakRest.hidden = snap.status === 'break' && asking;
    doneSummary.hidden = snap.status === 'finished' && asking;
    breakContinue.disabled = asking;
    doneAgain.disabled = asking;
    if (snap.status === 'break') {
      setText(breakTitle, recallHeading(snap.recall?.phase) || 'Breath');
    }
    if (snap.status === 'finished') {
      setText(doneTitle, recallHeading(snap.recall?.phase) || 'Done');
    }
    const recallHint = revealing
      ? 'Got it or Space unlocks the rest.'
      : 'Fill the blank. Space waits.';
    setText(breakRecall.hint, recallHint);
    setText(doneRecall.hint, recallHint);
    const showResult = Boolean(snap.recall && snap.recall.phase === 'ready');
    const resultText = !showResult
      ? ''
      : snap.recall.correct
        ? `Caught it · +${snap.recall.points}`
        : 'Missed this one. Streak unchanged.';
    breakResult.hidden = !(showResult && snap.status === 'break');
    doneResult.hidden = !(showResult && snap.status === 'finished');
    breakResult.classList.toggle('recall-missed', showResult && !snap.recall.correct);
    doneResult.classList.toggle('recall-missed', showResult && !snap.recall.correct);
    setText(breakResult, resultText);
    setText(doneResult, resultText);

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
    setText(doneAccuracy, snap.accuracy == null ? '—' : `${snap.accuracy}%`);
    setText(doneReaction, snap.avgReaction == null ? '—' : `${snap.avgReaction} ms`);
    doneNote.hidden = !extras?.recordNote;
    setText(doneNote, extras?.recordNote || '');

    setText(statScore, snap.score.toLocaleString());
    setText(statStreak, String(snap.maxStreak));
    setText(statAccuracy, snap.accuracy == null ? '—' : `${snap.accuracy}%`);
    setText(statReaction, snap.avgReaction == null ? '—' : `${snap.avgReaction} ms`);
    setText(statHits, String(snap.hits));
    setText(statMisses, String(snap.misses));
    setText(statWords, String(snap.total));
    setText(statBest, String(best?.streak || 0));

    const hot = config.showTargetHud && snap.answer ? snap.answer : '';
    if (hot !== state.hot) {
      state.hot = hot;
      for (const key of keys) key.classList.toggle('is-hot', key.dataset.key === hot);
    }

    const runActive = snap.status === 'playing' || snap.status === 'paused' || snap.status === 'frozen';
    keypadDock.hidden = config.focusMode || !runActive;
    keypadBody.hidden = !config.showKeypad;
    setText(toggleKeypad, config.showKeypad ? 'Hide keys' : 'Show keys');
    toggleKeypad.setAttribute('aria-expanded', String(config.showKeypad));

    toggleSound.classList.toggle('is-off', !config.sound);
    toggleSound.setAttribute('aria-pressed', String(config.sound));
    toggleSound.setAttribute('aria-label', config.sound ? 'Turn sound off' : 'Turn sound on');
    setText(toggleSound.querySelector('.full'), config.sound ? 'Sound on' : 'Sound off');
    setText(toggleSound.querySelector('.short'), config.sound ? 'Snd' : 'Off');

    toggleFocus.classList.toggle('is-on', config.focusMode);
    toggleFocus.setAttribute('aria-pressed', String(config.focusMode));
    setText(toggleFocus.querySelector('.full'), config.focusMode ? 'Exit focus' : 'Focus');
    setText(toggleFocus.querySelector('.short'), config.focusMode ? 'Exit' : 'Focus');
  }

  function pop(text, kind) {
    const token = state.popToken + 1;
    state.popToken = token;
    setText(hudPop, text);
    hudPop.classList.toggle('is-hit', kind !== 'miss');
    hudPop.classList.toggle('is-miss', kind === 'miss');
    window.setTimeout(() => {
      if (state.popToken !== token) return;
      setText(hudPop, '');
      hudPop.classList.remove('is-hit', 'is-miss');
    }, 650);
  }

  return { paint, pop };
}
