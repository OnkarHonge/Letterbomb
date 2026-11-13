import { describe, expect, it } from 'vitest';
import {
  deleteSharedHighlight,
  loadHighlightCache,
  loadHighlights,
  publishHighlight,
  pullShelf,
  rememberHighlight,
  writeHighlightCache,
  writePhrase,
} from '../src/sync.js';
import { handleRequest } from '../worker/index.js';

const PHRASE = 'correct horse';

function memoryStorage() {
  const map = new Map();
  return {
    getItem(key) {
      return map.has(key) ? map.get(key) : null;
    },
    setItem(key, value) {
      map.set(key, String(value));
    },
    removeItem(key) {
      map.delete(key);
    },
    keys() {
      return [...map.keys()];
    },
  };
}

function memoryKv() {
  const map = new Map();
  return {
    async get(key) {
      return map.has(key) ? map.get(key) : null;
    },
    async put(key, value) {
      map.set(key, String(value));
    },
  };
}

function shelfFor(env) {
  return {
    fetchImpl: (url, options) => handleRequest(new Request(url, options), env),
    url: 'https://shelf.test/shelf',
    phrase: PHRASE,
  };
}

function line(over = {}) {
  return {
    id: 'line-1',
    articleKey: 'article-a',
    articleLabel: 'Notes',
    source: 'Golf Hotel.',
    note: 'Golf and Hotel.',
    start: 2,
    end: 4,
    updatedAt: 12,
    createdAt: 12,
    ...over,
  };
}

describe('kept-line sync', () => {
  it('shares a line on the phrase and drops it from the shelf', async () => {
    const storage = memoryStorage();
    globalThis.localStorage = storage;
    const shelf = shelfFor({ SHELF: memoryKv() });
    writePhrase(PHRASE);
    rememberHighlight(line());

    const saved = await publishHighlight(line(), shelf);
    expect(saved.ok).toBe(true);
    expect(saved.highlight.note).toBe('Golf and Hotel.');

    const pulled = await pullShelf(shelf);
    expect(pulled.highlights.map((item) => item.id)).toEqual(['line-1']);

    const removed = await deleteSharedHighlight('line-1', shelf);
    expect(removed.ok).toBe(true);
    expect(loadHighlights()).toEqual([]);
    expect((await pullShelf(shelf)).highlights).toEqual([]);

    const older = await publishHighlight(line({ updatedAt: 13 }), shelf);
    expect(older.blocked).toBe(true);
    expect((await pullShelf(shelf)).highlights).toEqual([]);
    expect(storage.keys().every((key) => key.startsWith('reflexread.beta3.'))).toBe(true);
  });

  it('hides the cached lines when the phrase changes', () => {
    globalThis.localStorage = memoryStorage();
    writePhrase(PHRASE);
    writeHighlightCache([line()]);
    expect(loadHighlightCache().map((item) => item.id)).toEqual(['line-1']);
    writePhrase('another horse');
    expect(loadHighlightCache()).toEqual([]);
    writePhrase(PHRASE);
    expect(loadHighlightCache().map((item) => item.id)).toEqual(['line-1']);
  });

  it('rejects a short phrase before it calls the shelf', async () => {
    globalThis.localStorage = memoryStorage();
    expect(writePhrase('short')).toBe('');
    const saved = await publishHighlight(line(), { phrase: 'short', url: 'https://shelf.test/shelf' });
    expect(saved.ok).toBe(false);
    expect(saved.reason).toBe('missing');
  });
});
