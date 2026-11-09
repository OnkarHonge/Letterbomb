import { beforeEach, describe, expect, it } from 'vitest';
import { planShelf } from '../src/shelf.js';
import { handleRequest } from '../worker/index.js';
import {
  articleKey,
  articleToOpen,
  deleteSharedArticle,
  deleteSharedHighlight,
  loadHighlights,
  loadHistory,
  loadPhrase,
  loadShelfCache,
  loadTombstones,
  publishArticle,
  publishHighlight,
  pullShelf,
  rememberHighlight,
  rememberHistory,
  writePhrase,
  writeShelfCache,
} from '../src/sync.js';

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
  };
}

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      if (body === undefined) throw new Error('empty');
      return structuredClone(body);
    },
  };
}

function createShelf() {
  const shelves = new Map();
  const calls = [];
  const fetchImpl = async (_url, options = {}) => {
    const method = options.method || 'GET';
    calls.push(method);
    const phrase = options.headers?.['X-Reflex-Phrase'];
    if (!phrase) return jsonResponse(401, { error: 'phrase' });
    const articles = shelves.get(phrase) || [];
    if (method === 'GET') return jsonResponse(200, { version: 1, articles });
    if (method === 'PUT') {
      const body = JSON.parse(options.body);
      const merged = planShelf([...articles, body.article]).articles.map(
        ({ id, label, text, updatedAt }) => ({ id, label, text, updatedAt }),
      );
      shelves.set(phrase, merged);
      return jsonResponse(200, { version: 1, articles: merged });
    }
    return jsonResponse(404, {});
  };
  return { calls, fetchImpl };
}

const shelfOptions = (fetchImpl) => ({
  fetchImpl,
  url: 'https://shelf.test/shelf',
  phrase: PHRASE,
});

