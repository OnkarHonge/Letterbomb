// Sync phrase and the Cloudflare shelf. This browser's save still wins
// when the phrase is missing or the shelf cannot be reached.
import { TEXT_LIMIT } from './storage.js';
import {
  articleKey,
  articleToOpen,
  encodePhrase,
  normalizePhrase,
  planShelf,
  shelfArticles,
} from './shelf.js';

export { articleKey, articleToOpen, planShelf, shelfArticles };

// Filled in after the worker is deployed. Dev uses the local wrangler port.
const PUBLISHED_SHELF = 'https://letterbomb-shelf.onkarhonge.workers.dev/shelf';

export function shelfUrl() {
  if (import.meta.env?.VITE_SHELF_URL) return import.meta.env.VITE_SHELF_URL;
  if (import.meta.env?.DEV) return 'http://127.0.0.1:8787/shelf';
  return PUBLISHED_SHELF;
}

const PHRASE_KEY = 'reflexread.phrase.v1';
const CACHE_KEY = 'reflexread.shelf.v1';
const HISTORY_KEY = 'reflexread.history.v1';

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
    // The in-memory game keeps going without the phrase.
  }
}

function cacheMark(phrase) {
  return articleKey(normalizePhrase(phrase));
}

export function loadShelfCache(phrase = loadPhrase()) {
  const mark = cacheMark(phrase);
  if (!mark) return [];
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return [];
    const data = JSON.parse(raw);
    if (data?.mark !== mark) return [];
    return shelfArticles(data.articles);
  } catch {
    return [];
  }
}

function slimArticles(articles) {
  return shelfArticles(articles).map(({ id, label, text, updatedAt }) => ({
    id,
    label,
    text,
    updatedAt,
  }));
}

export function loadHistory() {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const data = JSON.parse(raw);
    return shelfArticles(data?.articles);
  } catch {
    return [];
  }
}

export function rememberHistory(article) {
  const text = String(article?.text || '');
  const updatedAt = Number(article?.savedAt || article?.updatedAt) || Date.now();
  const articles = planShelf([
    ...loadHistory(),
    {
      id: article?.id || 'custom',
      label: article?.label || 'Custom',
      text,
      updatedAt,
    },
  ]).articles;
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify({
      version: 1,
      articles: slimArticles(articles),
    }));
  } catch {
    // This session still has the list even if the browser refused the write.
  }
  return articles;
}

export function writeShelfCache(articles, phrase = loadPhrase()) {
  const mark = cacheMark(phrase);
  if (!mark) return false;
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({
      version: 1,
      mark,
      articles: slimArticles(articles),
    }));
    return true;
  } catch {
    return false;
  }
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

function articlesFrom(data) {
  if (!data || !Array.isArray(data.articles)) return null;
  return shelfArticles(data.articles);
}

export async function pullShelf(options = {}) {
  const phrase = normalizePhrase(options.phrase ?? loadPhrase());
  const fetchImpl = options.fetchImpl || fetch;
  const url = options.url || shelfUrl();
  if (!phrase) return { ok: false, reason: 'missing', articles: [] };
  if (!url) return { ok: false, reason: 'unconfigured', articles: [] };
  try {
    const response = await send(fetchImpl, url, { headers: shelfHeaders(phrase) });
    if (!response) return { ok: false, reason: 'unreachable', articles: [] };
    if (response.status === 401) return { ok: false, reason: 'rejected', articles: [] };
    const articles = articlesFrom(await readJson(response));
    if (!response.ok || !articles) return { ok: false, reason: 'unreachable', articles: [] };
    return { ok: true, articles };
  } catch {
    return { ok: false, reason: 'unreachable', articles: [] };
  }
}

export async function publishArticle(article, options = {}) {
  const phrase = normalizePhrase(options.phrase ?? loadPhrase());
  const fetchImpl = options.fetchImpl || fetch;
  const url = options.url || shelfUrl();
  const text = String(article?.text || '');
  if (!text.trim() || text.length > TEXT_LIMIT) return { ok: false, reason: 'size', articles: [] };
  if (!phrase) return { ok: false, reason: 'missing', articles: [] };
  if (!url) return { ok: false, reason: 'unconfigured', articles: [] };

  const headers = shelfHeaders(phrase);
  const read = await send(fetchImpl, url, { headers });
  if (!read) return { ok: false, reason: 'unreachable', articles: [] };
  if (read.status === 401) return { ok: false, reason: 'rejected', articles: [] };
  const current = articlesFrom(await readJson(read));
  if (!read.ok || !current) return { ok: false, reason: 'unreachable', articles: [] };

  const savedAt = Number(article.savedAt) || Date.now();
  const payload = {
    id: article.id || 'custom',
    label: article.label || 'Custom',
    text,
    updatedAt: savedAt,
  };
  const existing = current.find((item) => item.text === text);
  if (existing && savedAt <= existing.updatedAt) return { ok: true, articles: current };

  const put = await send(fetchImpl, url, {
    method: 'PUT',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ article: payload }),
  });
  if (!put) return { ok: false, reason: 'unreachable', articles: current };
  if (put.status === 401) return { ok: false, reason: 'rejected', articles: [] };
  const saved = articlesFrom(await readJson(put));
  if (!put.ok || !saved || !saved.some((item) => item.text === text)) {
    return { ok: false, reason: 'unreachable', articles: saved || current };
  }
  return { ok: true, articles: saved };
}
