import { PRESETS } from '../data/presets.js';
import { countWords } from '../engine/parseText.js';
import { normalizePhrase } from '../shelf.js';
import { articleKey } from '../sync.js';
import { must, setText } from './dom.js';

export function bindLibrary({ onLoad, onPhrase, onDelete }) {
  const list = must('preset-list');
  const syncedList = must('synced-list');
  const syncedTitle = must('synced-title');
  const input = must('article-input');
  const phraseInput = must('shelf-phrase');
  const count = must('article-count');
  const note = must('library-note');
  let activeId = '';
  let activeKey = '';

  function markActive(id, key = '') {
    activeId = id || '';
    activeKey = key || '';
    for (const button of list.querySelectorAll('.preset')) {
      button.classList.toggle('is-active', button.dataset.preset === activeId);
    }
    for (const button of syncedList.querySelectorAll('.preset')) {
      button.classList.toggle('is-active', Boolean(activeKey) && button.dataset.key === activeKey);
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
    const blurb = document.createElement('span');
    blurb.className = 'preset-blurb';
    blurb.textContent = blurbText;
    button.append(title, blurb);
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
    syncedTitle.hidden = extras.length === 0;
    syncedList.hidden = extras.length === 0;
    for (const item of extras) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'preset';
      button.dataset.key = item.key || articleKey(item.text);
      const words = countWords(item.text);
      const preview = item.text.replace(/\s+/g, ' ').trim();
      const clip = preview.length > 64 ? `${preview.slice(0, 64).trim()}…` : preview;
      addPreset(
        button,
        item.label || 'Custom article',
        `${words} ${words === 1 ? 'word' : 'words'} · ${clip}`,
      );
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
      remove.setAttribute('aria-label', `Remove “${clip}” from History`);
      remove.addEventListener('click', () => onDelete?.(item));
      row.append(button, remove);
      syncedList.append(row);
    }
    markActive(activeId, activeKey);
  }

  input.addEventListener('input', updateCount);
  must('save-phrase').addEventListener('click', () => {
    const phrase = phraseInput.value;
    if (phrase.trim() && !normalizePhrase(phrase)) {
      setText(note, 'Use at least 8 characters for the sync phrase.');
      return;
    }
    onPhrase(phrase);
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
    markActive,
    setSynced,
    setPhrase(value) {
      phraseInput.value = value || '';
    },
    note(text) {
      setText(note, text || '');
    },
  };
}
