import { configForDevice, PACE_PRESETS, matchingPace, pacePatch } from '../engine/config.js';
import { hasTouchscreen } from './device.js';
import { wordDeadlineMs } from '../engine/timing.js';
import { must, setText } from './dom.js';

export function wordWindowNote(config) {
  const plain = wordDeadlineMs({ hasPunctuation: false, isTarget: true }, config);
  const marked = wordDeadlineMs({ hasPunctuation: true, isTarget: true }, config);
  const opened = wordDeadlineMs({ hasPunctuation: false, isTarget: true, isOpening: true }, config);
  const gap = wordDeadlineMs({ isGap: true }, config);
  return [
    `A normal word gives you ${plain} ms.`,
    `A word with punctuation gives you ${marked} ms.`,
    `The first word after a window gives you ${opened} ms.`,
    `A dash, an ellipsis, or a double space gives you ${gap} ms.`,
  ].join(' ');
}

export function bindSettings(game, { onChange }) {
  const wpm = must('cfg-wpm');
  const wpmVal = must('cfg-wpm-val');
  const forgive = must('cfg-forgive');
  const forgiveVal = must('cfg-forgive-val');
  const freeze = must('cfg-freeze');
  const freezeVal = must('cfg-freeze-val');
  const punct = must('cfg-punct');
  const punctVal = must('cfg-punct-val');
  const opening = must('cfg-opening');
  const openingVal = must('cfg-opening-val');
  const round = must('cfg-round');
  const roundVal = must('cfg-round-val');
  const endQuestion = must('cfg-end-question');
  const look = must('cfg-look');
  const lookVal = must('cfg-look-val');
  const lookField = must('cfg-look-field');
  const spot = must('cfg-spot');
  const spotNote = must('cfg-spot-note');
  const cornerLabels = must('cfg-corner-labels');
  const cornerGrid = must('cfg-corner-grid');
  const cornerNote = must('cfg-corner-note');
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
  const themeButtons = [...themeGrid.querySelectorAll('[data-theme]')];
  const paceButtons = [...must('pace-grid').querySelectorAll('[data-pace]')];
  const viewRadios = [...document.querySelectorAll('input[name="view"]')];
  const playRadios = [...document.querySelectorAll('input[name="play"]')];

  function markChoice(buttons, key, active) {
    for (const button of buttons) {
      const on = button.dataset[key] === active;
      button.classList.toggle('is-active', on);
      button.setAttribute('aria-pressed', String(on));
    }
  }

  function paintLabels(config) {
    setText(wpmVal, `${config.wpm} WPM`);
    setText(forgiveVal, `${config.forgivenessMs} ms`);
    setText(freezeVal, `${config.freezeSec.toFixed(1)} s`);
    setText(punctVal, `${config.punctuationMultiplier.toFixed(1)}×`);
    setText(openingVal, `${config.openingMultiplier.toFixed(1)}×`);
    setText(roundVal, config.roundSize === 0 ? 'No breaks' : `${config.roundSize} words`);
    setText(lookVal, `${config.spotLookMs} ms`);
    setText(fontVal, `${Math.round(config.fontScale * 100)}%`);
    setText(windowNote, wordWindowNote(config));
  }

  function selectedPlay() {
    return playRadios.find((radio) => radio.checked)?.value || game.config.playMode;
  }

  function readForm() {
    const theme = themeButtons.find((button) => button.getAttribute('aria-pressed') === 'true')?.dataset.theme;
    const playMode = selectedPlay();
    return {
      wpm: Number(wpm.value),
      forgivenessMs: Number(forgive.value),
      freezeSec: Number(freeze.value),
      punctuationMultiplier: Number(punct.value),
      openingMultiplier: Number(opening.value),
      roundSize: Number(round.value),
      endQuestion: endQuestion.checked,
      spotLookMs: Number(look.value),
      fontScale: Number(font.value) / 100,
      filter: filter.value,
      viewMode: viewRadios.find((radio) => radio.checked)?.value,
      playMode,
      advanceOnHit: advance.checked,
      showTargetHud: target.checked,
      showTimeBar: bar.checked,
      sound: sound.checked,
      showKeypad: keypad.checked,
      showCornerLabels: playMode === 'recital' ? game.config.showCornerLabels : cornerLabels.checked,
      showCornerGrid: playMode === 'recital' ? game.config.showCornerGrid : cornerGrid.checked,
      focusMode: focus.checked,
      reducedMotion: motion.checked,
      spotCheck: playMode === 'recital' ? game.config.spotCheck : spot.checked,
      ...(theme ? { theme } : {}),
    };
  }

  function paintPlay() {
    const config = game.config;
    const recital = config.playMode === 'recital';
    spot.disabled = recital;
    spot.checked = recital ? false : config.spotCheck;
    spotNote.hidden = !recital;
    lookField.hidden = recital || !config.spotCheck;
    if (recital) spot.setAttribute('aria-describedby', 'cfg-spot-note');
    else spot.removeAttribute('aria-describedby');
    cornerLabels.disabled = recital;
    cornerGrid.disabled = recital;
    cornerLabels.checked = recital ? false : config.showCornerLabels;
    cornerGrid.checked = recital ? false : config.showCornerGrid;
    cornerNote.hidden = !recital;
    for (const input of [cornerLabels, cornerGrid]) {
      if (recital) input.setAttribute('aria-describedby', 'cfg-corner-note');
      else input.removeAttribute('aria-describedby');
    }
  }

  function applyForm() {
    if (selectedPlay() === 'words' && game.config.playMode === 'recital') {
      spot.checked = game.config.spotCheck;
      cornerLabels.checked = game.config.showCornerLabels;
      cornerGrid.checked = game.config.showCornerGrid;
    }
    game.setConfig(readForm());
    paintLabels(game.config);
    markChoice(paceButtons, 'pace', matchingPace(game.config));
    paintPlay();
    onChange();
  }

  function sync() {
    const config = game.config;
    wpm.value = String(config.wpm);
    forgive.value = String(config.forgivenessMs);
    freeze.value = String(config.freezeSec);
    punct.value = String(config.punctuationMultiplier);
    opening.value = String(config.openingMultiplier);
    round.value = String(config.roundSize);
    endQuestion.checked = config.endQuestion;
    look.value = String(config.spotLookMs);
    font.value = String(Math.round(config.fontScale * 100));
    filter.value = config.filter;
    advance.checked = config.advanceOnHit;
    target.checked = config.showTargetHud;
    bar.checked = config.showTimeBar;
    sound.checked = config.sound;
    keypad.checked = config.showKeypad;
    cornerLabels.checked = config.showCornerLabels;
    cornerGrid.checked = config.showCornerGrid;
    focus.checked = config.focusMode;
    motion.checked = config.reducedMotion;
    spot.checked = config.spotCheck;
    for (const radio of viewRadios) radio.checked = radio.value === config.viewMode;
    for (const radio of playRadios) radio.checked = radio.value === config.playMode;
    markChoice(themeButtons, 'theme', config.theme);
    markChoice(paceButtons, 'pace', matchingPace(config));
    paintLabels(config);
    paintPlay();
  }

  for (const input of [wpm, forgive, freeze, punct, opening, round, look, font]) {
    input.addEventListener('input', applyForm);
  }
  for (const input of [filter, advance, target, bar, sound, keypad, focus, motion, spot, endQuestion, cornerLabels, cornerGrid, ...viewRadios, ...playRadios]) {
    input.addEventListener('change', applyForm);
  }

  for (const button of paceButtons) {
    const preset = PACE_PRESETS[button.dataset.pace];
    if (!preset) continue;
    button.textContent = `${preset.label} · ${preset.wpm} WPM`;
    button.addEventListener('click', () => {
      game.setConfig(pacePatch(preset));
      sync();
      onChange();
    });
  }

  for (const button of themeButtons) {
    button.addEventListener('click', () => {
      markChoice(themeButtons, 'theme', button.dataset.theme);
      game.setConfig({ theme: button.dataset.theme });
      onChange();
    });
  }

  must('cfg-reset').addEventListener('click', () => {
    game.setConfig(configForDevice(hasTouchscreen()));
    sync();
    onChange();
  });

  sync();
  return { sync };
}
