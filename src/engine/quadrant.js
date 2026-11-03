import { normalizeKey } from './parseText.js';

/** Share of the reading area kept as a dead cross between the four taps. */
export const QUADRANT_GUTTER = 0.16;

const ZONE_NAME = {
  nw: 'A–G',
  ne: 'H–M',
  sw: 'N–S',
  se: 'T–Z',
};

export function zoneName(zone) {
  return ZONE_NAME[zone] ?? null;
}

/** The corner that owns this letter. Digits and anything else have none. */
export function zoneForKey(raw) {
  const key = normalizeKey(raw);
  if (!key || key < 'A' || key > 'Z') return null;
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
    if (Object.values(ZONE_NAME).includes(pressed)) {
      return `That area was ${pressed}. This letter is ${letter}.`;
    }
    return `That key was ${pressed || '?'}. This letter is ${letter}.`;
  }
  return `Time ran out. This letter is ${letter}.`;
}
