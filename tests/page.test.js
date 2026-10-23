import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, LIMITS, THEMES, VIEW_MODES } from '../src/engine/config.js';
import { FILTERS, LONG_WORD_LETTERS, VOWELS } from '../src/engine/parseText.js';
import { missRule, pauseRule } from '../src/ui/paint.js';
import { wordWindowNote } from '../src/ui/settings.js';

const html = readFileSync(fileURLToPath(new URL('../index.html', import.meta.url)), 'utf8');

function tag(id) {
  const match = html.match(new RegExp(`<input id="${id}"[^>]*>`));
  expect(match, id).toBeTruthy();
  return match[0];
}

function attr(source, name) {
  const match = source.match(new RegExp(`${name}="([^"]*)"`));
  expect(match, name).toBeTruthy();
  return match[1];
}

function range(id) {
  const source = tag(id);
  return {
    min: Number(attr(source, 'min')),
    max: Number(attr(source, 'max')),
    step: Number(attr(source, 'step')),
    value: Number(attr(source, 'value')),
  };
}

function checked(id) {
  return /\schecked(?:[\s>]|$)/.test(tag(id));
}

describe('page and engine', () => {
  it('opens on the same defaults the engine uses', () => {
    expect(html.slice(0, html.indexOf('<head'))).toContain(`data-theme="${DEFAULT_CONFIG.theme}"`);
    expect(html).toContain(`id="hud-pace">${DEFAULT_CONFIG.wpm}<`);
    expect(html).toContain(`>${DEFAULT_CONFIG.wpm} WPM<`);
    expect(html).toContain(`>${DEFAULT_CONFIG.forgivenessMs} ms<`);
    expect(html).toContain(`>${DEFAULT_CONFIG.freezeSec.toFixed(1)} s<`);
    expect(html).toContain(`>${DEFAULT_CONFIG.punctuationMultiplier.toFixed(1)}×<`);
    expect(html).toContain(`>${DEFAULT_CONFIG.roundSize} words<`);
    expect(html).toContain(`>${Math.round(DEFAULT_CONFIG.fontScale * 100)}%<`);
    expect(html).toContain(missRule(DEFAULT_CONFIG.freezeSec));
    expect(html).toContain(pauseRule(false));
    expect(html).toContain('Extra time on words with punctuation.');
    expect(html).toContain('Extra time on the first word after a window closes.');
    expect(html).toContain('plus your all-time streak');

    expect(checked('cfg-advance')).toBe(DEFAULT_CONFIG.advanceOnHit);
    expect(checked('cfg-target')).toBe(DEFAULT_CONFIG.showTargetHud);
    expect(checked('cfg-bar')).toBe(DEFAULT_CONFIG.showTimeBar);
    expect(checked('cfg-sound')).toBe(DEFAULT_CONFIG.sound);
    expect(checked('cfg-keypad')).toBe(DEFAULT_CONFIG.showKeypad);
    expect(checked('cfg-focus')).toBe(DEFAULT_CONFIG.focusMode);
    expect(checked('cfg-motion')).toBe(DEFAULT_CONFIG.reducedMotion);
    expect(attr(html.match(/id="toggle-sound"[^>]*>/)[0], 'aria-pressed')).toBe(String(DEFAULT_CONFIG.sound));
    expect(attr(html.match(/id="toggle-focus"[^>]*>/)[0], 'aria-pressed')).toBe(String(DEFAULT_CONFIG.focusMode));
    expect(attr(html.match(/id="toggle-keypad"[^>]*>/)[0], 'aria-expanded')).toBe(String(DEFAULT_CONFIG.showKeypad));
  });

  it('keeps every slider inside the engine limits', () => {
    expect(range('cfg-wpm')).toMatchObject({
      min: LIMITS.wpm[0],
      max: LIMITS.wpm[1],
      value: DEFAULT_CONFIG.wpm,
    });
    expect(range('cfg-forgive')).toMatchObject({
      min: LIMITS.forgivenessMs[0],
      max: LIMITS.forgivenessMs[1],
      value: DEFAULT_CONFIG.forgivenessMs,
    });
    expect(range('cfg-freeze')).toMatchObject({
      min: LIMITS.freezeSec[0],
      max: LIMITS.freezeSec[1],
      value: DEFAULT_CONFIG.freezeSec,
    });
    expect(range('cfg-punct')).toMatchObject({
      min: LIMITS.punctuationMultiplier[0],
      max: LIMITS.punctuationMultiplier[1],
      value: DEFAULT_CONFIG.punctuationMultiplier,
    });
    expect(range('cfg-opening')).toMatchObject({
      min: LIMITS.openingMultiplier[0],
      max: LIMITS.openingMultiplier[1],
      value: DEFAULT_CONFIG.openingMultiplier,
    });
    expect(wordWindowNote(DEFAULT_CONFIG)).toBe(
      'A normal word gives you 680 ms. A word with punctuation gives you 880 ms. The first word after a window gives you 880 ms.',
    );
    expect(wordWindowNote({ ...DEFAULT_CONFIG, openingMultiplier: 3 })).toBe(
      'A normal word gives you 680 ms. A word with punctuation gives you 880 ms. The first word after a window gives you 1480 ms.',
    );
    expect(range('cfg-round')).toMatchObject({
      min: LIMITS.roundSize[0],
      max: LIMITS.roundSize[1],
      value: DEFAULT_CONFIG.roundSize,
    });
    const font = range('cfg-font');
    expect(font.min / 100).toBe(LIMITS.fontScale[0]);
    expect(font.max / 100).toBe(LIMITS.fontScale[1]);
    expect(font.value / 100).toBe(DEFAULT_CONFIG.fontScale);
  });

  it('offers the same filters, views, and themes the engine accepts', () => {
    const options = [...html.matchAll(/<option value="([^"]+)">([^<]*)<\/option>/g)];
    expect(options.map((match) => match[1])).toEqual([...FILTERS]);
    const labels = Object.fromEntries(options.map((match) => [match[1], match[2]]));
    expect(labels.long).toContain(`${LONG_WORD_LETTERS} letters`);
    for (const letter of VOWELS) expect(labels.vowel).toContain(letter);
    expect(labels.vowel).not.toContain('Y');

    const views = [...html.matchAll(/name="view" value="([^"]+)"([^>]*)>/g)];
    expect(views.map((match) => match[1])).toEqual([...VIEW_MODES]);
    const checkedView = views.find((match) => /\schecked(?:[\s>]|$)/.test(match[2]));
    expect(checkedView[1]).toBe(DEFAULT_CONFIG.viewMode);

    const themes = [...html.matchAll(/data-theme="([^"]+)" aria-pressed="(true|false)"/g)];
    expect(themes.map((match) => match[1])).toEqual([...THEMES]);
    expect(themes.filter((match) => match[2] === 'true').map((match) => match[1])).toEqual([
      DEFAULT_CONFIG.theme,
    ]);
  });

  it('describes a miss and a pause the way the board behaves', () => {
    expect(missRule(0)).toBe('Hits build a streak. A miss moves straight on.');
    expect(missRule(0.8)).toContain('freezes the board');
    expect(pauseRule(false)).toContain('starts fresh');
    expect(pauseRule(true)).toBe(
      'That letter already counted. Resume moves on. Click a word to move the highlight.',
    );
  });
});
