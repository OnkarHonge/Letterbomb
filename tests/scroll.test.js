import { describe, expect, it } from 'vitest';
import {
  MIN_PREVIEW_LINES,
  PREVIEW_INSET,
  RECITAL_TOP_ROWS,
  SCROLL_TAKEOVER,
  advanceScroll,
  beginScroll,
  easedScrollTop,
  nextLineUnder,
  recitalTailSpace,
  scrollEaseMs,
  scrollTopForReadingLine,
  scrollTopForRecitalLine,
  scrollTopToReveal,
  scrollWasTaken,
} from '../src/ui/scroll.js';

const row = (top, height = 40) => ({ top, height });

describe('scrollTopToReveal', () => {
  it('leaves the scroller alone when the word is fully inside', () => {
    expect(scrollTopToReveal(0, 200, 40, 30)).toBe(0);
    expect(scrollTopToReveal(80, 200, 100, 36)).toBe(80);
  });

  it('scrolls the minimum when a word crosses the bottom edge', () => {
    // Centering this word would jump to 100. The word only needs 32px.
    expect(scrollTopToReveal(0, 200, 180, 40, 12)).toBe(32);
  });

  it('scrolls the minimum when a word is above the view', () => {
    expect(scrollTopToReveal(100, 200, 20, 30, 12)).toBe(8);
  });

  it('pins a word taller than the view to its top', () => {
    expect(scrollTopToReveal(40, 100, 180, 140, 12)).toBe(180);
    expect(scrollTopToReveal(180, 100, 180, 140, 12)).toBe(180);
  });
});

describe('nextLineUnder', () => {
  it('measures the next word-row and stops before the one after it', () => {
    const metrics = nextLineUnder([
      row(0, 36),
      row(0, 40),
      row(50, 40),
      row(52, 48),
      row(100, 90),
    ], 0, 40);
    expect(metrics.lineHeight).toBe(50);
    expect(metrics.nextLineBottom).toBe(100);
  });

  it('uses the smallest row step, so a paragraph gap stays a gap', () => {
    const metrics = nextLineUnder([
      row(0),
      row(50),
      row(160),
    ], 50, 40);
    expect(metrics.lineHeight).toBe(50);
    expect(metrics.nextLineBottom).toBe(200);
  });

  it('reports no following line on the last row', () => {
    expect(nextLineUnder([row(0), row(2, 30)], 0, 36)).toEqual({
      lineHeight: 36,
      nextLineBottom: null,
    });
    expect(nextLineUnder([], 12, 20)).toEqual({
      lineHeight: 20,
      nextLineBottom: null,
    });
  });
});

