import { normalizeKey } from './parseText.js';

/** Share of the reading area kept as a dead cross between the four taps. */
export const QUADRANT_GUTTER = 0.16;

const ZONES = {
  nw: { letters: 'A–G', digits: '0–2' },
  ne: { letters: 'H–M', digits: '3–4' },
  sw: { letters: 'N–S', digits: '5–6' },
  se: { letters: 'T–Z', digits: '7–9' },
};

const AREA_NAMES = new Set(Object.values(ZONES).flatMap((group) => [group.letters, group.digits]));

export function zoneName(zone) {
  return ZONES[zone]?.letters ?? null;
}

/** The range named in a miss. A digit names its number group. A letter names its letter group. */
export function areaName(zone, key) {
  const group = ZONES[zone];
  if (!group) return null;
  const folded = normalizeKey(key);
  if (folded >= '0' && folded <= '9') return group.digits;
  return group.letters;
}

/** The corner that owns this letter or digit. Anything else has none. */
export function zoneForKey(raw) {
  const key = normalizeKey(raw);
  if (!key) return null;
  if (key >= '0' && key <= '9') {
    const index = key.charCodeAt(0) - 48;
    if (index <= 2) return 'nw';
    if (index <= 4) return 'ne';
    if (index <= 6) return 'sw';
    return 'se';
  }
  if (key < 'A' || key > 'Z') return null;
  const index = key.charCodeAt(0) - 65;
  if (index <= 6) return 'nw';
  if (index <= 12) return 'ne';
  if (index <= 18) return 'sw';
  return 'se';
}

/**
 * Corner under a point inside a width×height box.
 * The middle cross returns null, and so does a point outside the box.
 */
export function zoneAt(x, y, width, height, gutter = QUADRANT_GUTTER) {
  if (!(width > 0) || !(height > 0)) return null;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const nx = x / width;
  const ny = y / height;
  if (nx < 0 || ny < 0 || nx > 1 || ny > 1) return null;
  const edge = (1 - gutter) / 2;
  const far = 1 - edge;
  if (nx >= edge && nx < far) return null;
  if (ny >= edge && ny < far) return null;
  const east = nx >= far;
  const south = ny >= far;
  if (!east && !south) return 'nw';
  if (east && !south) return 'ne';
  if (!east && south) return 'sw';
  return 'se';
}

export function missLine(reason, pressed, answer) {
  const letter = answer || '?';
  if (reason === 'wrong') {
    if (AREA_NAMES.has(pressed)) {
      return `That area was ${pressed}. This letter is ${letter}.`;
    }
    return `That key was ${pressed || '?'}. This letter is ${letter}.`;
  }
  return `Time ran out. This letter is ${letter}.`;
}
