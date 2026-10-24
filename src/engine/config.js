import { FILTERS } from './parseText.js';

export const LIMITS = {
  wpm: [10, 800],
  forgivenessMs: [0, 800],
  freezeSec: [0, 3],
  punctuationMultiplier: [1, 3],
  openingMultiplier: [1, 3],
  fontScale: [0.85, 1.6],
  roundSize: [0, 200],
  spotLookMs: [200, 800],
};

export const DEFAULT_CONFIG = {
  wpm: 150,
  forgivenessMs: 280,
  freezeSec: 0.8,
  punctuationMultiplier: 1.5,
  openingMultiplier: 1.5,
  viewMode: 'karaoke',
  filter: 'all',
  sound: true,
  theme: 'signal',
  advanceOnHit: true,
  showTargetHud: true,
  showTimeBar: true,
  reducedMotion: false,
  showKeypad: true,
  focusMode: false,
  fontScale: 1,
  roundSize: 40,
  spotCheck: false,
  spotLookMs: 350,
};

export const PACE_PRESETS = {
  linger: {
    label: 'Linger',
    wpm: 10,
    forgivenessMs: 800,
    freezeSec: 0.5,
    showTargetHud: true,
    advanceOnHit: true,
  },
  study: {
    label: 'Study',
    wpm: 20,
    forgivenessMs: 800,
    freezeSec: 0.5,
    showTargetHud: true,
    advanceOnHit: true,
  },
  read: {
    label: 'Read',
    wpm: 40,
    forgivenessMs: 800,
    freezeSec: 0.5,
    showTargetHud: true,
    advanceOnHit: true,
  },
  warmup: {
    label: 'Warmup',
    wpm: 70,
    forgivenessMs: 600,
    freezeSec: 0.5,
    showTargetHud: true,
  },
  flow: {
    label: 'Flow',
    wpm: 110,
    forgivenessMs: 420,
    freezeSec: 0.5,
    showTargetHud: true,
  },
  reflex: {
    label: 'Reflex',
    wpm: 170,
    forgivenessMs: 240,
    freezeSec: 0.8,
    showTargetHud: true,
  },
};

const PACE_KEYS = ['wpm', 'forgivenessMs', 'freezeSec', 'showTargetHud', 'advanceOnHit'];

/**
 * Values a Tune pace button writes.
 * A preset that omits a field, such as advanceOnHit on Warmup, leaves that setting alone.
 */
export function pacePatch(preset) {
  const patch = {};
  for (const key of PACE_KEYS) {
    if (preset[key] !== undefined) patch[key] = preset[key];
  }
  return patch;
}

/** The pace whose written fields all match, or null once the sliders have drifted. */
export function matchingPace(config) {
  const found = Object.keys(PACE_PRESETS).filter((id) => {
    const patch = pacePatch(PACE_PRESETS[id]);
    return Object.keys(patch).every((key) => config[key] === patch[key]);
  });
  return found.length === 1 ? found[0] : null;
}

export const VIEW_MODES = new Set(['karaoke', 'rsvp']);
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
  config.fontScale = clampNum(config.fontScale, LIMITS.fontScale, DEFAULT_CONFIG.fontScale, 2);
  config.roundSize = clampInt(config.roundSize, LIMITS.roundSize, DEFAULT_CONFIG.roundSize);
  config.spotLookMs = clampInt(config.spotLookMs, LIMITS.spotLookMs, DEFAULT_CONFIG.spotLookMs);
  config.viewMode = VIEW_MODES.has(config.viewMode) ? config.viewMode : DEFAULT_CONFIG.viewMode;
  config.filter = FILTERS.has(config.filter) ? config.filter : DEFAULT_CONFIG.filter;
  config.theme = THEMES.has(config.theme) ? config.theme : DEFAULT_CONFIG.theme;
  config.sound = asBool(config.sound, DEFAULT_CONFIG.sound);
  config.advanceOnHit = asBool(config.advanceOnHit, DEFAULT_CONFIG.advanceOnHit);
  config.showTargetHud = asBool(config.showTargetHud, DEFAULT_CONFIG.showTargetHud);
  config.showTimeBar = asBool(config.showTimeBar, DEFAULT_CONFIG.showTimeBar);
  config.reducedMotion = asBool(config.reducedMotion, DEFAULT_CONFIG.reducedMotion);
  config.showKeypad = asBool(config.showKeypad, DEFAULT_CONFIG.showKeypad);
  config.focusMode = asBool(config.focusMode, DEFAULT_CONFIG.focusMode);
  config.spotCheck = asBool(config.spotCheck, DEFAULT_CONFIG.spotCheck);

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
