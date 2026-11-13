// Kept lines for this browser, and the same phrase on the shared shelf.
// This client never publishes an article.
import {
  admitHighlight,
  asHighlight,
  blockedHighlight,
  planHighlightTombstones,
  planHighlights,
} from './highlights.js';
import { articleKey, encodePhrase, normalizePhrase } from './shelf.js';

export { articleKey };

const PUBLISHED_SHELF = 'https://letterbomb-shelf.onkarhonge.workers.dev/shelf';

export function shelfUrl() {
  if (import.meta.env?.VITE_SHELF_URL) return import.meta.env.VITE_SHELF_URL;
  if (import.meta.env?.DEV) return 'http://127.0.0.1:8787/shelf';
  return PUBLISHED_SHELF;
}

const PHRASE_KEY = 'reflexread.beta3.phrase.v1';
const CACHE_KEY = 'reflexread.beta3.shelf.v1';
const HIGHLIGHT_KEY = 'reflexread.beta3.highlights.v1';
const HIGHLIGHT_TOMBSTONE_KEY = 'reflexread.beta3.highlight-tombstones.v1';

export function loadPhrase() {
  try {
    return normalizePhrase(localStorage.getItem(PHRASE_KEY));
  } catch {
    return '';
  }
}

export function writePhrase(value) {
  const phrase = normalizePhrase(value);
  if (!phrase) return '';
  try {
    localStorage.setItem(PHRASE_KEY, phrase);
  } catch {
    return '';
  }
  return phrase;
}

export function clearPhrase() {
  try {
    localStorage.removeItem(PHRASE_KEY);
  } catch {
    // The lines already on this device stay here.
  }
}

function cacheMark(phrase) {
  return articleKey(normalizePhrase(phrase));
}

function readCache(phrase = loadPhrase()) {
  const mark = cacheMark(phrase);
  if (!mark) return null;
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (data?.mark !== mark) return null;
    return data;
  } catch {
    return null;
  }
}

function writeCache(phrase, highlights) {
  const mark = cacheMark(phrase);
  if (!mark) return false;
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({
      version: 1,
      mark,
      highlights: planHighlights(highlights),
    }));
    return true;
  } catch {
    return false;
  }
}

export function loadHighlights() {
  try {
    const raw = localStorage.getItem(HIGHLIGHT_KEY);
    if (!raw) return [];
    const data = JSON.parse(raw);
    return planHighlights(data?.highlights);
  } catch {
    return [];
  }
}

function writeHighlightList(highlights) {
  const slim = planHighlights(highlights);
  try {
    localStorage.setItem(HIGHLIGHT_KEY, JSON.stringify({ version: 1, highlights: slim }));
  } catch {
    // This session still has the list even if the browser refused the write.
  }
  return slim;
}

export function loadHighlightTombstones() {
  try {
    const raw = localStorage.getItem(HIGHLIGHT_TOMBSTONE_KEY);
    if (!raw) return [];
    const data = JSON.parse(raw);
    return planHighlightTombstones(data?.tombstones);
  } catch {
    return [];
  }
}

function writeHighlightTombstones(tombstones) {
  const slim = planHighlightTombstones(tombstones);
  try {
    localStorage.setItem(HIGHLIGHT_TOMBSTONE_KEY, JSON.stringify({ version: 1, tombstones: slim }));
  } catch {
    // This session still hides the removed lines.
  }
  return slim;
}

export function loadHighlightCache(phrase = loadPhrase()) {
  const data = readCache(phrase);
  if (!data) return [];
  return planHighlights(data.highlights);
}

export function writeHighlightCache(highlights, phrase = loadPhrase()) {
  return writeCache(phrase, highlights);
}

export function rememberHighlight(highlight) {
  const item = asHighlight(highlight);
  if (!item || blockedHighlight(item, loadHighlightTombstones())) return loadHighlights();
  const admitted = admitHighlight(loadHighlights(), item);
  if (!admitted.ok) return loadHighlights();
  return writeHighlightList(admitted.highlights);
}

export function forgetHighlightLocally(id, deletedAt = Date.now()) {
  const key = String(id || '');
  if (!key) return loadHighlights();
  writeHighlightTombstones([...loadHighlightTombstones(), { id: key, deletedAt }]);
  const highlights = writeHighlightList(loadHighlights().filter((item) => item.id !== key));
  const phrase = loadPhrase();
  if (phrase) {
    writeHighlightCache(
      loadHighlightCache(phrase).filter((item) => item.id !== key),
      phrase,
    );
  }
  return highlights;
}

export function applyHighlightTombstones(tombstones) {
  const merged = writeHighlightTombstones([
    ...loadHighlightTombstones(),
    ...planHighlightTombstones(tombstones),
  ]);
  writeHighlightList(loadHighlights().filter((item) => !blockedHighlight(item, merged)));
  const phrase = loadPhrase();
  if (phrase) {
    writeHighlightCache(
      loadHighlightCache(phrase).filter((item) => !blockedHighlight(item, merged)),
      phrase,
    );
  }
  return merged;
}

function shelfHeaders(phrase, extra = {}) {
  return {
    Accept: 'application/json',
    'X-Reflex-Phrase': encodePhrase(phrase),
    ...extra,
  };
}

