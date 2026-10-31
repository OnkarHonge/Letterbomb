import { describe, expect, it } from 'vitest';
import { encodePhrase } from '../src/shelf.js';
import { handleRequest } from '../worker/index.js';

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

function request(method, phrase, body) {
  const headers = { Accept: 'application/json' };
  if (phrase) headers['X-Reflex-Phrase'] = encodePhrase(phrase);
  if (body) headers['Content-Type'] = 'application/json';
  return new Request('https://shelf.test/shelf', {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
}

describe('cloudflare shelf', () => {
  it('keeps each phrase on its own list', async () => {
    const env = { SHELF: memoryKv() };
    const first = await handleRequest(request('PUT', 'correct horse', {
      article: { id: 'custom', label: 'Notes', text: 'Read this closely.', updatedAt: 10 },
    }), env);
    expect(first.status).toBe(200);
    expect(first.headers.get('Access-Control-Allow-Origin')).toBe('*');

    const second = await handleRequest(request('PUT', 'another horse', {
      article: { id: 'custom', label: 'Phone', text: 'Loaded on the phone.', updatedAt: 12 },
    }), env);
    expect(second.status).toBe(200);

    const own = await handleRequest(request('GET', 'correct horse'), env);
    const other = await handleRequest(request('GET', 'another horse'), env);
    expect((await own.json()).articles.map((item) => item.text)).toEqual(['Read this closely.']);
    expect((await other.json()).articles.map((item) => item.text)).toEqual(['Loaded on the phone.']);
  });

  it('merges a second article onto the same phrase', async () => {
    const env = { SHELF: memoryKv() };
    await handleRequest(request('PUT', 'correct horse', {
      article: { id: 'custom', label: 'Notes', text: 'Read this closely.', updatedAt: 10 },
    }), env);
    const saved = await handleRequest(request('PUT', 'correct horse', {
      article: { id: 'custom', label: 'Phone', text: 'Loaded on the phone.', updatedAt: 12 },
    }), env);
    expect((await saved.json()).articles.map((item) => item.text)).toEqual([
      'Loaded on the phone.',
      'Read this closely.',
    ]);
  });

  it('rejects a missing or short phrase and answers the browser preflight', async () => {
    const env = { SHELF: memoryKv() };
    expect((await handleRequest(request('GET'), env)).status).toBe(401);
    expect((await handleRequest(request('PUT', 'short', {
      article: { id: 'custom', label: 'Notes', text: 'Read this closely.', updatedAt: 10 },
    }), env)).status).toBe(401);
    const preflight = await handleRequest(new Request('https://shelf.test/shelf', { method: 'OPTIONS' }), env);
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('Access-Control-Allow-Headers')).toContain('X-Reflex-Phrase');
    expect(preflight.headers.get('Access-Control-Allow-Methods')).toContain('DELETE');
  });

  it('removes an article and keeps a key, not the text', async () => {
    const env = { SHELF: memoryKv() };
    await handleRequest(request('PUT', 'correct horse', {
      article: { id: 'custom', label: 'Notes', text: 'Read this closely.', updatedAt: 10 },
    }), env);
    await handleRequest(request('PUT', 'correct horse', {
      article: { id: 'custom', label: 'Phone', text: 'Loaded on the phone.', updatedAt: 12 },
    }), env);
    await handleRequest(request('PUT', 'another horse', {
      article: { id: 'custom', label: 'Phone', text: 'Read this closely.', updatedAt: 9 },
    }), env);

    const removed = await handleRequest(request('DELETE', 'correct horse', { text: 'Read this closely.' }), env);
    const body = await removed.json();
    expect(removed.status).toBe(200);
    expect(body.articles.map((item) => item.text)).toEqual(['Loaded on the phone.']);
    expect(JSON.stringify(body)).not.toContain('Read this closely.');
    expect(body.tombstones).toHaveLength(1);
    expect(body.tombstones[0].key).toBeTruthy();
    expect(body.tombstones[0].deletedAt).toBeGreaterThan(12);

    const older = await handleRequest(request('PUT', 'correct horse', {
      article: { id: 'custom', label: 'Notes', text: 'Read this closely.', updatedAt: 11 },
    }), env);
    expect((await older.json()).articles.map((item) => item.text)).toEqual(['Loaded on the phone.']);

    const newer = await handleRequest(request('PUT', 'correct horse', {
      article: { id: 'custom', label: 'Notes', text: 'Read this closely.', updatedAt: Date.now() + 10_000 },
    }), env);
    const restored = await newer.json();
    expect(restored.articles.map((item) => item.text)).toEqual(['Read this closely.', 'Loaded on the phone.']);
    expect(restored.tombstones).toEqual([]);

    const other = await handleRequest(request('GET', 'another horse'), env);
    expect((await other.json()).articles.map((item) => item.text)).toEqual(['Read this closely.']);
  });

  it('round-trips a phrase with an accent', async () => {
    const env = { SHELF: memoryKv() };
    await handleRequest(request('PUT', 'café phrase', {
      article: { id: 'custom', label: 'Notes', text: 'Read this closely.', updatedAt: 4 },
    }), env);
    const saved = await handleRequest(request('GET', 'café phrase'), env);
    expect((await saved.json()).articles[0].text).toBe('Read this closely.');
  });
});
