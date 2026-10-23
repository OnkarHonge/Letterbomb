import { PACE_PRESETS, DEFAULT_CONFIG, pacePatch } from '../engine/config.js';
import { wordDeadlineMs } from '../engine/timing.js';
import { must, setText } from './dom.js';

export function bindSettings(game, { onChange }) {
  const wpm = must('cfg-wpm');
  const wpmVal = must('cfg-wpm-val');
  const forgive = must('cfg-forgive');
  const forgiveVal = must('cfg-forgive-val');
  const freeze = must('cfg-freeze');
  const freezeVal = must('cfg-freeze-val');
  const punct = must('cfg-punct');
  const punctVal = must('cfg-punct-val');
  const round = must('cfg-round');
  const roundVal = must('cfg-round-val');
  const font = must('cfg-font');
  const fontVal = must('cfg-font-val');
  const windowNote = must('cfg-window');
  const filter = must('cfg-filter');
  const advance = must('cfg-advance');
  const target = must('cfg-target');
  const bar = must('cfg-bar');
  const sound = must('cfg-sound');
  const keypad = must('cfg-keypad');
  const focus = must('cfg-focus');
  const motion = must('cfg-motion');
  const themeGrid = must('theme-grid');
  const viewRadios = [...document.querySelectorAll('input[name="view"]')];

  function markTheme(theme) {
    for (const button of themeGrid.querySelectorAll('[data-theme]')) {
      const on = button.dataset.theme === theme;
      button.classList.toggle('is-active', on);
      button.setAttribute('aria-pressed', String(on));
    }
  }

  function paintLabels(config) {
    setText(wpmVal, `${config.wpm} WPM`);
    setText(forgiveVal, `${config.forgivenessMs} ms`);
    setText(freezeVal, `${config.freezeSec.toFixed(1)} s`);
    setText(punctVal, `${config.punctuationMultiplier.toFixed(1)}×`);
    setText(roundVal, config.roundSize === 0 ? 'No breaks' : `${config.roundSize} words`);
    setText(fontVal, `${Math.round(config.fontScale * 100)}%`);
    const plain = wordDeadlineMs({ hasPunctuation: false, isTarget: true }, config);
    const marked = wordDeadlineMs({ hasPunctuation: true, isTarget: true }, config);
    setText(
      windowNote,
      `A normal word gives you ${plain} ms. A word with punctuation gives you ${marked} ms.`,
    );
  }

  function readForm() {
    const theme = themeGrid.querySelector('.is-active')?.dataset.theme;
    return {
      wpm: Number(wpm.value),
      forgivenessMs: Number(forgive.value),
      freezeSec: Number(freeze.value),
      punctuationMultiplier: Number(punct.value),
      roundSize: Number(round.value),
      fontScale: Number(font.value) / 100,
      filter: filter.value,
      viewMode: viewRadios.find((radio) => radio.checked)?.value,
      advanceOnHit: advance.checked,
      showTargetHud: target.checked,
      showTimeBar: bar.checked,
      sound: sound.checked,
      showKeypad: keypad.checked,
      focusMode: focus.checked,
      reducedMotion: motion.checked,
      ...(theme ? { theme } : {}),
    };
  }

  function applyForm() {
    game.setConfig(readForm());
    paintLabels(game.config);
    onChange();
  }

  function sync() {
    const config = game.config;
    wpm.value = String(config.wpm);
    forgive.value = String(config.forgivenessMs);
    freeze.value = String(config.freezeSec);
    punct.value = String(config.punctuationMultiplier);
    round.value = String(config.roundSize);
    font.value = String(Math.round(config.fontScale * 100));
    filter.value = config.filter;
    advance.checked = config.advanceOnHit;
    target.checked = config.showTargetHud;
    bar.checked = config.showTimeBar;
    sound.checked = config.sound;
    keypad.checked = config.showKeypad;
    focus.checked = config.focusMode;
    motion.checked = config.reducedMotion;
    for (const radio of viewRadios) radio.checked = radio.value === config.viewMode;
    markTheme(config.theme);
    paintLabels(config);
  }

  for (const input of [wpm, forgive, freeze, punct, round, font]) {
    input.addEventListener('input', applyForm);
  }
  for (const input of [filter, advance, target, bar, sound, keypad, focus, motion, ...viewRadios]) {
    input.addEventListener('change', applyForm);
  }

  for (const button of document.querySelectorAll('[data-pace]')) {
    const preset = PACE_PRESETS[button.dataset.pace];
    if (!preset) continue;
    button.textContent = `${preset.label} · ${preset.wpm} WPM`;
    button.addEventListener('click', () => {
      game.setConfig(pacePatch(preset));
      sync();
      onChange();
    });
  }

  for (const button of themeGrid.querySelectorAll('[data-theme]')) {
    button.addEventListener('click', () => {
      markTheme(button.dataset.theme);
      game.setConfig({ theme: button.dataset.theme });
      onChange();
    });
  }

  must('cfg-reset').addEventListener('click', () => {
    game.setConfig({ ...DEFAULT_CONFIG });
    sync();
    onChange();
  });

  sync();
  return { sync };
}
