import { describe, expect, it } from 'vitest';
import { scrollTopToReveal } from '../src/ui/scroll.js';

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
