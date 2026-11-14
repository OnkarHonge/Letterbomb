import { beforeEach, describe, expect, it } from 'vitest';
import { loadSave, writeSave } from '../src/storage.js';

function memoryStorage() {
  const map = new Map();
  return {
    getItem(key) {
      return map.has(key) ? map.get(key) : null;
    },
    setItem(key, value) {
      map.set(key, String(value));
    },
  };
}

describe('storage', () => {
  beforeEach(() => {
    globalThis.localStorage = memoryStorage();
  });

  it('round-trips config, best, and article', () => {
    const article = { id: 'custom', label: 'Notes', text: 'Read this closely.' };
    const result = writeSave({
      config: { wpm: 180 },
      best: { score: 400, streak: 4 },
      article,
    });
    expect(result).toEqual({ ok: true, skippedArticle: false });
    expect(loadSave()).toMatchObject({
      version: 1,
      config: { wpm: 180 },
      best: { score: 400, streak: 4 },
      article,
      place: null,
    });
  });

  it('stores a word to continue, and drops a place with no article', () => {
    writeSave({
      config: { wpm: 150 },
      best: { score: 0, streak: 0 },
      article: { id: 'custom', label: 'Notes', text: 'Read this closely.' },
      place: { articleKey: 'abc', index: 4 },
    });
    expect(loadSave().place).toEqual({ articleKey: 'abc', index: 4 });
    writeSave({
      config: { wpm: 150 },
      best: { score: 0, streak: 0 },
      article: { id: 'custom', label: 'Notes', text: 'Read this closely.' },
      place: { index: 4 },
    });
    expect(loadSave().place).toBeNull();
  });

  it('keeps the previous article when the new one is too large to store', () => {
    writeSave({
      config: { wpm: 150 },
      best: { score: 0, streak: 0 },
      article: { id: 'adhd', label: 'Short', text: 'Hello there.' },
    });
    const result = writeSave({
      config: { wpm: 160 },
      best: { score: 10, streak: 1 },
      article: { id: 'custom', label: 'Huge', text: 'a'.repeat(400_001) },
    });
    expect(result.skippedArticle).toBe(true);
    expect(loadSave().article.text).toBe('Hello there.');
    expect(loadSave().config.wpm).toBe(160);
  });

  it('returns null for broken saved data', () => {
    localStorage.setItem('reflexread.v1', '{');
    expect(loadSave()).toBeNull();
  });
});
