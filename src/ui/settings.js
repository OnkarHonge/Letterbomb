import { configForDevice, DEFAULT_CONFIG, PACE_PRESETS, matchingPace, pacePatch } from '../engine/config.js';
import { hasTouchscreen } from './device.js';
import { must } from './dom.js';

export function bindSettings(game, { onChange }) {
  const cornerLabels = must('cfg-corner-labels');
  const cornerGrid = must('cfg-corner-grid');
  const themeGrid = must('theme-grid');
  const themeButtons = [...themeGrid.querySelectorAll('[data-theme]')];
  const paceButtons = [...must('pace-grid').querySelectorAll('[data-pace]')];

  function markChoice(buttons, key, active) {
    for (const button of buttons) {
      const on = button.dataset[key] === active;
      button.classList.toggle('is-active', on);
      button.setAttribute('aria-pressed', String(on));
    }
  }

  function sync() {
    const config = game.config;
    cornerLabels.checked = config.showCornerLabels;
    cornerGrid.checked = config.showCornerGrid;
    markChoice(themeButtons, 'theme', config.theme);
    markChoice(paceButtons, 'pace', matchingPace(config));
  }

  function applyCorners() {
    game.setConfig({
      showCornerLabels: cornerLabels.checked,
      showCornerGrid: cornerGrid.checked,
    });
    onChange();
  }

  cornerLabels.addEventListener('change', applyCorners);
  cornerGrid.addEventListener('change', applyCorners);

  for (const button of paceButtons) {
    const preset = PACE_PRESETS[button.dataset.pace];
    if (!preset) continue;
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
    const device = configForDevice(hasTouchscreen());
    game.setConfig({
      ...pacePatch(PACE_PRESETS.linger),
      theme: DEFAULT_CONFIG.theme,
      showCornerLabels: device.showCornerLabels,
      showCornerGrid: device.showCornerGrid,
    });
    sync();
    onChange();
  });

  sync();
  return { sync };
}
