/**
 * Wires the ReflexRead engine to the page.
 * Rules and timing live in src/engine. This file owns input, sound,
 * saving, and which screen is up. src/ui/paint.js draws each snapshot.
 */
import { createSound } from './audio/sound.js';
import { PRESETS } from './data/presets.js';
import { createGame } from './engine/game.js';
import { countWords } from './engine/parseText.js';
import { loadSave, writeSave } from './storage.js';
import { must, setText } from './ui/dom.js';
import { bindLibrary } from './ui/library.js';
import { createPainter, recallPrompt } from './ui/paint.js';
import { bindSettings } from './ui/settings.js';

const saved = loadSave();
const game = createGame();
const sound = createSound();

if (saved?.config) game.setConfig(saved.config);
else if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
  game.setConfig({ reducedMotion: true });
}

const fallback = PRESETS[0];
const storedArticle = saved?.article?.text ? saved.article : null;
let article = storedArticle
  ? {
      id: storedArticle.id || 'custom',
      label: storedArticle.label || 'Custom',
      text: storedArticle.text,
    }
  : { id: fallback.id, label: fallback.title, text: fallback.text };

let best = {
  score: Number(saved?.best?.score) || 0,
  streak: Number(saved?.best?.streak) || 0,
};
let records = { score: false, streak: false };
let saveTimer = 0;
let modalReturn = null;

game.load(article.text, article.label);

const app = must('app');
const live = must('live');
const modalSettings = must('modal-settings');
const modalLibrary = must('modal-library');
const modalStats = must('modal-stats');
const modals = [modalSettings, modalLibrary, modalStats];

function buildKeys(chars, parent) {
  for (const char of chars) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'key';
    button.dataset.key = char;
    button.textContent = char;
    button.setAttribute('aria-label', `Press ${char}`);
    button.addEventListener('click', () => {
      sound.unlock();
      game.press(char, performance.now());
      drain();
    });
    button.addEventListener('pointerup', () => button.blur());
    parent.append(button);
  }
}

buildKeys('ABCDEFGHIJKLMNOPQRSTUVWXYZ', must('keys-letters'));
buildKeys('0123456789', must('keys-digits'));

const painter = createPainter();
const settings = bindSettings(game, { onChange: scheduleSave });
const library = bindLibrary({ onLoad: loadArticle });
library.setText(article.text);

function extras() {
  const notes = [];
  if (records.streak) notes.push('New best streak');
  if (records.score) notes.push('New best score');
  return { best, recordNote: notes.join(' · ') };
}

function render(at) {
  const snap = game.snapshot(at);
  sound.setEnabled(snap.config.sound);
  painter.paint(snap, game.words, extras());
}

function drain(at = performance.now()) {
  for (const event of game.consumeEvents()) handleEvent(event);
  render(at);
}

function handleEvent(event) {
  if (event.type === 'hit') {
    if (!event.sentenceEnd) sound.hit(event.ascent);
    painter.pop(`+${event.points}`, 'hit');
    rememberScore(event.score);
    if (event.maxStreak > best.streak) {
      if (best.streak > 0) records.streak = true;
      best.streak = event.maxStreak;
      scheduleSave();
    }
    return;
  }

  if (event.type === 'recall-hit') {
    sound.recallHit();
    painter.pop(`+${event.points}`, 'hit');
    rememberScore(event.score);
    setText(live, `Caught it. Plus ${event.points}.`);
    return;
  }

  if (event.type === 'recall-miss') {
    sound.recallMiss();
    setText(live, 'Not that one. The word is marked in the sentence.');
    return;
  }

  if (event.type === 'recall-ready') {
    setText(
      live,
      game.status === 'finished'
        ? 'Article complete.'
        : 'Round complete. Press Space to continue.',
    );
    return;
  }

  if (event.type === 'milestone') {
    sound.milestone(event.ascent);
    return;
  }

  if (event.type === 'miss') {
    sound.miss();
    painter.pop(event.reason === 'wrong' ? 'Miss' : 'Slow', 'miss');
    const answer = event.answer || '?';
    setText(
      live,
      event.reason === 'wrong'
        ? `That key was ${event.pressed}. This letter is ${answer}.`
        : `Time ran out. This letter is ${answer}.`,
    );
    return;
  }

  if (event.type === 'pause') {
    setText(live, 'Paused. Press Space to resume.');
    return;
  }

  if (event.type === 'break') {
    setText(
      live,
      event.recall
        ? recallPrompt(false)
        : 'Round complete. Press Space to continue.',
    );
    return;
  }

  if (event.type === 'finish') {
    const notes = [];
    if (records.streak) notes.push('New best streak.');
    if (records.score) notes.push('New best score.');
    const lead = event.recall
      ? recallPrompt(true)
      : 'Article complete.';
    setText(live, [lead, ...notes].join(' '));
    scheduleSave();
    return;
  }

  if (event.type === 'start') {
    records = { score: false, streak: false };
  }
}

function scheduleSave() {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(persist, 200);
}

function persist() {
  window.clearTimeout(saveTimer);
  const result = writeSave({ config: game.config, best, article });
  if (!result.ok) library.note('Could not save in this browser.');
  else if (result.skippedArticle) {
    library.note('This article is too long to store. It stays loaded until you refresh.');
  }
}

function modalOpen() {
  return modals.some((modal) => !modal.hidden);
}

function clockOn() {
  if (document.hidden || modalOpen() || game.held) return false;
  return game.status === 'playing' || game.status === 'frozen';
}

