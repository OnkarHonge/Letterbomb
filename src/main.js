/**
 * Wires the ReflexRead engine to the page.
 * Rules and timing live in src/engine. This file owns input, sound,
 * saving, keeping a line, and which screen is up.
 * src/ui/paint.js draws each snapshot.
 */
import { createSound } from './audio/sound.js';
import { PLACEHOLDER } from './data/presets.js';
import { initialConfig } from './engine/config.js';
import { createDrill } from './engine/drill.js';
import { createGame } from './engine/game.js';
import { missLine } from './engine/quadrant.js';
import { countWords } from './engine/parseText.js';
import {
  HIGHLIGHT_CAP,
  NOTE_LIMIT,
  admitHighlight,
  blockedHighlight,
  contextBefore,
  createHighlightId,
  extendNote,
  findSpan,
  highlightsMarkdown,
  planHighlights,
  spanText,
} from './highlights.js';
import { loadSave, writeSave } from './storage.js';
import {
  applyHighlightTombstones,
  articleKey,
  clearPhrase,
  deleteSharedHighlight,
  forgetHighlightLocally,
  loadHighlightCache,
  loadHighlightTombstones,
  loadHighlights,
  loadPhrase,
  publishHighlight,
  pullShelf,
  rememberHighlight,
  writeHighlightCache,
  writePhrase,
} from './sync.js';
import { hasTouchscreen } from './ui/device.js';
import { must, setText } from './ui/dom.js';
import { bindLibrary } from './ui/library.js';
import { createPainter } from './ui/paint.js';
import { bindSettings } from './ui/settings.js';

const saved = loadSave();
const game = createGame();
const sound = createSound();

game.setConfig(initialConfig({
  touchscreen: hasTouchscreen(),
  saved: saved?.config,
  reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
}));

function usableArticle(stored) {
  const text = String(stored?.text || '');
  if (!countWords(text)) return null;
  return {
    id: stored.id || 'custom',
    label: stored.label || 'Custom',
    text,
  };
}

let article = usableArticle(saved?.article) || {
  id: PLACEHOLDER.id,
  label: PLACEHOLDER.title,
  text: PLACEHOLDER.text,
};

let best = {
  score: Number(saved?.best?.score) || 0,
  streak: Number(saved?.best?.streak) || 0,
};
let records = { score: false, streak: false };
let saveTimer = 0;
let modalReturn = null;
let marking = false;
let heldForMark = false;
let markDraft = null;
let pendingKeptUndo = null;

game.load(article.text, article.label);

function usableResume(place, text) {
  if (!place || place.articleKey !== articleKey(text)) return 0;
  const index = Number(place.index);
  if (!Number.isInteger(index) || index <= 0) return 0;
  return index;
}

let storedResume = usableResume(saved?.place, article.text);
if (storedResume >= game.words.length) storedResume = 0;
let placeStamp = '';

const app = must('app');
const live = must('live');
const modalSettings = must('modal-settings');
const modalLibrary = must('modal-library');
const modalMark = must('modal-mark');
const keepButton = must('keep-line');
const markBar = must('mark-bar');
const modals = [modalSettings, modalLibrary, modalMark];

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
const drill = createDrill();
const settings = bindSettings(game, { onChange: scheduleSave });
const library = bindLibrary({
  onLoad: loadArticle,
  onPhrase: applyPhrase,
  onOpenKept: openKept,
  onDeleteKept: removeKept,
});
library.setText(article.text);
library.setPhrase(loadPhrase());
library.setKept(visibleHighlights());

function extras() {
  const notes = [];
  if (records.streak) notes.push('New best streak');
  if (records.score) notes.push('New best score');
  return {
    best,
    recordNote: notes.join(' · '),
    drill: drill.snapshot(),
    marking,
    continueIndex: game.status === 'idle' ? storedResume : 0,
  };
}

function render(at) {
  const snap = game.snapshot(at);
  sound.setEnabled(snap.config.sound);
  painter.paint(snap, game.words, extras());
  document.body.classList.toggle('is-marking', marking);
  const liveRound = snap.status === 'playing'
    || snap.status === 'paused'
    || snap.status === 'frozen'
    || snap.status === 'finished';
  keepButton.hidden = marking || drill.snapshot().on || !liveRound;
  markBar.hidden = !marking || !modalMark.hidden;
}

