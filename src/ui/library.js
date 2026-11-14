import { countWords } from '../engine/parseText.js';
import { HIGHLIGHT_CAP, groupHighlights } from '../highlights.js';
import { normalizePhrase } from '../shelf.js';
import { must, setText } from './dom.js';

const TITLE_LIMIT = 52;

export function lineTitle(text) {
  const preview = String(text || '').replace(/\s+/g, ' ').trim();
  if (preview.length <= TITLE_LIMIT) return preview;
  return `${preview.slice(0, TITLE_LIMIT).trim()}…`;
}

export function keptHeading(count, cap = HIGHLIGHT_CAP) {
  const total = Math.max(0, Number(count) || 0);
  const base = `Kept lines · ${total}`;
  if (total >= cap) return `${base}. Remove one before keeping another.`;
  if (total >= cap - 4) {
    const left = cap - total;
    return `${base}. ${left} left.`;
  }
  return base;
}

export function bindLibrary({ onLoad, onPhrase, onOpenKept, onDeleteKept }) {
  const input = must('article-input');
  const phraseInput = must('shelf-phrase');
  const phraseToggle = must('toggle-phrase');
  const count = must('article-count');
  const note = must('library-note');
  const phraseNote = must('phrase-note');
  const keptTitle = must('kept-title');
  const keptNote = must('kept-note');
  const keptList = must('kept-list');
  const keptActions = must('kept-actions');

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

  function updateCount() {
    const total = countWords(input.value);
    setText(count, `${total} ${total === 1 ? 'word' : 'words'}`);
  }

  function setKept(highlights) {
    keptList.replaceChildren();
    const groups = groupHighlights(highlights);
    const total = groups.reduce((sum, group) => sum + group.items.length, 0);
    keptTitle.textContent = keptHeading(total);
    keptTitle.hidden = total === 0;
    keptList.hidden = total === 0;
    keptActions.hidden = total === 0;
    for (const group of groups) {
      const heading = document.createElement('h4');
      heading.className = 'kept-article';
      heading.textContent = group.label;
      keptList.append(heading);
      for (const item of group.items) {
        const title = lineTitle(item.note);
        const row = document.createElement('div');
        row.className = 'kept-row';
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'preset';
        const name = document.createElement('span');
        name.className = 'preset-title';
        name.textContent = title;
        const blurb = document.createElement('span');
        blurb.className = 'preset-blurb';
        blurb.textContent = 'Open in the article';
        button.append(name, blurb);
        button.addEventListener('click', () => onOpenKept?.(item));
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'btn kept-remove';
        remove.textContent = 'Remove';
        remove.setAttribute('aria-label', `Remove “${title}” from kept lines`);
        remove.addEventListener('click', () => onDeleteKept?.(item));
        row.append(button, remove);
        keptList.append(row);
      }
    }
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
    onPhrase?.(phrase);
  });
  must('load-article').addEventListener('click', () => {
    const text = input.value.trim();
    if (!countWords(text)) {
      setText(note, 'Paste an article first.');
      return;
    }
    onLoad({ id: 'custom', label: 'Custom article', text });
  });

  return {
    setText(text) {
      input.value = text;
      updateCount();
    },
    setPhrase(value) {
      phraseInput.value = value || '';
    },
    note(text) {
      setText(note, text || '');
    },
    setKept,
    setKeptNote(text, options = {}) {
      showNote(keptNote, text || '', options);
    },
    setPhraseNote(text, options = {}) {
      showNote(phraseNote, text || '', options);
    },
  };
}