function openModal(modal, opener) {
  const already = modalOpen();
  const at = performance.now();
  if (!already) {
    if (game.status === 'playing') game.pause();
    else if (game.status === 'frozen') game.hold(at);
  }
  game.cover();
  for (const item of modals) item.hidden = item !== modal;
  app.inert = true;
  modalReturn = opener || null;
  if (modal === modalSettings) settings.sync();
  modal.querySelector('.modal')?.focus();
  drain(at);
}

function closeModals() {
  if (!modalOpen()) return;
  for (const modal of modals) modal.hidden = true;
  app.inert = false;
  game.release(performance.now());
  const returnTo = modalReturn;
  modalReturn = null;
  if (returnTo?.isConnected && !returnTo.closest('[hidden]')) returnTo.focus();
  drain();
}

function loadArticle(next) {
  const text = String(next.text || '').trim();
  if (!countWords(text)) {
    library.note('That text has no readable words.');
    return;
  }
  article = {
    id: next.id || 'custom',
    label: next.label || 'Custom',
    text,
  };
  game.load(article.text, article.label);
  library.markActive(article.id);
  library.note('');
  closeModals();
  scheduleSave();
  drain();
}

function rememberScore(score) {
  if (score <= best.score) return;
  if (best.score > 0) records.score = true;
  best.score = score;
  scheduleSave();
}

function onSpace() {
  sound.unlock();
  const at = performance.now();
  if (game.acknowledgeRecall()) {
    drain(at);
    return;
  }
  if (game.recallLocked()) return;
  if (game.status === 'idle' || game.status === 'finished') game.start(at);
  else if (game.status === 'paused') game.resume(at);
  else if (game.status === 'break') game.continueRound(at);
  else if (game.status === 'playing') game.pause();
  drain(at);
}

function frame(t) {
  if (clockOn()) game.tick(t);
  drain(t);
  requestAnimationFrame(frame);
}

must('open-library').addEventListener('click', (event) => {
  openModal(modalLibrary, event.currentTarget);
});
must('open-settings').addEventListener('click', (event) => {
  openModal(modalSettings, event.currentTarget);
});
must('open-stats').addEventListener('click', (event) => {
  openModal(modalStats, event.currentTarget);
});

must('toggle-sound').addEventListener('click', () => {
  sound.unlock();
  game.setConfig({ sound: !game.config.sound });
  settings.sync();
  scheduleSave();
});

must('toggle-focus').addEventListener('click', () => {
  game.setConfig({ focusMode: !game.config.focusMode });
  settings.sync();
  scheduleSave();
});

must('toggle-keypad').addEventListener('click', () => {
  game.setConfig({ showKeypad: !game.config.showKeypad });
  settings.sync();
  scheduleSave();
});

must('idle-start').addEventListener('click', (event) => {
  sound.unlock();
  event.currentTarget.blur();
  game.start(performance.now());
  drain();
});

must('paused-resume').addEventListener('click', (event) => {
  sound.unlock();
  event.currentTarget.blur();
  game.resume(performance.now());
  drain();
});

must('break-continue').addEventListener('click', (event) => {
  sound.unlock();
  event.currentTarget.blur();
  game.continueRound(performance.now());
  drain();
});

must('done-again').addEventListener('click', (event) => {
  sound.unlock();
  event.currentTarget.blur();
  game.start(performance.now());
  drain();
});

must('done-article').addEventListener('click', (event) => {
  openModal(modalLibrary, event.currentTarget);
});

must('overlay').addEventListener('click', (event) => {
  const choice = event.target.closest('[data-recall]');
  if (choice) {
    sound.unlock();
    if (!game.answerRecall(Number(choice.dataset.recall))) return;
    drain();
    if (game.snapshot().recall?.phase === 'reveal') {
      const ack = document.getElementById(game.status === 'break' ? 'break-ack' : 'done-ack');
      ack?.focus();
    }
    return;
  }
  if (event.target.closest('.recall-ack')) {
    sound.unlock();
    if (game.acknowledgeRecall()) drain();
  }
});

must('karaoke').addEventListener('click', (event) => {
  const word = event.target.closest('[data-i]');
  if (!word) return;
  if (game.jumpTo(Number(word.dataset.i))) drain();
});

for (const button of document.querySelectorAll('.js-close')) {
  button.addEventListener('click', () => closeModals());
}

for (const modal of modals) {
  modal.addEventListener('click', (event) => {
    if (event.target === modal) closeModals();
  });
}

window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    if (modalOpen()) {
      event.preventDefault();
      closeModals();
    } else if (game.status === 'playing') {
      game.pause();
      drain();
    }
    return;
  }

  if (modalOpen()) return;

  const tag = event.target?.tagName;
  if (tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'SELECT' || event.target?.isContentEditable) {
    return;
  }
  if (event.metaKey || event.ctrlKey || event.altKey || event.isComposing) return;

  if (event.code === 'Space') {
    const control = event.target?.closest?.('button, a, select');
    if (control && !control.closest('[hidden]')) return;
    event.preventDefault();
    onSpace();
    return;
  }

  if (event.repeat) return;
  if (typeof event.key === 'string' && event.key.length === 1) {
    sound.unlock();
    if (game.press(event.key, performance.now())) drain();
  }
});

document.addEventListener('visibilitychange', () => {
  const at = performance.now();
  if (document.hidden) {
    if (game.status === 'playing') game.pause();
    else if (game.status === 'frozen') game.hold(at);
    persist();
    drain(at);
    return;
  }
  if (game.held) game.release(at);
  drain(at);
});

drain();
requestAnimationFrame(frame);
