import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, LIMITS, PACE_PRESETS, matchingPace, pacePatch, sanitizeConfig } from '../src/engine/config.js';
import { wordDeadlineMs } from '../src/engine/timing.js';

const ORDER = ['linger', 'study', 'read'];

// Time a target word stays up at the default 1.5× punctuation pause.
const WINDOWS_MS = {
  linger: { plain: 6800, punctuated: 9800 },
  study: { plain: 3800, punctuated: 5300 },
  read: { plain: 2300, punctuated: 3050 },
};

function windowMs(id, hasPunctuation) {
  return wordDeadlineMs({ hasPunctuation, isTarget: true }, PACE_PRESETS[id]);
}

describe('pace presets', () => {
  it('lists Linger, Study, and Read', () => {
    expect(Object.keys(PACE_PRESETS)).toEqual(ORDER);
    expect(ORDER.map((id) => PACE_PRESETS[id].label)).toEqual(['Linger', 'Study', 'Read']);
  });

  it('gives each pace less time than the one before it', () => {
    for (const id of ORDER) {
      expect(windowMs(id, false)).toBe(WINDOWS_MS[id].plain);
      expect(windowMs(id, true)).toBe(WINDOWS_MS[id].punctuated);
    }

    for (let index = 1; index < ORDER.length; index += 1) {
      expect(windowMs(ORDER[index], false)).toBeLessThan(windowMs(ORDER[index - 1], false));
      expect(windowMs(ORDER[index], true)).toBeLessThan(windowMs(ORDER[index - 1], true));
    }
  });

  it('uses the full forgiveness cushion while learning a new word', () => {
    for (const id of ['linger', 'study', 'read']) {
      expect(PACE_PRESETS[id]).toMatchObject({
        forgivenessMs: LIMITS.forgivenessMs[1],
        freezeSec: 0.5,
      });
    }
  });

  it('writes only speed, forgiveness, and the miss freeze', () => {
    for (const preset of Object.values(PACE_PRESETS)) {
      expect(pacePatch(preset)).toEqual({
        wpm: preset.wpm,
        forgivenessMs: preset.forgivenessMs,
        freezeSec: preset.freezeSec,
      });
    }
  });

  it('matches a pace only when every field it writes is current', () => {
    expect(matchingPace(DEFAULT_CONFIG)).toBe('linger');
    expect(matchingPace({ ...DEFAULT_CONFIG, wpm: 150, forgivenessMs: 280, freezeSec: 0.8 })).toBeNull();
    for (const id of ORDER) {
      const config = sanitizeConfig(pacePatch(PACE_PRESETS[id]));
      expect(matchingPace(config)).toBe(id);
      expect(matchingPace({ ...config, forgivenessMs: config.forgivenessMs + 10 })).toBeNull();
    }
    const linger = sanitizeConfig({
      ...pacePatch(PACE_PRESETS.linger),
      advanceOnHit: false,
      showTargetHud: false,
    });
    expect(matchingPace(linger)).toBe('linger');
  });

  it('survives sanitizing, so a chosen pace is not clamped away', () => {
    for (const preset of Object.values(PACE_PRESETS)) {
      expect(sanitizeConfig(pacePatch(preset))).toMatchObject(pacePatch(preset));
    }
  });
});

describe('Tune pace controls', () => {
  const html = readFileSync(fileURLToPath(new URL('../index.html', import.meta.url)), 'utf8');

  it('offers the paces in the same order as the presets', () => {
    const ids = [...html.matchAll(/data-pace="([^"]+)"/g)].map((match) => match[1]);
    expect(ids).toEqual(ORDER);
    for (const id of ORDER) {
      expect(html).toContain(
        `data-pace="${id}" aria-pressed="false">${PACE_PRESETS[id].label}</button>`,
      );
    }
  });

  it('keeps every pace inside the speed limits', () => {
    for (const preset of Object.values(PACE_PRESETS)) {
      expect(preset.wpm).toBeGreaterThanOrEqual(LIMITS.wpm[0]);
      expect(preset.wpm).toBeLessThanOrEqual(LIMITS.wpm[1]);
      expect(preset.forgivenessMs).toBeGreaterThanOrEqual(LIMITS.forgivenessMs[0]);
      expect(preset.forgivenessMs).toBeLessThanOrEqual(LIMITS.forgivenessMs[1]);
      expect(preset.freezeSec).toBeGreaterThanOrEqual(LIMITS.freezeSec[0]);
      expect(preset.freezeSec).toBeLessThanOrEqual(LIMITS.freezeSec[1]);
    }
  });
});
