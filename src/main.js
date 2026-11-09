/**
 * Wires the ReflexRead engine to the page.
 * Rules and timing live in src/engine. This file owns input, sound,
 * saving, sharing the loaded article, and which screen is up.
 * src/ui/paint.js draws each snapshot.
 */
import { createSound } from './audio/sound.js';
import { PRESETS } from './data/presets.js';
import { initialConfig } from './engine/config.js';
import { createDrill } from './engine/drill.js';
import { createGame } from './engine/game.js';
import { missLine, zoneAt } from './engine/quadrant.js';
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
import { TEXT_LIMIT, loadSave, writeSave } from './storage.js';
import {
  applyHighlightTombstones,
  applyTombstones,
  articleKey,
  articleToOpen,
  blockedByTombstone,
  clearPhrase,
  deleteSharedArticle,
  deleteSharedHighlight,
  forgetHighlightLocally,
  forgetLocally,
  loadHighlightCache,
  loadHighlightTombstones,
  loadHighlights,
  loadHistory,
  loadPhrase,
  loadShelfCache,
  loadTombstones,
  publishArticle,
  publishHighlight,
  pullShelf,
  rememberHighlight,
  rememberHistory,
  shelfArticles,
  writeHighlightCache,
  writePhrase,
  writeShelfCache,
} from './sync.js';
import { hasTouchscreen } from './ui/device.js';
import { must, setText } from './ui/dom.js';
import { bindLibrary } from './ui/library.js';
import { createPainter, recallPrompt } from './ui/paint.js';
import { bindSettings } from './ui/settings.js';

const saved = loadSave();
const game = createGame();
const sound = createSound();

game.setConfig(initialConfig({
  touchscreen: hasTouchscreen(),
  saved: saved?.config,
  reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
}));

const fallback = PRESETS[0];
const storedArticle = saved?.article?.text ? saved.article : null;
let article = storedArticle
  ? {
      id: storedArticle.id || 'custom',
      label: storedArticle.label || 'Custom',
      text: storedArticle.text,
      savedAt: Number(storedArticle.savedAt) || 0,
    }
  : { id: fallback.id, label: fallback.title, text: fallback.text, savedAt: 0 };
let articlePicked = false;

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

const app = must('app');
const live = must('live');
const modalSettings = must('modal-settings');
const modalLibrary = must('modal-library');
const modalStats = must('modal-stats');
const modalMark = must('modal-mark');
const keepButton = must('keep-line');
const markBar = must('mark-bar');
const modals = [modalSettings, modalLibrary, modalStats, modalMark];

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
  onDelete: removeArticle,
  onOpenKept: openKept,
  onDeleteKept: removeKept,
});
library.setText(article.text);
library.markActive(article.id, articleKey(article.text));
library.setPhrase(loadPhrase());
library.setKept(visibleHighlights());
if (storedArticle?.text && !isPreset(storedArticle.text)) {
  rememberHistory({
    id: storedArticle.id || 'custom',
    label: storedArticle.label || 'Custom',
    text: storedArticle.text,
    savedAt: Number(storedArticle.savedAt) || 1,
  });
}
library.setSynced(visibleHistory());

function extras() {
  const notes = [];
  if (records.streak) notes.push('New best streak');
  if (records.score) notes.push('New best score');
  return { best, recordNote: notes.join(' · '), drill: drill.snapshot(), marking };
}

