import { must, setText } from './dom.js';
import { scrollTopToReveal } from './scroll.js';

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
  const idleStart = must('idle-start');
  const breakCopy = must('break-copy');
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
  };

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

  function reveal(el) {
    if (!el || karaoke.hidden) return;
    const next = scrollTopToReveal(
      karaoke.scrollTop,
      karaoke.clientHeight,
      el.offsetTop,
      el.offsetHeight,
    );
    if (Math.abs(next - karaoke.scrollTop) >= 1) karaoke.scrollTop = next;
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
      return;
    }

    const layout = `${snap.config.fontScale}:${snap.config.focusMode}:${karaoke.clientHeight}`;
    if (wordChanged || layout !== state.layout) reveal(el);
    state.layout = layout;
  }

  function ensureWindow(snap, words) {
    const token = String(snap.epoch);
    if (token !== state.token) {
      renderSlice(words, 0, words.length);
      state.token = token;
      state.activeEl = null;
      state.layout = '';
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
      targetLabel = playing ? 'Read' : 'Up next';
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
      setText(strikeSub, `Moving on in ${Math.max(0, snap.freezeLeftMs / 1000).toFixed(1)}s`);
    }

    pauseBar.hidden = snap.status !== 'paused';
    const showOverlay = snap.status === 'idle' || snap.status === 'break' || snap.status === 'finished';
    overlay.hidden = !showOverlay;
    panelIdle.hidden = snap.status !== 'idle';
    panelBreak.hidden = snap.status !== 'break';
    panelDone.hidden = snap.status !== 'finished';
    idleStart.disabled = snap.total === 0;

    if (config.roundSize > 0) {
      setText(
        idleRound,
        `A breath screen shows up every ${config.roundSize} words. Set that to 0 in Tune to read straight through.`,
      );
    } else {
      setText(idleRound, 'Rounds are off, so the article runs straight through.');
    }
    setText(breakCopy, `You finished a round of ${config.roundSize} words. Your streak stays. This is a pause, not a penalty.`);

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
