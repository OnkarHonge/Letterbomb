import { PRESETS } from '../data/presets.js';
import { countWords } from '../engine/parseText.js';
import { SHELF_CAP, normalizePhrase } from '../shelf.js';
import { articleKey } from '../sync.js';
import { must, setText } from './dom.js';

const TITLE_LIMIT = 52;

export function historyTitle(text) {
  const preview = String(text || '').replace(/\s+/g, ' ').trim();
  if (preview.length <= TITLE_LIMIT) return preview;
  return `${preview.slice(0, TITLE_LIMIT).trim()}…`;
}

export function historyHeading(count, cap = SHELF_CAP) {
  const total = Math.max(0, Number(count) || 0);
  const base = `History · ${total}`;
  if (total >= cap) return `${base}. Adding one drops the oldest.`;
  if (total >= cap - 4) {
    const left = cap - total;
    return `${base}. ${left} left before the oldest drops.`;
  }
  return base;
}

export function bindLibrary({ onLoad, onPhrase, onDelete }) {
  const list = must('preset-list');
  const syncedList = must('synced-list');
  const syncedTitle = must('synced-title');
  const input = must('article-input');
  const phraseInput = must('shelf-phrase');
  const phraseToggle = must('toggle-phrase');
  const count = must('article-count');
  const note = must('library-note');
  const historyNote = must('history-note');
  const phraseNote = must('phrase-note');
  let activeId = '';
  let activeKey = '';

  function showNote(node, message, { failed = false, onUndo = null } = {}) {
    node.classList.toggle('is-fail', Boolean(message) && failed);
    node.replaceChildren();
    if (!message) {
      node.hidden = true;
      return;
    }
    node.hidden = false;
    node.append(document.createTextNode(message));
    if (!onUndo) return;
    const undo = document.createElement('button');
    undo.type = 'button';
    undo.className = 'btn';
    undo.textContent = 'Undo';
    undo.addEventListener('click', () => onUndo());
    node.append(undo);
  }

  function markActive(id, key = '') {
    activeId = id || '';
    activeKey = key || '';
    let activePreset = null;
    for (const button of list.querySelectorAll('.preset')) {
      const on = button.dataset.preset === activeId;
      button.classList.toggle('is-active', on);
      const now = button.querySelector('.preset-now');
      if (now) now.hidden = !on;
      if (on) activePreset = button;
    }
    if (activePreset) list.prepend(activePreset);
    for (const button of syncedList.querySelectorAll('.preset')) {
      const on = Boolean(activeKey) && button.dataset.key === activeKey;
      button.classList.toggle('is-active', on);
      const now = button.querySelector('.preset-now');
      if (now) now.hidden = !on;
    }
  }

  function updateCount() {
    const total = countWords(input.value);
    setText(count, `${total} ${total === 1 ? 'word' : 'words'}`);
    const match = PRESETS.find((preset) => preset.text === input.value);
    if (match) markActive(match.id, articleKey(match.text));
    else markActive('', '');
  }

  function addPreset(button, titleText, blurbText) {
    const title = document.createElement('span');
    title.className = 'preset-title';
    title.textContent = titleText;
    const now = document.createElement('span');
    now.className = 'preset-now';
    now.textContent = 'Now';
    now.hidden = true;
    const blurb = document.createElement('span');
    blurb.className = 'preset-blurb';
    blurb.textContent = blurbText;
    button.append(title, now, blurb);
  }

  for (const preset of PRESETS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'preset';
    button.dataset.preset = preset.id;
    addPreset(button, preset.title, preset.blurb);
    button.addEventListener('click', () => {
      input.value = preset.text;
      updateCount();
      onLoad({ id: preset.id, label: preset.title, text: preset.text });
    });
    list.append(button);
  }

  function setSynced(articles) {
    syncedList.replaceChildren();
    const extras = (Array.isArray(articles) ? articles : []).filter(
      (item) => item?.text && !PRESETS.some((preset) => preset.text === item.text),
    );
    extras.sort((a, b) => {
      const aNow = Boolean(activeKey) && (a.key || articleKey(a.text)) === activeKey;
      const bNow = Boolean(activeKey) && (b.key || articleKey(b.text)) === activeKey;
      if (aNow === bNow) return 0;
      return aNow ? -1 : 1;
    });
    syncedTitle.textContent = historyHeading(extras.length);
    syncedTitle.hidden = extras.length === 0;
    syncedList.hidden = extras.length === 0;
    for (const item of extras) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'preset';
      button.dataset.key = item.key || articleKey(item.text);
      const words = countWords(item.text);
      const title = historyTitle(item.text);
      addPreset(button, title, `${words} ${words === 1 ? 'word' : 'words'}`);
      button.addEventListener('click', () => {
        input.value = item.text;
        updateCount();
        onLoad({ id: item.id || 'custom', label: item.label || 'Custom article', text: item.text });
      });
      const row = document.createElement('div');
      row.className = 'history-row';
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'btn history-remove';
      remove.textContent = 'Remove';
      remove.setAttribute('aria-label', `Remove “${title}” from History`);
      remove.addEventListener('click', () => onDelete?.(item));
      row.append(button, remove);
      syncedList.append(row);
    }
    markActive(activeId, activeKey);
  }

  input.addEventListener('input', updateCount);
  phraseToggle.addEventListener('click', () => {
    const showing = phraseInput.type === 'text';
    phraseInput.type = showing ? 'password' : 'text';
    phraseToggle.textContent = showing ? 'Show' : 'Hide';
    phraseToggle.setAttribute('aria-pressed', showing ? 'false' : 'true');
  });
  must('save-phrase').addEventListener('click', () => {
    const phrase = phraseInput.value;
    if (phrase.trim() && !normalizePhrase(phrase)) {
      showNote(phraseNote, 'Use at least 8 characters for the sync phrase.', { failed: true });
      return;
    }
    onPhrase(phrase);
  });
  must('load-article').addEventListener('click', () => {
    const text = input.value.trim();
    if (!countWords(text)) {
      showNote(note, 'Paste an article first.', { failed: true });
      return;
    }
    onLoad({ id: 'custom', label: 'Custom article', text });
  });

  return {
    setText(text) {
      input.value = text;
      updateCount();
    },
    markActive,
    setSynced,
    setPhrase(value) {
      phraseInput.value = value || '';
    },
    note(text, options = {}) {
      showNote(note, text || '', { failed: Boolean(options.failed) });
    },
    setHistoryNote(text, options = {}) {
      showNote(historyNote, text || '', options);
    },
    setPhraseNote(text, options = {}) {
      showNote(phraseNote, text || '', options);
    },
  };
}