async function readJson(response) {
  if (!response?.ok) return null;
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function send(fetchImpl, url, options) {
  let response = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      response = await fetchImpl(url, options);
      if (response.ok || response.status < 500) return response;
    } catch {
      response = null;
    }
    if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)));
  }
  return response;
}

function documentFrom(data) {
  if (!data || !Array.isArray(data.articles)) return null;
  return {
    highlights: planHighlights(data.highlights).filter(
      (item) => !blockedHighlight(item, data.highlightTombstones),
    ),
    highlightTombstones: planHighlightTombstones(data.highlightTombstones),
    refused: typeof data.refused === 'string' ? data.refused : '',
  };
}

export async function pullShelf(options = {}) {
  const phrase = normalizePhrase(options.phrase ?? loadPhrase());
  const fetchImpl = options.fetchImpl || fetch;
  const url = options.url || shelfUrl();
  if (!phrase) return { ok: false, reason: 'missing', highlights: [] };
  if (!url) return { ok: false, reason: 'unconfigured', highlights: [] };
  try {
    const response = await send(fetchImpl, url, { headers: shelfHeaders(phrase) });
    if (!response) return { ok: false, reason: 'unreachable', highlights: [] };
    if (response.status === 401) return { ok: false, reason: 'rejected', highlights: [] };
    const document = documentFrom(await readJson(response));
    if (!response.ok || !document) return { ok: false, reason: 'unreachable', highlights: [] };
    return {
      ok: true,
      highlights: document.highlights,
      highlightTombstones: document.highlightTombstones,
    };
  } catch {
    return { ok: false, reason: 'unreachable', highlights: [] };
  }
}

export async function publishHighlight(highlight, options = {}) {
  const phrase = normalizePhrase(options.phrase ?? loadPhrase());
  const fetchImpl = options.fetchImpl || fetch;
  const url = options.url || shelfUrl();
  const item = asHighlight(highlight);
  if (!item) return { ok: false, reason: 'invalid', highlights: [] };
  if (!phrase) return { ok: false, reason: 'missing', highlights: [] };
  if (!url) return { ok: false, reason: 'unconfigured', highlights: [] };

  const put = await send(fetchImpl, url, {
    method: 'PUT',
    headers: { ...shelfHeaders(phrase), 'Content-Type': 'application/json' },
    body: JSON.stringify({ highlight: item }),
  });
  if (!put) return { ok: false, reason: 'unreachable', highlights: [] };
  if (put.status === 401) return { ok: false, reason: 'rejected', highlights: [] };
  const saved = documentFrom(await readJson(put));
  if (!put.ok || !saved) return { ok: false, reason: 'unreachable', highlights: [] };
  const kept = saved.highlights.find((entry) => entry.id === item.id)
    || saved.highlights.find(
      (entry) => entry.articleKey === item.articleKey && entry.start === item.start && entry.end === item.end,
    );
  if (saved.refused === 'blocked' && !kept) {
    return {
      ok: true,
      blocked: true,
      highlights: saved.highlights,
      highlightTombstones: saved.highlightTombstones,
    };
  }
  if (saved.refused === 'full' && !kept) {
    return { ok: false, reason: 'full', highlights: saved.highlights };
  }
  if (!kept) return { ok: false, reason: 'unreachable', highlights: saved.highlights };
  return {
    ok: true,
    highlight: kept,
    highlights: saved.highlights,
    highlightTombstones: saved.highlightTombstones,
  };
}

export async function deleteSharedHighlight(id, options = {}) {
  const key = String(id || '');
  if (!key) return { ok: false, reason: 'invalid', highlights: [] };
  const deletedAt = Number(options.deletedAt) || Date.now();
  const newer = loadHighlights().find((item) => item.id === key && item.updatedAt > deletedAt);
  if (newer) return { ok: true, skipped: true, highlights: loadHighlights() };
  forgetHighlightLocally(key, deletedAt);
  const phrase = normalizePhrase(options.phrase ?? loadPhrase());
  const fetchImpl = options.fetchImpl || fetch;
  const url = options.url || shelfUrl();
  if (!phrase) return { ok: true, reason: 'missing', highlights: loadHighlights() };
  if (!url) return { ok: true, reason: 'unconfigured', highlights: loadHighlights() };

  const response = await send(fetchImpl, url, {
    method: 'DELETE',
    headers: { ...shelfHeaders(phrase), 'Content-Type': 'application/json' },
    body: JSON.stringify({ highlightId: key }),
  });
  if (!response) return { ok: false, reason: 'unreachable', highlights: loadHighlights() };
  if (response.status === 401) return { ok: false, reason: 'rejected', highlights: loadHighlights() };
  const saved = documentFrom(await readJson(response));
  if (!response.ok || !saved || saved.highlights.some((item) => item.id === key)) {
    return { ok: false, reason: 'unreachable', highlights: saved?.highlights || loadHighlights() };
  }
  applyHighlightTombstones(saved.highlightTombstones);
  writeHighlightCache(saved.highlights, phrase);
  return {
    ok: true,
    highlights: saved.highlights,
    highlightTombstones: saved.highlightTombstones,
  };
}