describe('scrollTopForReadingLine', () => {
  it('previews once three lines fit and not before', () => {
    expect(MIN_PREVIEW_LINES).toBe(3);
    const shared = {
      scrollTop: 0,
      wordTop: 100,
      wordHeight: 40,
      lineHeight: 50,
      nextLineBottom: 190,
    };
    const tall = 50 * MIN_PREVIEW_LINES;
    expect(scrollTopForReadingLine({ ...shared, viewHeight: tall })).toBe(190 - tall + PREVIEW_INSET);
    expect(scrollTopForReadingLine({ ...shared, viewHeight: tall - 1 })).toBe(
      scrollTopToReveal(0, tall - 1, 100, 40, 12),
    );
  });

  it('uses the plain reveal when the line height is unknown', () => {
    expect(scrollTopForReadingLine({
      scrollTop: 0,
      viewHeight: 200,
      wordTop: 150,
      wordHeight: 40,
      lineHeight: 0,
      nextLineBottom: 240,
    })).toBe(scrollTopToReveal(0, 200, 150, 40, 12));
  });

  it('stays put while a line is already showing under the one being read', () => {
    expect(scrollTopForReadingLine({
      scrollTop: 0,
      viewHeight: 220,
      wordTop: 100,
      wordHeight: 40,
      lineHeight: 50,
      nextLineBottom: 190,
    })).toBe(0);
  });

  it('scrolls about one line so the next line is the last line in view', () => {
    const next = scrollTopForReadingLine({
      scrollTop: 0,
      viewHeight: 200,
      wordTop: 150,
      wordHeight: 40,
      lineHeight: 50,
      nextLineBottom: 240,
    });
    expect(next).toBe(240 - 200 + PREVIEW_INSET);
    expect(next).toBeLessThanOrEqual(150 - 12);
  });

  it('lets the last line of the article sit at the bottom', () => {
    expect(scrollTopForReadingLine({
      scrollTop: 0,
      viewHeight: 200,
      wordTop: 180,
      wordHeight: 40,
      lineHeight: 50,
      nextLineBottom: null,
    })).toBe(scrollTopToReveal(0, 200, 180, 40, 12));
  });

  it('does not scroll backward when the reading line is already comfortable', () => {
    expect(scrollTopForReadingLine({
      scrollTop: 80,
      viewHeight: 200,
      wordTop: 120,
      wordHeight: 40,
      lineHeight: 50,
      nextLineBottom: 210,
    })).toBe(80);
  });

  it('still brings back a line that has scrolled above the view', () => {
    expect(scrollTopForReadingLine({
      scrollTop: 200,
      viewHeight: 200,
      wordTop: 20,
      wordHeight: 40,
      lineHeight: 50,
      nextLineBottom: 110,
    })).toBe(8);
  });

  it('does not push the reading line above the view to reveal a large gap', () => {
    const next = scrollTopForReadingLine({
      scrollTop: 0,
      viewHeight: 200,
      wordTop: 40,
      wordHeight: 40,
      lineHeight: 50,
      nextLineBottom: 400,
    });
    expect(next).toBe(28);
  });
});

describe('recital reading line', () => {
  it('puts the phrase on the second row when more than three rows fit', () => {
    expect(RECITAL_TOP_ROWS).toBe(3);
    expect(scrollTopForRecitalLine({
      scrollTop: 0,
      viewHeight: 200,
      wordTop: 180,
      wordHeight: 40,
      lineHeight: 50,
    })).toBe(130);
  });

  it('puts the phrase on the top row at three rows and at fewer', () => {
    const shared = {
      scrollTop: 0,
      wordTop: 180,
      wordHeight: 40,
      lineHeight: 50,
    };
    expect(scrollTopForRecitalLine({ ...shared, viewHeight: 150 })).toBe(168);
    expect(scrollTopForRecitalLine({ ...shared, viewHeight: 100 })).toBe(168);
  });

  it('leaves the opening line at the top', () => {
    expect(scrollTopForRecitalLine({
      scrollTop: 40,
      viewHeight: 400,
      wordTop: 8,
      wordHeight: 40,
      lineHeight: 50,
    })).toBe(0);
  });

  it('moves a line that sits too low up to the second row', () => {
    expect(scrollTopForRecitalLine({
      scrollTop: 0,
      viewHeight: 400,
      wordTop: 500,
      wordHeight: 40,
      lineHeight: 50,
    })).toBe(450);
  });

  it('scrolls back up when the phrase is already above the slot', () => {
    expect(scrollTopForRecitalLine({
      scrollTop: 400,
      viewHeight: 400,
      wordTop: 120,
      wordHeight: 40,
      lineHeight: 50,
    })).toBe(70);
  });

  it('uses the plain reveal when the row pitch is unknown', () => {
    expect(scrollTopForRecitalLine({
      scrollTop: 0,
      viewHeight: 200,
      wordTop: 150,
      wordHeight: 40,
      lineHeight: 0,
    })).toBe(scrollTopToReveal(0, 200, 150, 40, 12));
  });

  it('pads the end just enough for the last row to reach its slot', () => {
    expect(recitalTailSpace({
      viewHeight: 200,
      lineHeight: 50,
      lastTop: 400,
      lastBottom: 440,
    })).toBe(110);
    expect(recitalTailSpace({
      viewHeight: 150,
      lineHeight: 50,
      lastTop: 400,
      lastBottom: 440,
    })).toBe(98);
    expect(recitalTailSpace({
      viewHeight: 400,
      lineHeight: 50,
      lastTop: 8,
      lastBottom: 48,
    })).toBe(0);
    expect(recitalTailSpace({ viewHeight: 200, lineHeight: 0, lastTop: 40, lastBottom: 80 })).toBe(0);
  });
});

