import { PRESETS } from '../data/presets.js';
import { countWords } from '../engine/parseText.js';
import { must, setText } from './dom.js';

export function bindLibrary({ onLoad }) {
  const list = must('preset-list');
  const input = must('article-input');
  const count = must('article-count');
  const note = must('library-note');

  function markActive(id) {
    for (const button of list.querySelectorAll('.preset')) {
      button.classList.toggle('is-active', button.dataset.preset === id);
    }
  }

  function updateCount() {
    const total = countWords(input.value);
    setText(count, `${total} ${total === 1 ? 'word' : 'words'}`);
    const match = PRESETS.find((preset) => preset.text === input.value);
    markActive(match?.id || '');
  }

  for (const preset of PRESETS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'preset';
    button.dataset.preset = preset.id;
    const title = document.createElement('span');
    title.className = 'preset-title';
    title.textContent = preset.title;
    const blurb = document.createElement('span');
    blurb.className = 'preset-blurb';
    blurb.textContent = preset.blurb;
    button.append(title, blurb);
    button.addEventListener('click', () => {
      input.value = preset.text;
      updateCount();
      onLoad({ id: preset.id, label: preset.title, text: preset.text });
    });
    list.append(button);
  }

  input.addEventListener('input', updateCount);
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
    note(text) {
      setText(note, text || '');
    },
  };
}
