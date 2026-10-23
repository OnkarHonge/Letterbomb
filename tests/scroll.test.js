import { describe, expect, it } from 'vitest';
import {
  MIN_PREVIEW_LINES,
  PREVIEW_INSET,
  nextLineUnder,
  scrollTopForReadingLine,
  scrollTopToReveal,
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
