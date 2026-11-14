export const LIMITS = {
  wpm: [10, 800],
  forgivenessMs: [0, 800],
  freezeSec: [0, 3],
  punctuationMultiplier: [1, 3],
  openingMultiplier: [1, 3],
};

export const DEFAULT_CONFIG = {
  wpm: 10,
  forgivenessMs: 800,
  freezeSec: 0.5,
  punctuationMultiplier: 1.5,
  openingMultiplier: 1.5,
  sound: true,
  theme: 'signal',
  reducedMotion: false,
  showKeypad: false,
  showCornerLabels: false,
  showCornerGrid: false,
};

/** Corner labels and grid lines start on only for a touchscreen. */
export function configForDevice(touchscreen) {
  const on = Boolean(touchscreen);
  return {
    ...DEFAULT_CONFIG,
    showCornerLabels: on,
    showCornerGrid: on,
  };
}

/**
 * The config a visit starts from.
 * A saved speed wins, including an old pace that no longer has a button.
 * Punctuation and the opening stretch stay at 1.5×.
 * Reduced motion follows the system setting on this visit.
 * A missing corner switch takes the device default.
 */
export function initialConfig({ touchscreen = false, saved, reducedMotion = false } = {}) {
  const base = configForDevice(touchscreen);
  const config = sanitizeConfig(
    saved && typeof saved === 'object' ? { ...base, ...saved } : base,
  );
  config.punctuationMultiplier = DEFAULT_CONFIG.punctuationMultiplier;
  config.openingMultiplier = DEFAULT_CONFIG.openingMultiplier;
  config.reducedMotion = Boolean(reducedMotion);
  return config;
}

export const PACE_PRESETS = {
  linger: {
    label: 'Linger',
    wpm: 10,
    forgivenessMs: 800,
    freezeSec: 0.5,
  },
  study: {
    label: 'Study',
    wpm: 20,
    forgivenessMs: 800,
    freezeSec: 0.5,
  },
  read: {
    label: 'Read',
    wpm: 40,
    forgivenessMs: 800,
    freezeSec: 0.5,
  },
};

const PACE_KEYS = ['wpm', 'forgivenessMs', 'freezeSec'];

/**
 * Values a Tune pace button writes: speed, forgiveness, and the miss freeze.
 * The punctuation stretch and the opening stretch stay as they are.
 */
export function pacePatch(preset) {
  const patch = {};
  for (const key of PACE_KEYS) {
    if (preset[key] !== undefined) patch[key] = preset[key];
  }
  return patch;
}

/** The pace whose written fields all match, or null once the speed has drifted. */
export function matchingPace(config) {
  const found = Object.keys(PACE_PRESETS).filter((id) => {
    const patch = pacePatch(PACE_PRESETS[id]);
    return Object.keys(patch).every((key) => config[key] === patch[key]);
  });
  return found.length === 1 ? found[0] : null;
}

export const THEMES = new Set(['signal', 'paper', 'night', 'contrast']);

export function sanitizeConfig(input) {
  const source = input && typeof input === 'object' ? input : {};
  const config = { ...DEFAULT_CONFIG };

  for (const key of Object.keys(DEFAULT_CONFIG)) {
    if (source[key] !== undefined) config[key] = source[key];
  }

  config.wpm = clampInt(config.wpm, LIMITS.wpm, DEFAULT_CONFIG.wpm);
  config.forgivenessMs = clampInt(
    config.forgivenessMs,
    LIMITS.forgivenessMs,
    DEFAULT_CONFIG.forgivenessMs,
  );
  config.freezeSec = clampNum(config.freezeSec, LIMITS.freezeSec, DEFAULT_CONFIG.freezeSec, 1);
  config.punctuationMultiplier = clampNum(
    config.punctuationMultiplier,
    LIMITS.punctuationMultiplier,
    DEFAULT_CONFIG.punctuationMultiplier,
    1,
  );
  config.openingMultiplier = clampNum(
    config.openingMultiplier,
    LIMITS.openingMultiplier,
    DEFAULT_CONFIG.openingMultiplier,
    1,
  );
  config.theme = THEMES.has(config.theme) ? config.theme : DEFAULT_CONFIG.theme;
  config.sound = asBool(config.sound, DEFAULT_CONFIG.sound);
  config.reducedMotion = asBool(config.reducedMotion, DEFAULT_CONFIG.reducedMotion);
  config.showKeypad = asBool(config.showKeypad, DEFAULT_CONFIG.showKeypad);
  config.showCornerLabels = asBool(config.showCornerLabels, DEFAULT_CONFIG.showCornerLabels);
  config.showCornerGrid = asBool(config.showCornerGrid, DEFAULT_CONFIG.showCornerGrid);

  return config;
}

function asBool(value, fallback) {
  return typeof value === 'boolean' ? value : fallback;
}

function clampInt(value, [min, max], fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
}

function clampNum(value, [min, max], fallback, places) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  const clamped = Math.min(max, Math.max(min, number));
  const factor = 10 ** places;
  return Math.round(clamped * factor) / factor;
}