describe('article shelf', () => {
  beforeEach(() => {
    globalThis.localStorage = memoryStorage();
  });

  it('builds a stable key from the text', () => {
    expect(articleKey('Same words.')).toBe(articleKey('Same words.'));
    expect(articleKey('Same words.')).not.toBe(articleKey('Other words.'));
  });

  it('keeps a phrase of at least 8 characters and forgets a short one', () => {
    expect(writePhrase('  correct   horse  ')).toBe('correct horse');
    expect(loadPhrase()).toBe('correct horse');
    expect(writePhrase('short')).toBe('');
    expect(loadPhrase()).toBe('correct horse');
  });

  it('opens a newer shelf article only while this device is still idle', () => {
    const local = { text: 'Local page.', savedAt: 10 };
    const shelf = [{ text: 'Phone page.', updatedAt: 20, label: 'Custom' }];
    expect(articleToOpen({ local, shelf, articlePicked: false, idle: true, modalOpen: false }).text)
      .toBe('Phone page.');
    expect(articleToOpen({
      local: { text: 'Local page.', savedAt: 30 },
      shelf,
      articlePicked: false,
      idle: true,
      modalOpen: false,
    })).toBeNull();
    expect(articleToOpen({ local, shelf, articlePicked: true, idle: true, modalOpen: false })).toBeNull();
    expect(articleToOpen({ local, shelf, articlePicked: false, idle: false, modalOpen: false })).toBeNull();
    expect(articleToOpen({ local, shelf, articlePicked: false, idle: true, modalOpen: true })).toBeNull();
    expect(articleToOpen({
      local: { text: 'Phone page.', savedAt: 5 },
      shelf,
      articlePicked: false,
      idle: true,
      modalOpen: false,
    })).toBeNull();
  });

  it('keeps one copy of each article and drops the oldest past the cap', () => {
    const records = [
      { _id: 'old', text: 'First.', label: 'A', updatedAt: 1 },
      { _id: 'dup', text: 'First.', label: 'A', updatedAt: 2 },
      { _id: 'new', text: 'Second.', label: 'B', updatedAt: 3 },
    ];
    const plan = planShelf(records);
    expect(plan.articles.map((item) => item.text)).toEqual(['Second.', 'First.']);
    expect(plan.articles[1]._id).toBe('dup');
    expect(plan.removeIds).toEqual(['old']);

    const many = Array.from({ length: 26 }, (_, index) => ({
      _id: `n-${index}`,
      text: `Article ${index}.`,
      label: 'Custom',
      updatedAt: index + 1,
    }));
    const capped = planShelf(many);
    expect(capped.articles).toHaveLength(24);
    expect(capped.articles[0].text).toBe('Article 25.');
    expect(capped.removeIds).toEqual(['n-0', 'n-1']);
  });

  it('keeps every loaded article in history', () => {
    rememberHistory({ id: 'custom', label: 'Notes', text: 'First article.', savedAt: 10 });
    const second = rememberHistory({
      id: 'custom',
      label: 'Phone',
      text: 'Second article.',
      savedAt: 12,
    });
    expect(second.map((item) => item.text)).toEqual(['Second article.', 'First article.']);
    expect(loadHistory().map((item) => item.text)).toEqual(['Second article.', 'First article.']);

    const again = rememberHistory({
      id: 'custom',
      label: 'Notes',
      text: 'First article.',
      savedAt: 20,
    });
    expect(again.map((item) => item.text)).toEqual(['First article.', 'Second article.']);
    expect(again).toHaveLength(2);
  });

  it('keeps the shelf cache for this phrase only', () => {
    writePhrase(PHRASE);
    writeShelfCache([
      { id: 'custom', label: 'Notes', text: 'Read this closely.', updatedAt: 4 },
    ]);
    expect(loadShelfCache()).toEqual([
      {
        _id: '',
        key: articleKey('Read this closely.'),
        id: 'custom',
        label: 'Notes',
        text: 'Read this closely.',
        updatedAt: 4,
      },
    ]);
    expect(localStorage.getItem('reflexread.v1')).toBeNull();
    writePhrase('another horse');
    expect(loadShelfCache()).toEqual([]);
  });

  it('publishes a new article and leaves an older remote copy in place', async () => {
    const shelf = createShelf();
    const options = shelfOptions(shelf.fetchImpl);
    const first = await publishArticle(
      { id: 'custom', label: 'Notes', text: 'Read this closely.', savedAt: 10 },
      options,
    );
    expect(first.ok).toBe(true);
    expect(first.articles.map((item) => item.text)).toEqual(['Read this closely.']);

    const second = await publishArticle(
      { id: 'custom', label: 'Phone', text: 'Loaded on the phone.', savedAt: 12 },
      options,
    );
    expect(second.articles.map((item) => item.text)).toEqual([
      'Loaded on the phone.',
      'Read this closely.',
    ]);

    const pulled = await pullShelf(options);
    expect(pulled.ok).toBe(true);
    expect(pulled.articles).toHaveLength(2);
    expect(shelf.calls.filter((call) => call === 'PUT')).toHaveLength(2);
  });

  it('does not call the shelf without a phrase', async () => {
    let called = false;
    const result = await publishArticle(
      { id: 'custom', label: 'Notes', text: 'Read this closely.', savedAt: 10 },
      {
        fetchImpl: async () => {
          called = true;
          return jsonResponse(200, { articles: [] });
        },
      },
    );
    expect(result).toMatchObject({ ok: false, reason: 'missing' });
    expect(called).toBe(false);
  });

  it('does not write when the shelf cannot be read', async () => {
    const calls = [];
    const fetchImpl = async (_url, options = {}) => {
      calls.push(options.method || 'GET');
      return jsonResponse(500, { articles: [] });
    };
    const result = await publishArticle(
      { id: 'custom', label: 'Notes', text: 'Read this closely.', savedAt: 10 },
      shelfOptions(fetchImpl),
    );
    expect(result.ok).toBe(false);
    expect(calls.filter((call) => call === 'PUT')).toHaveLength(0);
    expect(calls.filter((call) => call === 'GET').length).toBeGreaterThan(1);
  });

  it('retries a shelf read that fails once', async () => {
    const shelf = createShelf();
    let gets = 0;
    const flaky = async (url, options = {}) => {
      if ((options.method || 'GET') === 'GET') {
        gets += 1;
        if (gets === 1) throw new Error('offline');
      }
      return shelf.fetchImpl(url, options);
    };
    const result = await publishArticle(
      { id: 'custom', label: 'Notes', text: 'Read this closely.', savedAt: 10 },
      shelfOptions(flaky),
    );
    expect(result.ok).toBe(true);
    expect(result.articles.map((item) => item.text)).toEqual(['Read this closely.']);
  });

  it('does not publish an article that is too long to store', async () => {
    let called = false;
    const result = await publishArticle(
      { id: 'custom', label: 'Huge', text: 'a'.repeat(400_001), savedAt: 10 },
      {
        phrase: PHRASE,
        fetchImpl: async () => {
          called = true;
          return jsonResponse(200, { articles: [] });
        },
      },
    );
    expect(result).toMatchObject({ ok: false, reason: 'size' });
    expect(called).toBe(false);
  });

  it('removes an article on this device even when the shelf cannot be reached', async () => {
    writePhrase(PHRASE);
    rememberHistory({ id: 'custom', label: 'Notes', text: 'Keep this.', savedAt: 4 });
    rememberHistory({ id: 'custom', label: 'Notes', text: 'Drop this.', savedAt: 8 });
    writeShelfCache([
      { id: 'custom', label: 'Notes', text: 'Drop this.', updatedAt: 8 },
      { id: 'custom', label: 'Notes', text: 'Keep this.', updatedAt: 4 },
    ]);
    let called = false;
    const result = await deleteSharedArticle(
      { text: 'Drop this.' },
      {
        phrase: PHRASE,
        url: 'https://shelf.test/shelf',
        fetchImpl: async () => {
          called = true;
          throw new Error('offline');
        },
      },
    );
    expect(called).toBe(true);
    expect(result.ok).toBe(false);
    expect(loadHistory().map((item) => item.text)).toEqual(['Keep this.']);
    expect(loadShelfCache().map((item) => item.text)).toEqual(['Keep this.']);
    expect(rememberHistory({
      id: 'custom',
      label: 'Notes',
      text: 'Drop this.',
      savedAt: 8,
    }).map((item) => item.text)).toEqual(['Keep this.']);
    expect(JSON.stringify(loadTombstones())).not.toContain('Drop this.');
  });

  it('leaves a newer copy alone when an older removal is still in flight', async () => {
    rememberHistory({ id: 'custom', label: 'Notes', text: 'Drop this.', savedAt: 30 });
    let called = false;
    const result = await deleteSharedArticle(
      { text: 'Drop this.' },
      {
        deletedAt: 20,
        phrase: PHRASE,
        url: 'https://shelf.test/shelf',
        fetchImpl: async () => {
          called = true;
          return jsonResponse(200, { articles: [], tombstones: [] });
        },
      },
    );
    expect(result.skipped).toBe(true);
    expect(called).toBe(false);
    expect(loadHistory().map((item) => item.text)).toEqual(['Drop this.']);
  });

  it('does not call the shelf when removing without a phrase', async () => {
    rememberHistory({ id: 'custom', label: 'Notes', text: 'Drop this.', savedAt: 8 });
    let called = false;
    const result = await deleteSharedArticle(
      { text: 'Drop this.' },
      {
        phrase: '',
        url: 'https://shelf.test/shelf',
        fetchImpl: async () => {
          called = true;
          return jsonResponse(200, { articles: [], tombstones: [] });
        },
      },
    );
    expect(result).toMatchObject({ ok: true, reason: 'missing' });
    expect(called).toBe(false);
    expect(loadHistory()).toEqual([]);
  });

  it('drops the article from the shared shelf and refuses the old copy', async () => {
    writePhrase(PHRASE);
    const map = new Map();
    const env = {
      SHELF: {
        async get(key) {
          return map.has(key) ? map.get(key) : null;
        },
        async put(key, value) {
          map.set(key, String(value));
        },
      },
    };
    const fetchImpl = (url, options) => handleRequest(new Request(url, options), env);
    const options = shelfOptions(fetchImpl);
    const article = { id: 'custom', label: 'Notes' };
    await publishArticle({ ...article, text: 'Keep this.', savedAt: 4 }, options);
    await publishArticle({ ...article, text: 'Drop this.', savedAt: 8 }, options);

    const removed = await deleteSharedArticle({ text: 'Drop this.' }, options);
    expect(removed.ok).toBe(true);
    expect(removed.articles.map((item) => item.text)).toEqual(['Keep this.']);
    expect(JSON.stringify([...map.values()])).not.toContain('Drop this.');

    const blocked = await publishArticle({ ...article, text: 'Drop this.', savedAt: 9 }, options);
    expect(blocked.blocked).toBe(true);
    expect(blocked.articles.map((item) => item.text)).toEqual(['Keep this.']);

    const restored = await publishArticle(
      { ...article, text: 'Drop this.', savedAt: Date.now() + 10_000 },
      options,
    );
    expect(restored.blocked).toBeUndefined();
    expect(restored.articles.map((item) => item.text)).toEqual(['Drop this.', 'Keep this.']);
  });

  it('shares a kept line on the article shelf and drops it from every device', async () => {
    const env = {
      SHELF: {
        async get(key) {
          return map.has(key) ? map.get(key) : null;
        },
        async put(key, value) {
          map.set(key, String(value));
        },
      },
    };
    const map = new Map();
    const fetchImpl = (url, options) => handleRequest(new Request(url, options), env);
    const options = shelfOptions(fetchImpl);
    writePhrase(PHRASE);
    const line = {
      id: 'line-1',
      articleKey: 'article-a',
      articleLabel: 'Notes',
      source: 'Golf Hotel.',
      note: 'Golf and Hotel.',
      start: 2,
      end: 4,
      updatedAt: 12,
      createdAt: 12,
    };
    expect(rememberHighlight(line).map((item) => item.note)).toEqual(['Golf and Hotel.']);
    const published = await publishHighlight(line, options);
    expect(published.ok).toBe(true);
    expect(published.highlights).toHaveLength(1);
    const pulled = await pullShelf(options);
    expect(pulled.highlights[0].note).toBe('Golf and Hotel.');
    expect(pulled.articles).toEqual([]);

    const removed = await deleteSharedHighlight(line.id, options);
    expect(removed.ok).toBe(true);
    expect(loadHighlights()).toEqual([]);
    const again = await publishHighlight({ ...line, updatedAt: 13 }, options);
    expect(again.blocked).toBe(true);
    expect((await pullShelf(options)).highlights).toEqual([]);
  });
});
