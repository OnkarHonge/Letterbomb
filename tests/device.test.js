import { describe, expect, it } from 'vitest';
import { hasTouchscreen } from '../src/ui/device.js';

function screen({ coarse = false, points = 0, fail = false } = {}) {
  return {
    matchMedia(query) {
      if (fail) throw new Error('unsupported');
      return { matches: query === '(any-pointer: coarse)' && coarse };
    },
    navigator: { maxTouchPoints: points },
  };
}

describe('touchscreen detection', () => {
  it('treats a coarse pointer or any touch point as a touchscreen', () => {
    expect(hasTouchscreen(screen())).toBe(false);
    expect(hasTouchscreen(screen({ coarse: true }))).toBe(true);
    expect(hasTouchscreen(screen({ points: 5 }))).toBe(true);
    expect(hasTouchscreen(screen({ fail: true, points: 2 }))).toBe(true);
    expect(hasTouchscreen(screen({ fail: true, points: 0 }))).toBe(false);
    expect(hasTouchscreen({})).toBe(false);
  });
});
