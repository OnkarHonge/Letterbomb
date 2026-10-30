import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, LIMITS, PLAY_MODES, THEMES, VIEW_MODES } from '../src/engine/config.js';
import { FILTERS, LONG_WORD_LETTERS, VOWELS } from '../src/engine/parseText.js';
import {
  RECALL_QUESTION,
  missRule,
  pauseRule,
  recallHeading,
  RECITAL_IDLE,
  recallPrompt,
  roundNote,
  targetHud,
  wordMarks,
} from '../src/ui/paint.js';
import { wordWindowNote } from '../src/ui/settings.js';

const html = readFileSync(fileURLToPath(new URL('../index.html', import.meta.url)), 'utf8');
const css = readFileSync(fileURLToPath(new URL('../src/styles.css', import.meta.url)), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');

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

function rule(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`(?:^|\\n)\\s*${escaped}\\s*\\{([^}]*)\\}`));
  expect(match, selector).toBeTruthy();
  return match[1];
}

function decl(body, property) {
  const match = body.match(new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`));
  expect(match, property).toBeTruthy();
  return match[1].trim();
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
    expect(html).toContain('Each breath fills a blank in a sentence you just read.');
    expect(html.split(RECALL_QUESTION).length - 1).toBe(2);
    expect(html).toContain(
      '0 reads the whole article with no breath screen. A fill-in question still waits at the end.',
    );
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
    expect(checked('cfg-spot')).toBe(DEFAULT_CONFIG.spotCheck);
    expect(html).toContain(`>${DEFAULT_CONFIG.spotLookMs} ms<`);
    expect(html).toContain('id="idle-spot"');
    expect(html).toContain('then turns into blocks');
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
      'A normal word gives you 680 ms. A word with punctuation gives you 880 ms. The first word after a window gives you 880 ms. A dash, an ellipsis, or a double space gives you 133 ms.',
    );
    expect(wordWindowNote({ ...DEFAULT_CONFIG, openingMultiplier: 3 })).toBe(
      'A normal word gives you 680 ms. A word with punctuation gives you 880 ms. The first word after a window gives you 1480 ms. A dash, an ellipsis, or a double space gives you 133 ms.',
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
    expect(range('cfg-look')).toMatchObject({
      min: LIMITS.spotLookMs[0],
      max: LIMITS.spotLookMs[1],
      value: DEFAULT_CONFIG.spotLookMs,
    });
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

    const plays = [...html.matchAll(/name="play" value="([^"]+)"([^>]*)>/g)];
    expect(plays.map((match) => match[1])).toEqual([...PLAY_MODES]);
    const checkedPlay = plays.find((match) => /\schecked(?:[\s>]|$)/.test(match[2]));
    expect(checkedPlay[1]).toBe(DEFAULT_CONFIG.playMode);
    expect(html).toContain('the rest come from memory');
    expect(html).toContain('id="idle-recital"');

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
    expect(pauseRule(false, 'answer')).toContain('The blocks stay');
    expect(pauseRule(false, 'recital-look')).toContain('This phrase starts fresh');
    expect(pauseRule(false, 'recital-riff')).toContain('The phrase stays hidden');
    expect(RECITAL_IDLE).toContain('from memory');
    expect(pauseRule(true)).toBe(
      'That letter already counted. Resume moves on. Click a word to move the highlight.',
    );
  });

  it('groups tune into play, speed, breaths, and the board', () => {
    const headings = [...html.matchAll(/<h3>([^<]+)<\/h3>/g)].map((match) => match[1]);
    expect(headings).toEqual(['How you play', 'How fast', 'Breaths', 'The board']);
    expect(html).toContain(
      'A pace sets speed, forgiveness, and how long a miss freezes. The pauses, the answer, and advance-on-hit stay as you set them.',
    );
    expect(html).toContain('id="cfg-look-field" hidden');
    expect(html).toContain('Spot check stays off until you switch back to Words.');
    expect(html).toContain('Puts every control on this screen back to the start. The article stays.');
    expect(html).toContain('>Reset all<');
  });

  it('describes a breath the way the board asks it', () => {
    expect(roundNote(40)).toBe(
      'A breath screen shows up every 40 words and asks you to fill a blank from that stretch.',
    );
    expect(roundNote(0)).toBe(
      'Rounds are off, so the article runs straight through. One fill-in question waits at the end.',
    );
    expect(recallHeading('ask')).toBe('Which word was here?');
    expect(recallHeading('reveal')).toBe('That word was here.');
    expect(recallHeading('ready')).toBe('');
    expect(recallPrompt(false)).toBe('Round complete. Which word fills the blank?');
    expect(recallPrompt(true)).toBe('Article complete. Which word fills the blank?');
  });

  it('keeps the banner quiet during a spot check', () => {
    const word = { original: 'Word' };
    const base = { word, isTarget: true, config: { showTargetHud: true }, answer: 'W' };
    expect(targetHud({ ...base, status: 'playing' })).toEqual({ label: 'First letter', value: 'W' });
    expect(targetHud({ ...base, status: 'playing', config: { showTargetHud: false } })).toEqual({
      label: 'First letter',
      value: '•',
    });
    expect(targetHud({ ...base, status: 'idle' })).toEqual({ label: 'Up next', value: 'W' });
    expect(targetHud({ word, isTarget: false, status: 'playing' })).toEqual({ label: 'No key', value: '—' });
    expect(targetHud({
      ...base,
      status: 'playing',
      answer: null,
      spot: { phase: 'look', cueIndex: 3 },
    })).toEqual({ label: 'Read', value: '•' });
    expect(targetHud({
      ...base,
      status: 'playing',
      answer: null,
      spot: { phase: 'answer', cueIndex: 3 },
    })).toEqual({ label: 'Marked block', value: '•' });
    expect(targetHud({
      ...base,
      status: 'frozen',
      answer: 'D',
      spot: { phase: 'answer', cueIndex: 3 },
    })).toEqual({ label: 'Letter', value: 'D' });
    expect(targetHud({
      ...base,
      status: 'playing',
      answer: 'D',
      spot: { phase: 'reveal', cueIndex: 3 },
    })).toEqual({ label: 'Letter', value: 'D' });
    expect(targetHud({
      ...base,
      status: 'playing',
      answer: 'A',
      recital: { phase: 'look', place: 1, length: 4 },
    })).toEqual({ label: 'Read', value: 'A' });
    expect(targetHud({
      ...base,
      status: 'playing',
      answer: null,
      recital: { phase: 'riff', place: 2, length: 4 },
    })).toEqual({ label: 'Recall', value: '•' });
    expect(targetHud({
      ...base,
      status: 'frozen',
      answer: 'B',
      recital: { phase: 'reveal', place: 2, length: 4 },
    })).toEqual({ label: 'Letter', value: 'B' });
  });

  it('marks a gap beat the same way in the line and in the single-word view', () => {
    expect(wordMarks({ isTarget: true, original: 'Go' })).toEqual({
      className: 'word',
      pass: false,
      gap: false,
      label: '',
    });
    expect(wordMarks({ isTarget: false, original: 'the' })).toMatchObject({
      className: 'word is-pass',
      pass: true,
      gap: false,
    });
    expect(wordMarks({ isTarget: false, isGap: true, original: '—' })).toEqual({
      className: 'word is-pass is-gap',
      pass: true,
      gap: true,
      label: '',
    });
    expect(wordMarks({ isTarget: false, isGap: true, original: '  ' }).label).toBe('Pause');
    expect(wordMarks(null)).toEqual({
      className: 'word',
      pass: false,
      gap: false,
      label: '',
    });
  });
});

describe('gap beat layout', () => {
  it('keeps a double-space beat from collapsing in either view', () => {
    const gap = rule('.word.is-gap,\n.rsvp.is-gap .rsvp-current,\n.rsvp-side.is-gap');
    expect(decl(gap, 'white-space')).toBe('pre');
    expect(decl(gap, 'min-width')).toBe('0.7em');
    expect(decl(rule('.word.is-gap'), 'flex-shrink')).toBe('0');
  });
});

describe('time bar layout', () => {
  it('keeps the bar from shrinking once the article is in the column', () => {
    const timer = rule('.timer');
    expect(decl(timer, 'flex')).toBe('0 0 auto');
    expect(decl(timer, 'height')).toBe('8px');
    expect(decl(timer, 'min-height')).toBe('8px');

    const stage = rule('.stage');
    expect(decl(stage, 'min-height')).toBe('0');
    expect(decl(stage, 'min-width')).toBe('0');

    const scroller = rule('.karaoke, .rsvp');
    expect(decl(scroller, 'flex')).toBe('1 1 0px');
    expect(decl(scroller, 'min-height')).toBe('0');
    expect(decl(scroller, 'min-width')).toBe('0');
  });
});
