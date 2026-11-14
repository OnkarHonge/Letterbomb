import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PLACEHOLDER } from '../src/data/presets.js';
import { DEFAULT_CONFIG, PACE_PRESETS, THEMES } from '../src/engine/config.js';
import { countWords } from '../src/engine/parseText.js';
import {
  cornerBoard,
  missRule,
  paceLabel,
  pauseRule,
  secondsLeftLabel,
  stepHint,
  wordMarks,
} from '../src/ui/paint.js';
import { keptHeading } from '../src/ui/library.js';

const html = readFileSync(fileURLToPath(new URL('../index.html', import.meta.url)), 'utf8');
const css = readFileSync(fileURLToPath(new URL('../src/styles.css', import.meta.url)), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');

function attr(source, name) {
  const match = source.match(new RegExp(`${name}="([^"]*)"`));
  expect(match, name).toBeTruthy();
  return match[1];
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
    expect(html).toContain('id="hud-streak"');
    expect(html).not.toContain('id="hud-score"');
    expect(html).not.toContain('id="hud-pace"');
    expect(html).not.toContain('id="hud-accuracy"');
    expect(html).not.toContain('id="modal-stats"');
    expect(html).toContain(missRule(DEFAULT_CONFIG.freezeSec));
    expect(html).toContain(pauseRule(false));
    expect(html).toContain(stepHint());
    expect(html).not.toContain('Each breath fills a blank');
    expect(html).not.toContain('from memory');
    expect(attr(html.match(/id="toggle-sound"[^>]*>/)[0], 'aria-pressed')).toBe(String(DEFAULT_CONFIG.sound));
    expect(attr(html.match(/id="toggle-keys"[^>]*>/)[0], 'aria-pressed')).toBe('false');
    expect(html).toContain('id="keypad-dock"');
    expect(html.match(/id="keypad-dock"[^>]*>/)[0]).toContain('hidden');
  });

  it('offers the three paces and the four themes', () => {
    const ids = [...html.matchAll(/data-pace="([^"]+)"/g)].map((match) => match[1]);
    expect(ids).toEqual(Object.keys(PACE_PRESETS));
    const themes = [...html.matchAll(/data-theme="([^"]+)" aria-pressed="(true|false)"/g)];
    expect(themes.map((match) => match[1])).toEqual([...THEMES]);
    expect(themes.filter((match) => match[2] === 'true').map((match) => match[1])).toEqual([
      DEFAULT_CONFIG.theme,
    ]);
    expect(html).toContain('id="cfg-corner-labels"');
    expect(html).toContain('id="cfg-corner-grid"');
    expect(html).not.toContain('id="cfg-filter"');
    expect(html).not.toContain('id="cfg-wpm"');
    expect(html).not.toContain('name="play"');
    expect(html).not.toContain('name="view"');
  });

  it('describes a miss and a pause the way the board behaves', () => {
    expect(missRule(0)).toBe('Hits build a streak. A miss moves straight on.');
    expect(missRule(0.8)).toContain('freezes the board');
    expect(pauseRule(false)).toContain('starts fresh');
    expect(pauseRule(true)).toBe(
      'That letter already counted. Resume moves on. Click a word to move the highlight.',
    );
    expect(stepHint()).toContain('next sentence');
  });

  it('keeps the drill, the corners, and a straight run to the end', () => {
    expect(html).toContain('id="idle-start" class="btn btn-primary btn-large btn-block"');
    expect(html).toContain('id="idle-drill" class="btn btn-block"');
    expect(html).toContain('Drill corners');
    expect(html).toContain('It stays until you tap its corner.');
    expect(html).toContain('id="quadrant-board"');
    expect(html).toContain('Top left is A–G and 0–2');
    expect(html).toContain('A–G<br>0–2');
    expect(html).toContain('id="enter-full"');
    expect(html).toContain('id="exit-full"');
    expect(html).toContain('id="sentence-prev"');
    expect(html).toContain('id="sentence-next"');
    expect(html).not.toContain('id="panel-break"');
    expect(html).toContain('id="done-score"');
    expect(html).toContain('id="done-streak"');
    expect(html).toContain('id="done-best"');
    expect(html).not.toContain('id="done-accuracy"');
    expect(decl(rule('.overlay'), 'flex-direction')).toBe('column');
    expect(decl(rule('.panel'), 'margin-block')).toBe('auto');
  });

  it('marks a gap beat the same way in the line', () => {
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

describe('placeholder article', () => {
  it('keeps The Dopamine Engine as the only built-in article', () => {
    expect(PLACEHOLDER).toMatchObject({
      id: 'adhd',
      title: 'The Dopamine Engine',
    });
    expect(countWords(PLACEHOLDER.text)).toBeGreaterThan(0);
    expect(html).not.toContain('Cybernetic Odyssey');
    expect(html).not.toContain('Quantum Entanglement');
    expect(html).not.toContain('Stoic Wisdom');
  });
});

describe('kept lines', () => {
  it('puts the list and the phrase with the articles, and keeps History out', () => {
    const panel = html.slice(html.indexOf('id="modal-library"'), html.indexOf('id="modal-mark"'));
    const order = ['kept-list', 'shelf-phrase', 'article-input', 'load-article'];
    let at = -1;
    for (const id of order) {
      const next = panel.indexOf(id);
      expect(next, id).toBeGreaterThan(at);
      at = next;
    }
    expect(panel).toContain('The same phrase shares kept lines.');
    expect(panel).not.toContain('History');
    expect(panel).not.toContain('preset-list');
    expect(keptHeading(3)).toBe('Kept lines · 3');
    expect(keptHeading(196)).toBe('Kept lines · 196. 4 left.');
    expect(keptHeading(200)).toBe('Kept lines · 200. Remove one before keeping another.');
    expect(html).toContain('id="keep-line"');
    expect(html).toContain('id="modal-mark"');
    expect(html).toContain('id="done-keep"');
    expect(html).toContain('id="pause-keep-sentence"');
    expect(html).toContain('id="done-keep-sentence"');
    expect(html).toContain('id="corner-pads"');
    expect(html).toContain('id="run-status"');
    expect(html).toContain('id="idle-restart"');
    expect(html).not.toContain('id="break-keep"');
  });
});

describe('corner guides', () => {
  it('draws a label and a grid line only while a run is active', () => {
    const on = { showCornerLabels: true, showCornerGrid: true, active: true };
    expect(cornerBoard(on)).toEqual({ board: true, labels: true, grid: true });
    expect(cornerBoard({ ...on, showCornerGrid: false })).toEqual({
      board: true,
      labels: true,
      grid: false,
    });
    expect(cornerBoard({ ...on, showCornerLabels: false, showCornerGrid: false })).toEqual({
      board: false,
      labels: false,
      grid: false,
    });
    expect(cornerBoard({ ...on, active: false }).board).toBe(false);
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

describe('reading full screen', () => {
  it('keeps the place, the pace, the streak, and the seconds on the card', () => {
    expect(paceLabel({ wpm: 10, forgivenessMs: 800, freezeSec: 0.5 })).toBe('Linger');
    expect(paceLabel({ wpm: 15, forgivenessMs: 800, freezeSec: 0.5 })).toBe('Custom');
    expect(secondsLeftLabel({ status: 'playing', deadlineMs: 2300, progress: 0.5 })).toBe('1.1s');
    expect(secondsLeftLabel({ status: 'frozen', freezeLeftMs: 500 })).toBe('0.5s');
    expect(decl(rule('.run-status'), 'display')).toBe('none');
    expect(decl(rule('body.is-reading-full .run-status'), 'display')).toBe('flex');
  });

  it('hides the rest of the page and keeps Exit inside the card', () => {
    expect(decl(rule('#exit-full'), 'display')).toBe('none');
    const hidden = rule(
      'body.is-reading-full .top,\nbody.is-reading-full .hud,\nbody.is-reading-full .keypad-dock',
    );
    expect(decl(hidden, 'display')).toBe('none');
    const arena = rule('body.is-reading-full #arena,\n#arena:fullscreen,\n#arena:-webkit-full-screen');
    expect(decl(arena, 'position')).toBe('fixed');
    expect(decl(arena, 'inset')).toBe('0');
    const exit = rule(
      'body.is-reading-full #exit-full,\n#arena:fullscreen #exit-full,\n#arena:-webkit-full-screen #exit-full',
    );
    expect(decl(exit, 'display')).toBe('inline-flex');
  });
});

describe('corner drill layout', () => {
  it('lets a corner tap through and keeps Stop drill clickable', () => {
    expect(decl(rule('.drill'), 'pointer-events')).toBe('none');
    expect(decl(rule('.drill .btn'), 'pointer-events')).toBe('auto');
    expect(decl(rule('.corner-pads'), 'pointer-events')).toBe('none');
    expect(decl(rule('.corner-pad'), 'pointer-events')).toBe('auto');
    expect(decl(rule('.stage'), 'pointer-events')).toBe('none');
    expect(decl(rule('.karaoke'), 'pointer-events')).toBe('none');
    expect(decl(rule('.karaoke .word,\n.overlay,\n.drill .btn'), 'pointer-events')).toBe('auto');
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
