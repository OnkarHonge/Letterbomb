import { describe, expect, it } from 'vitest';
import { createDrill, drillMissNote } from '../src/engine/drill.js';

describe('corner drill', () => {
  it('shows a letter and moves on only after the right corner', () => {
    const drill = createDrill({ random: () => 0 });
    drill.start();
    expect(drill.snapshot()).toMatchObject({ on: true, letter: 'A', hits: 0, streak: 0 });
    expect(drill.answer('se')).toMatchObject({
      hit: false,
      letter: 'A',
      note: 'A belongs in A–G.',
      mark: 'miss',
      misses: 1,
      streak: 0,
    });
    expect(drill.answer('nw')).toMatchObject({ hit: true, letter: 'B', note: '', streak: 1, hits: 1 });
    expect(drill.snapshot().letter).toBe('B');
  });

  it('does not repeat the letter it just cleared', () => {
    const drill = createDrill({ random: () => 0 });
    drill.start();
    drill.answer('nw');
    expect(drill.snapshot().letter).toBe('B');
    expect(drillMissNote('Q')).toBe('Q belongs in N–S.');
  });

  it('ignores a tap that is not a corner', () => {
    const drill = createDrill({ random: () => 0 });
    drill.start();
    expect(drill.answer(null)).toBeNull();
    expect(drill.answer('middle')).toBeNull();
    expect(drill.snapshot()).toMatchObject({ letter: 'A', misses: 0, streak: 0 });
  });

  it('keeps the new letter up when the next corner is wrong', () => {
    const drill = createDrill({ random: () => 0 });
    drill.start();
    drill.answer('nw');
    expect(drill.answer('se')).toMatchObject({
      hit: false,
      letter: 'B',
      note: 'B belongs in A–G.',
      hits: 1,
      streak: 0,
    });
  });

  it('ignores a tap once the drill has stopped', () => {
    const drill = createDrill({ random: () => 0 });
    drill.start();
    drill.stop();
    expect(drill.answer('nw')).toBeNull();
    expect(drill.snapshot().on).toBe(false);
  });
});
