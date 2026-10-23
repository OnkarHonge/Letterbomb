import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { LIMITS, PACE_PRESETS, pacePatch, sanitizeConfig } from '../src/engine/config.js';
import { wordDeadlineMs } from '../src/engine/timing.js';

const ORDER = ['linger', 'study', 'read', 'warmup', 'flow', 'reflex'];

// Time a target word stays up at the default 1.5× punctuation pause.
const WINDOWS_MS = {
  linger: { plain: 6800, punctuated: 9800 },
  study: { plain: 3800, punctuated: 5300 },
  read: { plain: 2300, punctuated: 3050 },
  warmup: { plain: 1457, punctuated: 1886 },
  flow: { plain: 965, punctuated: 1238 },
  reflex: { plain: 593, punctuated: 769 },
};

function windowMs(id, hasPunctuation) {
  return wordDeadlineMs({ hasPunctuation, isTarget: true }, PACE_PRESETS[id]);
}

describe('pace presets', () => {
  it('lists six paces from a first reading down to reflex', () => {
    expect(Object.keys(PACE_PRESETS)).toEqual(ORDER);
    expect(ORDER.map((id) => PACE_PRESETS[id].label)).toEqual([
      'Linger',
      'Study',
      'Read',
      'Warmup',
      'Flow',
      'Reflex',
    ]);
  });

  it('gives each pace a shorter word than the one before it', () => {
    for (const id of ORDER) {
      expect(windowMs(id, false)).toBe(WINDOWS_MS[id].plain);
      expect(windowMs(id, true)).toBe(WINDOWS_MS[id].punctuated);
    }

    const plain = ORDER.map((id) => windowMs(id, false));
    const punctuated = ORDER.map((id) => windowMs(id, true));
    expect([...plain].sort((a, b) => b - a)).toEqual(plain);
    expect([...punctuated].sort((a, b) => b - a)).toEqual(punctuated);
    expect(new Set(plain).size).toBe(plain.length);
  });

  it('keeps Read, Study, and Linger slower than Warmup', () => {
    const warmup = windowMs('warmup', false);
    for (const id of ['read', 'study', 'linger']) {
      expect(windowMs(id, false)).toBeGreaterThan(warmup);
      expect(windowMs(id, true)).toBeGreaterThan(windowMs('warmup', true));
    }
  });

  it('uses the full forgiveness cushion while learning a new word', () => {
    for (const id of ['linger', 'study', 'read']) {
      expect(PACE_PRESETS[id]).toMatchObject({
        forgivenessMs: LIMITS.forgivenessMs[1],
        freezeSec: 0.5,
        showTargetHud: true,
        advanceOnHit: true,
      });
    }
  });

  it('shows the answer on every pace, including Reflex', () => {
    for (const preset of Object.values(PACE_PRESETS)) {
      expect(preset.showTargetHud).toBe(true);
    }
  });

  it('writes pace fields without touching the rest of Tune', () => {
    expect(pacePatch(PACE_PRESETS.linger)).toEqual({
      wpm: 10,
      forgivenessMs: 800,
      freezeSec: 0.5,
      showTargetHud: true,
      advanceOnHit: true,
    });
    expect(pacePatch(PACE_PRESETS.warmup)).toEqual({
      wpm: 70,
      forgivenessMs: 600,
      freezeSec: 0.5,
      showTargetHud: true,
    });
    expect(pacePatch(PACE_PRESETS.reflex)).not.toHaveProperty('advanceOnHit');
  });

  it('survives sanitizing, so a chosen pace is not clamped away', () => {
    for (const preset of Object.values(PACE_PRESETS)) {
      expect(sanitizeConfig(pacePatch(preset))).toMatchObject(pacePatch(preset));
    }
  });
});

describe('Tune pace controls', () => {
  const html = readFileSync(fileURLToPath(new URL('../index.html', import.meta.url)), 'utf8');

  function range(id) {
    const tag = html.match(new RegExp(`<input id="${id}"[^>]*>`));
    const attr = (name) => Number(tag[0].match(new RegExp(`${name}="([^"]+)"`))[1]);
    return { min: attr('min'), max: attr('max'), step: attr('step') };
  }

  function landsOn(value, slider) {
    expect(value).toBeGreaterThanOrEqual(slider.min);
    expect(value).toBeLessThanOrEqual(slider.max);
    const steps = (value - slider.min) / slider.step;
    expect(steps).toBeCloseTo(Math.round(steps));
  }

  it('offers the paces in the same order as the presets', () => {
    const ids = [...html.matchAll(/data-pace="([^"]+)"/g)].map((match) => match[1]);
    expect(ids).toEqual(ORDER);
    for (const id of ORDER) {
      expect(html).toContain(`data-pace="${id}">${PACE_PRESETS[id].label}</button>`);
    }
  });

  it('lets every pace land on the speed, forgiveness, and freeze sliders', () => {
    const speed = range('cfg-wpm');
    const forgiveness = range('cfg-forgive');
    const freeze = range('cfg-freeze');
    expect(speed).toEqual({ min: LIMITS.wpm[0], max: LIMITS.wpm[1], step: 10 });
    expect(forgiveness).toEqual({
      min: LIMITS.forgivenessMs[0],
      max: LIMITS.forgivenessMs[1],
      step: 10,
    });
    expect(freeze).toEqual({ min: LIMITS.freezeSec[0], max: LIMITS.freezeSec[1], step: 0.1 });

    for (const preset of Object.values(PACE_PRESETS)) {
      landsOn(preset.wpm, speed);
      landsOn(preset.forgivenessMs, forgiveness);
      landsOn(preset.freezeSec, freeze);
    }
  });
});