describe('reading scroll motion', () => {
  it('gives a one-line move a short ease and caps a long jump', () => {
    expect(scrollEaseMs(0)).toBe(0);
    expect(scrollEaseMs(Number.NaN)).toBe(0);
    expect(scrollEaseMs(-50)).toBe(scrollEaseMs(50));
    expect(scrollEaseMs(50)).toBe(250);
    expect(scrollEaseMs(10)).toBe(180);
    expect(scrollEaseMs(800)).toBe(420);
  });

  it('starts immediately and settles on the target', () => {
    const duration = scrollEaseMs(50);
    expect(easedScrollTop(10, 60, -10, duration)).toBe(10);
    expect(easedScrollTop(10, 60, 0, duration)).toBe(10);
    expect(easedScrollTop(10, 60, duration / 2, duration)).toBe(47.5);
    expect(easedScrollTop(10, 60, duration + 20, duration)).toBe(60);
    expect(easedScrollTop(100, 40, duration / 2, duration)).toBe(55);
    expect(easedScrollTop(10, 60, 0, 0)).toBe(60);
  });

  it('jumps when motion is reduced and leaves a settled line alone', () => {
    const gliding = { from: 0, to: 44, start: 0, duration: 250, expected: 10 };
    expect(beginScroll({
      current: 10,
      target: 44,
      now: 20,
      motion: gliding,
      smooth: false,
    })).toEqual({ motion: null, scrollTop: 44 });
    expect(beginScroll({ current: 44, target: 44.4, now: 20, smooth: true })).toEqual({
      motion: null,
      scrollTop: null,
    });
  });

  it('keeps a glide that is already heading for this line', () => {
    const gliding = { from: 0, to: 44, start: 10, duration: 250, expected: 12 };
    const step = beginScroll({ current: 12, target: 44.4, now: 40, motion: gliding, smooth: true });
    expect(step.motion).toBe(gliding);
    expect(step.scrollTop).toBeNull();
  });

  it('retargets a glide from the position it has reached', () => {
    const gliding = { from: 0, to: 44, start: 0, duration: 250, expected: 20 };
    const step = beginScroll({ current: 20, target: 90, now: 80, motion: gliding, smooth: true });
    expect(step.scrollTop).toBeNull();
    expect(step.motion).toEqual({
      from: 20,
      to: 90,
      start: 80,
      duration: scrollEaseMs(70),
      expected: 20,
    });
  });

  it('eases one frame at a time and then clears the glide', () => {
    const started = beginScroll({ current: 0, target: 50, now: 100, smooth: true });
    const mid = advanceScroll(started.motion, 100 + started.motion.duration / 2, true);
    expect(mid.scrollTop).toBe(easedScrollTop(0, 50, started.motion.duration / 2, started.motion.duration));
    expect(mid.motion.expected).toBe(mid.scrollTop);
    expect(started.motion.expected).toBe(0);

    const done = advanceScroll(started.motion, 100 + started.motion.duration, true);
    expect(done).toEqual({ motion: null, scrollTop: 50 });
    expect(advanceScroll(null, 0, true)).toEqual({ motion: null, scrollTop: null });
  });

  it('snaps the rest of a glide when motion is reduced', () => {
    const started = beginScroll({ current: 0, target: 50, now: 0, smooth: true });
    expect(advanceScroll(started.motion, 40, false)).toEqual({ motion: null, scrollTop: 50 });
  });

  it('treats a scroll away from the glide as the reader taking over', () => {
    const motion = { expected: 10, applying: false };
    expect(scrollWasTaken(null, 40)).toBe(false);
    expect(scrollWasTaken({ expected: null }, 40)).toBe(false);
    expect(scrollWasTaken({ ...motion, applying: true }, 40)).toBe(false);
    expect(scrollWasTaken(motion, 10 + SCROLL_TAKEOVER)).toBe(false);
    expect(scrollWasTaken(motion, 10 + SCROLL_TAKEOVER + 0.5)).toBe(true);
  });
});