function render(at) {
  const snap = game.snapshot(at);
  sound.setEnabled(snap.config.sound);
  painter.paint(snap, game.words, extras());
  document.body.classList.toggle('is-marking', marking);
  const liveRound = snap.status === 'playing'
    || snap.status === 'paused'
    || snap.status === 'frozen'
    || snap.status === 'break'
    || snap.status === 'finished';
  keepButton.hidden = marking || drill.snapshot().on || !liveRound;
  markBar.hidden = !marking || !modalMark.hidden;
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
    setText(live, missLine(event.reason, event.pressed, answer));
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
  if (!result.ok) library.note('Could not save in this browser.', { failed: true });
  else if (result.skippedArticle) {
    library.note('This article is too long to store. It stays loaded until you refresh.', { failed: true });
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
  if (marking && game.status === 'frozen') game.hold(performance.now());
  const returnTo = modalReturn;
  modalReturn = null;
  if (returnTo?.isConnected && !returnTo.closest('[hidden]')) returnTo.focus();
  drain();
}

function loadArticle(next) {
  const text = String(next.text || '').trim();
  if (!countWords(text)) {
    library.note('That text has no readable words.', { failed: true });
    return;
  }
  articlePicked = true;
  const share = next.share !== false && text.length <= TEXT_LIMIT;
  article = {
    id: next.id || 'custom',
    label: next.label || 'Custom',
    text,
    savedAt: share ? Date.now() : Number(next.savedAt) || Date.now(),
  };
  if (!isPreset(article.text) && article.text.length <= TEXT_LIMIT) rememberHistory(article);
  game.load(article.text, article.label);
  library.setText(article.text);
  library.markActive(article.id, articleKey(article.text));
  library.setSynced(visibleHistory());
  dropUndo();
  library.note('');
  closeModals();
  scheduleSave();
  if (share) void shareArticle();
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

function isPreset(text) {
  return PRESETS.some((preset) => preset.text === text);
}

function visibleHistory() {
  const tombstones = loadTombstones();
  return shelfArticles([...loadHistory(), ...loadShelfCache()]).filter(
    (item) => !blockedByTombstone(item.text, item.updatedAt, tombstones),
  );
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
  const live = status === 'playing' || status === 'paused' || status === 'frozen'
    || status === 'break' || status === 'finished';
  return live && game.words.length > 0;
}

function beginMark() {
  if (!canMark()) return false;
  const at = performance.now();
  if (game.status === 'playing') {
    game.pause();
    game.cover();
  } else if (game.status === 'frozen') {
    heldForMark = game.hold(at) || game.held;
  }
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
  const preset = PRESETS.find((item) => articleKey(item.text) === key);
  if (preset) return { id: preset.id, label: preset.title, text: preset.text, savedAt: 0 };
  const saved = visibleHistory().find((item) => (item.key || articleKey(item.text)) === key);
  if (!saved) return null;
  return {
    id: saved.id || 'custom',
    label: saved.label || 'Custom',
    text: saved.text,
    savedAt: saved.updatedAt || 0,
  };
}

function openKept(item) {
  const found = textForKey(item.articleKey);
  if (!found?.text) {
    library.setKeptNote('That line is saved here. The article is not on this device.', { failed: true });
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
  loadArticle({ ...found, share: false });
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

function shelfNote(reason) {
  if (reason === 'missing') {
    return 'Saved in History on this device. Add a sync phrase to share it.';
  }
  if (reason === 'rejected') return 'Saved in History on this device. The sync phrase was rejected.';
  if (reason === 'unconfigured') return 'Saved in History on this device. The shared history is not set up yet.';
  return 'Saved in History on this device. Other devices could not be reached.';
}

function removalNote(result) {
  if (result.ok && !result.reason) return 'Removed from History.';
  if (result.reason === 'missing') {
    return 'Removed from History on this device. Add a sync phrase to remove it everywhere.';
  }
  if (result.reason === 'rejected') return 'Removed on this device. The sync phrase was rejected.';
  if (result.reason === 'unconfigured') {
    return 'Removed on this device. The shared history is not set up yet.';
  }
  return 'Removed on this device. Other devices could not be reached.';
}

let pendingUndo = null;

function dropUndo() {
  pendingUndo = null;
  library.setHistoryNote('');
}

async function removeArticle(item) {
  const deletedAt = Date.now();
  const snapshot = { ...item, deletedAt };
  pendingUndo = snapshot;
  forgetLocally(item.text, deletedAt);
  library.setSynced(visibleHistory());
  library.setHistoryNote('Removed from History.', { onUndo: undoRemove });
  await enqueueShelf(async () => {
    const result = await deleteSharedArticle(item, { deletedAt });
    library.setSynced(visibleHistory());
    if (pendingUndo !== snapshot) return;
    if (result.skipped) {
      pendingUndo = null;
      library.setHistoryNote('');
      return;
    }
    library.setHistoryNote(removalNote(result), {
      failed: !result.ok,
      onUndo: undoRemove,
    });
  });
}

async function undoRemove() {
  const snapshot = pendingUndo;
  if (!snapshot) return;
  pendingUndo = null;
  const restored = {
    id: snapshot.id || 'custom',
    label: snapshot.label || 'Custom article',
    text: snapshot.text,
    savedAt: Date.now(),
  };
  rememberHistory(restored);
  library.setSynced(visibleHistory());
  library.setHistoryNote('Back in History.');
  await enqueueShelf(async () => {
    let result = await publishArticle(restored);
    if (result.blocked) {
      restored.savedAt = Date.now() + 5000;
      rememberHistory(restored);
      result = await publishArticle(restored);
    }
    library.setSynced(visibleHistory());
    if (result.blocked) {
      library.setHistoryNote('Back on this device. Other devices still have the removal.', { failed: true });
      return;
    }
    if (result.ok) {
      writeShelfCache(result.articles);
      return;
    }
    if (result.reason === 'missing' || result.reason === 'unconfigured') return;
    library.setHistoryNote(shelfNote(result.reason), { failed: true });
  });
}

function applyPhrase(raw) {
  const trimmed = String(raw || '').trim();
  if (!trimmed) {
    dropUndo();
    clearPhrase();
    library.setSynced(visibleHistory());
    library.setPhraseNote('Sync phrase removed. History and kept lines on this device stay here.');
    return;
  }
  if (!writePhrase(trimmed)) {
    library.setPhraseNote('Use at least 8 characters for the sync phrase.', { failed: true });
    return;
  }
  dropUndo();
  library.setPhrase(loadPhrase());
  void syncFromShelf({ tell: true });
}

async function shareArticle() {
  const current = article;
  await enqueueShelf(async () => {
    const result = await publishArticle(current);
    if (current !== article) return;
    if (!result.ok) {
      if (!pendingUndo) {
        const failed = result.reason !== 'missing' && result.reason !== 'unconfigured';
        library.setHistoryNote(shelfNote(result.reason), { failed });
      }
      return;
    }
    writeShelfCache(result.articles);
    library.setSynced(visibleHistory());
  });
}

async function syncFromShelf({ tell = false } = {}) {
  try {
    await enqueueShelf(async () => {
      if (!loadPhrase()) {
        if (tell) library.setPhraseNote('Add a sync phrase to share History.', { failed: true });
        return;
      }
      const pulled = await pullShelf();
      if (!pulled.ok) {
        if (tell) library.setPhraseNote(shelfNote(pulled.reason), { failed: true });
        return;
      }
      applyTombstones(pulled.tombstones);
      let articles = pulled.articles;
      const tombstones = loadTombstones();
      for (const item of articles.filter((saved) => blockedByTombstone(saved.text, saved.updatedAt, tombstones))) {
        const tomb = tombstones.find((entry) => entry.key === articleKey(item.text));
        const removed = await deleteSharedArticle(item, { deletedAt: tomb?.deletedAt });
        if (removed.skipped) continue;
        if (!removed.ok) {
          if (tell && !pendingUndo) library.setHistoryNote(removalNote(removed), { failed: true });
          break;
        }
        articles = removed.articles;
      }
      const local = article;
      const remembered = Boolean(storedArticle?.text) && local.text === storedArticle.text;
      const stamp = Number(local.savedAt) || (remembered ? 1 : 0);
      if (
        local?.text
        && !isPreset(local.text)
        && stamp > 0
        && !blockedByTombstone(local.text, stamp, loadTombstones())
      ) {
        rememberHistory({ ...local, savedAt: stamp });
      }
      const pending = loadHistory().filter(
        (item) => !articles.some((saved) => saved.text === item.text)
          && !blockedByTombstone(item.text, item.updatedAt, loadTombstones()),
      );
      let publishFailed = false;
      for (const item of pending) {
        const published = await publishArticle({
          id: item.id,
          label: item.label,
          text: item.text,
          savedAt: item.updatedAt || 1,
        });
        if (published.blocked) {
          applyTombstones(published.tombstones);
          articles = published.articles;
          continue;
        }
        if (!published.ok) {
          publishFailed = true;
          if (tell && !pendingUndo) library.setHistoryNote(shelfNote(published.reason), { failed: true });
          break;
        }
        articles = published.articles;
      }
      writeShelfCache(articles);
      library.setSynced(visibleHistory());
      await mergeHighlights(pulled);
      if (publishFailed) return;
      const newest = articleToOpen({
        local: article,
        shelf: articles,
        articlePicked,
        idle: game.status === 'idle',
        modalOpen: modalOpen(),
      });
      if (!newest) {
        if (tell) library.setPhraseNote('Sync phrase saved on this device.');
        return;
      }
      loadArticle({
        id: newest.id,
        label: newest.label,
        text: newest.text,
        savedAt: newest.updatedAt,
        share: false,
      });
    });
  } catch {
    // The article already restored from this browser stays loaded.
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
  if (marking) exitMark();
  game.resume(performance.now());
  drain();
});

for (const id of ['keep-line', 'break-keep', 'done-keep']) {
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

must('arena').addEventListener('pointerdown', (event) => {
  if (marking) return;
  if (event.button > 0) return;
  if (event.target.closest('button, a, input, textarea, select, label')) return;
  const rect = event.currentTarget.getBoundingClientRect();
  const zone = zoneAt(event.clientX - rect.left, event.clientY - rect.top, rect.width, rect.height);
  if (!zone) return;
  if (drill.snapshot().on) {
    event.preventDefault();
    sound.unlock();
    const result = drill.answer(zone);
    if (!result) return;
    if (result.hit) sound.hit(1);
    else sound.miss();
    drain();
    return;
  }
  if (game.config.playMode !== 'words' || game.status !== 'playing') return;
  event.preventDefault();
  sound.unlock();
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

  const keepChord = (event.metaKey || event.ctrlKey)
    && !event.altKey
    && event.key?.toLowerCase() === 'h';
  if (keepChord) {
    event.preventDefault();
    if (!modalOpen()) beginMark();
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
    if (game.status === 'playing') game.pause();
    else if (game.status === 'frozen') game.hold(at);
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