function notePlace() {
  const snap = game.snapshot();
  if (snap.status === 'idle') return;
  const index = snap.status === 'finished' ? 0 : snap.index;
  const stamp = `${articleKey(article.text)}:${index}`;
  if (stamp === placeStamp) return;
  placeStamp = stamp;
  storedResume = snap.status !== 'finished' && index > 0 ? index : 0;
  scheduleSave();
}

function drain(at = performance.now()) {
  for (const event of game.consumeEvents()) handleEvent(event);
  notePlace();
  render(at);
}

function handleEvent(event) {
  if (event.type === 'hit') {
    if (event.practice) {
      sound.hit(1);
      return;
    }
    if (!event.sentenceEnd) sound.hit(event.ascent);
    rememberScore(event.score);
    if (event.maxStreak > best.streak) {
      if (best.streak > 0) records.streak = true;
      best.streak = event.maxStreak;
      scheduleSave();
    }
    return;
  }

  if (event.type === 'milestone') {
    sound.milestone(event.ascent);
    return;
  }

  if (event.type === 'miss') {
    sound.miss();
    const answer = event.answer || '?';
    setText(live, missLine(event.reason, event.pressed, answer));
    return;
  }

  if (event.type === 'pause') {
    setText(live, 'Paused. Press Space to resume.');
    return;
  }

  if (event.type === 'finish') {
    const notes = [];
    if (records.streak) notes.push('New best streak.');
    if (records.score) notes.push('New best score.');
    setText(live, ['Article complete.', ...notes].join(' '));
    scheduleSave();
    return;
  }

  if (event.type === 'step') {
    sound.step(event.direction);
    setText(live, event.line);
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
  const result = writeSave({
    config: game.config,
    best,
    article,
    place: { articleKey: articleKey(article.text), index: storedResume },
  });
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
  if (!already) game.settle();
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
  storedResume = 0;
  placeStamp = '';
  library.setText(article.text);
  library.note('');
  closeModals();
  scheduleSave();
  drain();
}

let shelfTask = Promise.resolve();

function enqueueShelf(task) {
  const run = shelfTask.then(task, task);
  shelfTask = run.then(
    () => {},
    () => {},
  );
  return run;
}

function visibleHighlights() {
  const tombs = loadHighlightTombstones();
  return planHighlights([...loadHighlights(), ...loadHighlightCache()]).filter(
    (item) => !blockedHighlight(item, tombs),
  );
}

function keptShareNote(reason) {
  if (reason === 'missing') return 'Kept on this device. Add a sync phrase to share it.';
  if (reason === 'rejected') return 'Kept on this device. The sync phrase was rejected.';
  if (reason === 'unconfigured') return 'Kept on this device. The shared bucket is not set up yet.';
  if (reason === 'full') {
    return 'Kept on this device. The shared bucket is full, so other devices did not get this line.';
  }
  return 'Kept on this device. Other devices could not be reached.';
}

function keptRemovalNote(result) {
  if (result.ok && !result.reason) return 'Removed from kept lines.';
  if (result.reason === 'missing') {
    return 'Removed on this device. Add a sync phrase to remove it everywhere.';
  }
  if (result.reason === 'rejected') return 'Removed on this device. The sync phrase was rejected.';
  if (result.reason === 'unconfigured') {
    return 'Removed on this device. The shared bucket is not set up yet.';
  }
  return 'Removed on this device. Other devices could not be reached.';
}

function markDialogNote(message, failed = false) {
  const node = must('mark-dialog-note');
  node.classList.toggle('is-fail', Boolean(message) && failed);
  node.hidden = !message;
  node.textContent = message || '';
}

function canMark() {
  if (marking || modalOpen() || drill.snapshot().on) return false;
  const status = game.status;
  const liveRound = status === 'playing' || status === 'paused' || status === 'frozen'
    || status === 'finished';
  return liveRound && game.words.length > 0;
}

function beginMark() {
  if (!canMark()) return false;
  const at = performance.now();
  game.settle();
  marking = true;
  window.getSelection()?.removeAllRanges();
  setText(live, 'Select the words to keep. Release to edit them.');
  drain(at);
  return true;
}

function exitMark() {
  const wasMarking = marking;
  marking = false;
  markDraft = null;
  if (!modalMark.hidden) closeModals();
  if (heldForMark) {
    heldForMark = false;
    if (game.held) game.release(performance.now());
  }
  window.getSelection()?.removeAllRanges();
  if (wasMarking) drain();
}

function selectionSpan() {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  const root = must('karaoke');
  if (!root.contains(range.commonAncestorContainer)) return null;
  const indexes = [];
  for (const node of root.querySelectorAll('[data-i]')) {
    try {
      if (range.intersectsNode(node)) indexes.push(Number(node.dataset.i));
    } catch {
      // A detached node is not part of this selection.
    }
  }
  const finite = indexes.filter((index) => Number.isInteger(index));
  if (!finite.length) return null;
  return { start: Math.min(...finite), end: Math.max(...finite) + 1 };
}

function offerSelection() {
  if (!marking || !modalMark.hidden) return;
  const span = selectionSpan();
  if (!span) return;
  openDraft(span);
}

function keepSentence() {
  if (drill.snapshot().on || modalOpen()) return;
  const at = performance.now();
  game.settle();
  if (game.status !== 'paused' && game.status !== 'finished') return;
  const span = game.sentenceBounds();
  if (!span) return;
  openDraft(span);
  drain(at);
}

function openDraft(span) {
  const source = spanText(game.words, span.start, span.end);
  if (!source) return;
  const key = articleKey(article.text);
  const existing = findSpan(visibleHighlights(), key, span.start, span.end);
  const before = contextBefore(game.words, span.start);
  markDraft = {
    id: existing?.id || createHighlightId(),
    articleKey: key,
    articleLabel: article.label,
    source,
    note: existing?.note || source,
    start: span.start,
    end: span.end,
    createdAt: existing?.createdAt || Date.now(),
    existing: Boolean(existing),
  };
  setText(must('mark-article'), article.label);
  const beforeNode = must('mark-before');
  const beforeLabel = must('mark-before-label');
  beforeNode.hidden = !before;
  beforeLabel.hidden = !before;
  setText(beforeNode, before);
  must('mark-note').value = markDraft.note;
  must('mark-add-before').disabled = !before;
  const full = !existing && visibleHighlights().length >= HIGHLIGHT_CAP;
  must('mark-save').disabled = full;
  markDialogNote(
    full ? 'The bucket is full. Remove a kept line before keeping another.' : '',
    full,
  );
  window.getSelection()?.removeAllRanges();
  openModal(modalMark);
  must('mark-note').focus();
}

function saveMark() {
  if (!markDraft) return;
  const note = must('mark-note').value.trim();
  if (!note) {
    markDialogNote('Write the line you want to keep.', true);
    return;
  }
  if (note.length > NOTE_LIMIT) {
    markDialogNote('That line is too long to keep.', true);
    return;
  }
  const record = {
    id: markDraft.id,
    articleKey: markDraft.articleKey,
    articleLabel: markDraft.articleLabel,
    source: markDraft.source,
    note,
    start: markDraft.start,
    end: markDraft.end,
    createdAt: markDraft.createdAt,
    updatedAt: Date.now(),
  };
  const admitted = admitHighlight(visibleHighlights(), record);
  if (!admitted.ok) {
    markDialogNote('The bucket is full. Remove a kept line before keeping another.', true);
    return;
  }
  const stored = admitted.highlight;
  rememberHighlight(stored);
  library.setKept(visibleHighlights());
  setText(live, 'Kept.');
  exitMark();
  void shareHighlight(stored);
}

async function shareHighlight(record) {
  await enqueueShelf(async () => {
    const result = await publishHighlight(record);
    if (result.highlight && result.highlight.id !== record.id) rememberHighlight(result.highlight);
    if (result.ok && result.highlights) writeHighlightCache(result.highlights);
    library.setKept(visibleHighlights());
    if (result.ok && !result.blocked) {
      library.setKeptNote('');
      return;
    }
    if (result.blocked) {
      const retry = { ...record, id: result.highlight?.id || record.id, updatedAt: Date.now() + 5000 };
      rememberHighlight(retry);
      const again = await publishHighlight(retry);
      if (again.ok && again.highlights) writeHighlightCache(again.highlights);
      library.setKept(visibleHighlights());
      if (again.ok && !again.blocked) {
        library.setKeptNote('');
        return;
      }
      library.setKeptNote('Kept on this device. Other devices still have the removal.', { failed: true });
      return;
    }
    library.setKeptNote(keptShareNote(result.reason), {
      failed: result.reason !== 'missing' && result.reason !== 'unconfigured',
    });
  });
}

function textForKey(key) {
  if (articleKey(article.text) === key) return article;
  if (articleKey(PLACEHOLDER.text) === key) {
    return { id: PLACEHOLDER.id, label: PLACEHOLDER.title, text: PLACEHOLDER.text };
  }
  return null;
}

function openKept(item) {
  const found = textForKey(item.articleKey);
  if (!found?.text) {
    library.setKeptNote('This line\'s article is not on this device.', { failed: true });
    return;
  }
  const same = articleKey(article.text) === item.articleKey;
  const at = performance.now();
  if (same && (game.status === 'playing' || game.status === 'paused')) {
    if (game.status === 'playing') {
      game.pause();
      game.cover();
    }
    if (marking) exitMark();
    closeModals();
    game.jumpTo(item.start);
    drain(at);
    return;
  }
  if (marking) exitMark();
  loadArticle(found);
  if (game.start(at)) game.pause();
  game.jumpTo(item.start);
  drain(at);
}

async function removeKept(item) {
  const deletedAt = Date.now();
  const snapshot = { ...item, deletedAt };
  pendingKeptUndo = snapshot;
  forgetHighlightLocally(item.id, deletedAt);
  library.setKept(visibleHighlights());
  library.setKeptNote('Removed from kept lines.', { onUndo: undoKept });
  await enqueueShelf(async () => {
    const result = await deleteSharedHighlight(item.id, { deletedAt });
    library.setKept(visibleHighlights());
    if (pendingKeptUndo !== snapshot) return;
    if (result.skipped) {
      pendingKeptUndo = null;
      library.setKeptNote('');
      return;
    }
    library.setKeptNote(keptRemovalNote(result), {
      failed: !result.ok,
      onUndo: undoKept,
    });
  });
}

async function undoKept() {
  const snapshot = pendingKeptUndo;
  if (!snapshot) return;
  pendingKeptUndo = null;
  const restored = { ...snapshot, updatedAt: Date.now() };
  delete restored.deletedAt;
  rememberHighlight(restored);
  library.setKept(visibleHighlights());
  library.setKeptNote('Back in kept lines.');
  await enqueueShelf(async () => {
    let result = await publishHighlight(restored);
    if (result.blocked) {
      restored.updatedAt = Date.now() + 5000;
      rememberHighlight(restored);
      result = await publishHighlight(restored);
    }
    if (result.highlights) writeHighlightCache(result.highlights);
    library.setKept(visibleHighlights());
    if (result.ok && !result.blocked) return;
    if (result.reason === 'missing' || result.reason === 'unconfigured') return;
    library.setKeptNote(keptShareNote(result.blocked ? 'unreachable' : result.reason), { failed: true });
  });
}

async function mergeHighlights(pulled) {
  applyHighlightTombstones(pulled.highlightTombstones || []);
  let remote = planHighlights(pulled.highlights);
  let tombs = loadHighlightTombstones();
  for (const item of [...remote]) {
    if (!blockedHighlight(item, tombs)) continue;
    const tomb = tombs.find((entry) => entry.id === item.id);
    const removed = await deleteSharedHighlight(item.id, { deletedAt: tomb?.deletedAt });
    if (removed.skipped) continue;
    if (!removed.ok) {
      if (!pendingKeptUndo) library.setKeptNote(keptRemovalNote(removed), { failed: true });
      break;
    }
    remote = removed.highlights;
    tombs = loadHighlightTombstones();
  }
  for (const item of loadHighlights()) {
    if (blockedHighlight(item, loadHighlightTombstones())) continue;
    const match = remote.find((entry) => entry.id === item.id);
    if (match && match.updatedAt >= item.updatedAt) continue;
    const published = await publishHighlight(item);
    if (!published.ok || published.blocked) {
      if (!pendingKeptUndo) {
        library.setKeptNote(keptShareNote(published.blocked ? 'unreachable' : published.reason), {
          failed: published.reason !== 'missing' && published.reason !== 'unconfigured',
        });
      }
      break;
    }
    remote = published.highlights;
  }
  writeHighlightCache(remote);
  library.setKept(visibleHighlights());
}

function applyPhrase(raw) {
  const trimmed = String(raw || '').trim();
  if (!trimmed) {
    clearPhrase();
    library.setPhraseNote('Sync phrase removed. Kept lines on this device stay here.');
    return;
  }
  if (!writePhrase(trimmed)) {
    library.setPhraseNote('Use at least 8 characters for the sync phrase.', { failed: true });
    return;
  }
  library.setPhrase(loadPhrase());
  void syncFromShelf({ tell: true });
}

async function syncFromShelf({ tell = false } = {}) {
  try {
    await enqueueShelf(async () => {
      if (!loadPhrase()) {
        if (tell) library.setPhraseNote('Add a sync phrase to share kept lines.', { failed: true });
        return;
      }
      const pulled = await pullShelf();
      if (!pulled.ok) {
        if (tell) library.setPhraseNote(keptShareNote(pulled.reason), { failed: true });
        return;
      }
      await mergeHighlights(pulled);
      if (tell) library.setPhraseNote('Sync phrase saved on this device.');
    });
  } catch {
    // Lines already on this device stay here.
  }
}

function rememberScore(score) {
  if (score <= best.score) return;
  if (best.score > 0) records.score = true;
  best.score = score;
  scheduleSave();
}

function readingFullNode() {
  return document.fullscreenElement || document.webkitFullscreenElement || null;
}

let readingFallback = false;

function enterReadingFull() {
  if (modalOpen()) closeModals();
  readingFallback = true;
  document.body.classList.add('is-reading-full');
  const arena = must('arena');
  const request = arena.requestFullscreen?.bind(arena);
  const legacy = arena.webkitRequestFullscreen?.bind(arena);
  try {
    if (request) Promise.resolve(request({ navigationUI: 'hide' })).catch(() => {});
    else if (legacy) Promise.resolve(legacy()).catch(() => {});
  } catch {
    // The reading card already fills the screen. Some browsers refuse the system call.
  }
}

function exitReadingFull() {
  readingFallback = false;
  const exit = document.exitFullscreen?.bind(document) || document.webkitExitFullscreen?.bind(document);
  if (readingFullNode() && exit) Promise.resolve(exit()).catch(() => {});
  document.body.classList.remove('is-reading-full');
}

function onFullscreenChange() {
  const arena = document.getElementById('arena');
  if (arena && readingFullNode() === arena) {
    readingFallback = false;
    document.body.classList.add('is-reading-full');
    return;
  }
  if (readingFallback) return;
  document.body.classList.remove('is-reading-full');
}

function onSpace() {
  sound.unlock();
  const at = performance.now();
  if (drill.snapshot().on) {
    drill.stop();
    drain(at);
    return;
  }
  if (game.status === 'idle' || game.status === 'finished') {
    const index = game.status === 'idle' ? storedResume : 0;
    game.start(at, index > 0 ? { index } : undefined);
  }
  else if (game.status === 'paused') game.resume(at);
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
must('toggle-sound').addEventListener('click', () => {
  sound.unlock();
  game.setConfig({ sound: !game.config.sound });
  settings.sync();
  scheduleSave();
});

must('toggle-keys').addEventListener('click', () => {
  game.setConfig({ showKeypad: !game.config.showKeypad });
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
  const index = storedResume;
  game.start(performance.now(), index > 0 ? { index } : undefined);
  drain();
});

must('idle-restart').addEventListener('click', (event) => {
  sound.unlock();
  event.currentTarget.blur();
  storedResume = 0;
  placeStamp = '';
  game.start(performance.now());
  drain();
});

must('paused-resume').addEventListener('click', (event) => {
  sound.unlock();
  event.currentTarget.blur();
  if (marking) exitMark();
  game.resume(performance.now());
  drain();
});

function stepBy(direction, button) {
  if (drill.snapshot().on) return;
  sound.unlock();
  button?.blur();
  if (game.stepSentence(direction, performance.now())) drain();
}

for (const id of ['sentence-prev', 'pause-prev', 'strike-prev']) {
  must(id).addEventListener('click', (event) => stepBy(-1, event.currentTarget));
}

for (const id of ['sentence-next', 'pause-next', 'strike-next']) {
  must(id).addEventListener('click', (event) => stepBy(1, event.currentTarget));
}

for (const id of ['pause-keep-sentence', 'done-keep-sentence']) {
  must(id).addEventListener('click', (event) => {
    event.currentTarget.blur();
    keepSentence();
  });
}

for (const id of ['keep-line', 'done-keep']) {
  must(id).addEventListener('click', (event) => {
    event.currentTarget.blur();
    beginMark();
  });
}

must('mark-done').addEventListener('click', (event) => {
  event.currentTarget.blur();
  exitMark();
});

must('mark-save').addEventListener('click', () => {
  saveMark();
});

must('mark-add-before').addEventListener('click', () => {
  if (!markDraft) return;
  const note = must('mark-note');
  note.value = extendNote(note.value, game.words, markDraft.start);
  note.focus();
});

must('kept-copy').addEventListener('click', async () => {
  const text = highlightsMarkdown(visibleHighlights());
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    library.setKeptNote('Copied kept lines.');
  } catch {
    library.setKeptNote('Could not copy from this browser.', { failed: true });
  }
});

must('kept-download').addEventListener('click', () => {
  const text = highlightsMarkdown(visibleHighlights());
  if (!text) return;
  const blob = new Blob([text], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'kept-lines.md';
  link.click();
  URL.revokeObjectURL(url);
  library.setKeptNote('Downloaded kept lines.');
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

must('enter-full').addEventListener('click', () => {
  enterReadingFull();
});

must('exit-full').addEventListener('click', () => {
  exitReadingFull();
});

must('idle-drill').addEventListener('click', (event) => {
  event.currentTarget.blur();
  sound.unlock();
  drill.start();
  drain();
});

must('drill-stop').addEventListener('click', (event) => {
  event.currentTarget.blur();
  drill.stop();
  drain();
});

document.addEventListener('fullscreenchange', onFullscreenChange);
document.addEventListener('webkitfullscreenchange', onFullscreenChange);

must('corner-pads').addEventListener('click', (event) => {
  const pad = event.target.closest('[data-zone]');
  if (!pad) return;
  sound.unlock();
  const zone = pad.dataset.zone;
  if (drill.snapshot().on) {
    const result = drill.answer(zone);
    if (!result) return;
    if (result.hit) sound.hit(1);
    else sound.miss();
    drain();
    return;
  }
  if (game.pressArea(zone, performance.now())) drain();
});

must('karaoke').addEventListener('click', (event) => {
  if (marking) return;
  const word = event.target.closest('[data-i]');
  if (!word) return;
  if (game.jumpTo(Number(word.dataset.i))) drain();
});

document.addEventListener('pointerup', (event) => {
  if (!marking || !modalMark.hidden) return;
  if (event.target?.closest?.('button, a, input, textarea, select, label')) return;
  window.requestAnimationFrame(offerSelection);
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
    if (document.body.classList.contains('is-reading-full')) {
      event.preventDefault();
      exitReadingFull();
      return;
    }
    if (modalOpen()) {
      event.preventDefault();
      closeModals();
    } else if (marking) {
      event.preventDefault();
      exitMark();
    } else if (game.status === 'playing') {
      game.pause();
      drain();
    }
    return;
  }

  if (modalOpen()) return;

  if (marking) {
    if (event.code === 'Space') {
      event.preventDefault();
      exitMark();
    }
    return;
  }

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

  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
    if (drill.snapshot().on) return;
    if (game.status !== 'paused') return;
    event.preventDefault();
    if (event.repeat) return;
    stepBy(event.key === 'ArrowRight' ? 1 : -1);
    return;
  }

  if (event.repeat) return;
  if (drill.snapshot().on) return;
  if (typeof event.key === 'string' && event.key.length === 1) {
    sound.unlock();
    if (game.press(event.key, performance.now())) drain();
  }
});

document.addEventListener('visibilitychange', () => {
  const at = performance.now();
  if (document.hidden) {
    game.settle();
    persist();
    drain(at);
    return;
  }
  if (game.held && !marking) game.release(at);
  drain(at);
});

document.addEventListener('keyup', (event) => {
  if (!marking || !modalMark.hidden) return;
  if (event.key !== 'Shift' && !String(event.key || '').startsWith('Arrow')) return;
  window.requestAnimationFrame(offerSelection);
});

drain();
requestAnimationFrame(frame);
void syncFromShelf();
