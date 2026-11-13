import { describe, expect, it } from 'vitest';
import { parseText } from '../src/engine/parseText.js';
import {
  HIGHLIGHT_CAP,
  admitHighlight,
  blockedHighlight,
  contextBefore,
  createHighlightId,
  extendNote,
  findSpan,
  highlightsMarkdown,
  planHighlights,
  sentenceBounds,
  spanText,
} from '../src/highlights.js';

function line(over = {}) {
  return {
    id: 'line-1',
    articleKey: 'article-a',
    articleLabel: 'Notes',
    source: 'Golf Hotel.',
    note: 'Golf Hotel.',
    start: 2,
    end: 4,
    updatedAt: 10,
    createdAt: 10,
    ...over,
  };
}

describe('kept lines', () => {
  const words = parseText('Alpha, Beta. Golf Hotel.');

  it('keeps a comma inside the sentence and splits on a blank line', () => {
    expect(sentenceBounds(words, 2)).toEqual({ start: 2, end: 4 });
    expect(spanText(words, 0, 2)).toBe('Alpha, Beta.');
    expect(contextBefore(words, 2)).toBe('Alpha, Beta.');
    const broken = parseText('Alpha Beta\n\nGolf Hotel.');
    expect(sentenceBounds(broken, 2)).toEqual({ start: 2, end: 4 });
    expect(contextBefore(broken, 2)).toBe('Alpha Beta');
  });

  it('adds the sentence before once, then stops', () => {
    const once = extendNote('Hotel.', words, 3);
    expect(once).toBe('Golf Hotel.');
    const twice = extendNote(once, words, 3);
    expect(twice).toBe('Alpha, Beta. Golf Hotel.');
    expect(extendNote(twice, words, 3)).toBe(twice);
  });

  it('reuses the id for the same span and refuses a full bucket', () => {
    const first = admitHighlight([], line());
    const again = admitHighlight(first.highlights, line({
      id: 'line-2',
      note: 'Golf and Hotel.',
      updatedAt: 12,
    }));
    expect(again.ok).toBe(true);
    expect(again.highlight.id).toBe('line-1');
    expect(again.highlights).toHaveLength(1);
    expect(findSpan(again.highlights, 'article-a', 2, 4).note).toBe('Golf and Hotel.');

    const many = Array.from({ length: HIGHLIGHT_CAP }, (_, index) => line({
      id: `line-${index}`,
      source: `Word ${index}.`,
      note: `Word ${index}.`,
      start: index,
      end: index + 1,
      updatedAt: index + 1,
    }));
    const full = admitHighlight(many, line({
      id: 'overflow',
      articleKey: 'article-b',
      source: 'Extra line.',
      note: 'Extra line.',
      start: 0,
      end: 1,
      updatedAt: 999,
    }));
    expect(full.ok).toBe(false);
    expect(full.reason).toBe('full');
    expect(full.highlights).toHaveLength(HIGHLIGHT_CAP);
    expect(planHighlights(full.highlights).some((item) => item.id === 'overflow')).toBe(false);
  });

  it('lets a newer edit pass a removal, and hides the id in the export', () => {
    const item = line();
    expect(blockedHighlight(item, [{ id: item.id, deletedAt: 11 }])).toBe(true);
    expect(blockedHighlight({ ...item, updatedAt: 12 }, [{ id: item.id, deletedAt: 11 }])).toBe(false);
    const left = createHighlightId();
    const right = createHighlightId();
    expect(left).not.toBe(right);
    const markdown = highlightsMarkdown([
      item,
      line({
        id: 'line-9',
        articleKey: 'article-b',
        articleLabel: 'Phone',
        source: 'Read this.',
        note: 'Read this closely.',
        start: 0,
        end: 2,
        updatedAt: 20,
      }),
    ]);
    expect(markdown.startsWith('# Phone')).toBe(true);
    expect(markdown).toContain('Read this closely.');
    expect(markdown).toContain('Source: Read this.');
    expect(markdown).toContain('# Notes');
    expect(markdown).not.toContain('line-1');
    expect(markdown).not.toContain(left);
  });
});
