// Pure shelf rules. The page and the Cloudflare worker both use these.
import { TEXT_LIMIT } from './storage.js';

export { TEXT_LIMIT };
export const SHELF_CAP = 24;
export const PHRASE_MIN = 8;
export const PHRASE_MAX = 200;

export function normalizePhrase(value) {
  const phrase = String(value || '').replace(/\s+/g, ' ').trim();
  if (phrase.length < PHRASE_MIN || phrase.length > PHRASE_MAX) return '';
  return phrase;
}

export function encodePhrase(phrase) {
  const bytes = new TextEncoder().encode(phrase);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function decodePhrase(value) {
  try {
    const binary = atob(String(value || ''));
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return '';
  }
}

export function articleKey(text) {
  let hash = 2166136261;
  const value = String(text);
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `${value.length.toString(16)}-${(hash >>> 0).toString(16)}`;
}

function asArticle(record) {
  if (!record || typeof record.text !== 'string') return null;
  const text = record.text;
  if (!text.trim() || text.length > TEXT_LIMIT) return null;
  const updatedAt = Number(record.updatedAt);
  return {
    _id: typeof record._id === 'string' ? record._id : '',
    key: articleKey(text),
    id: record.id || 'custom',
    label: record.label || 'Custom',
    text,
    updatedAt: Number.isFinite(updatedAt) && updatedAt > 0 ? updatedAt : 0,
  };
}

export function shelfArticles(records) {
  const byText = new Map();
  const list = Array.isArray(records) ? records : [];
  for (const record of list) {
    const article = asArticle(record);
    if (!article) continue;
    const current = byText.get(article.text);
    if (!current || article.updatedAt >= current.updatedAt) byText.set(article.text, article);
  }
  return [...byText.values()].sort(
    (a, b) => b.updatedAt - a.updatedAt || a.label.localeCompare(b.label),
  );
}

export function planShelf(records) {
  const ranked = shelfArticles(records);
  const articles = ranked.slice(0, SHELF_CAP);
  const keep = new Set(articles.map((article) => article._id).filter(Boolean));
  const removeIds = [];
  for (const record of Array.isArray(records) ? records : []) {
    const article = asArticle(record);
    if (article?._id && !keep.has(article._id)) removeIds.push(article._id);
  }
  return { articles, removeIds };
}

export function articleToOpen({ local, shelf, articlePicked, idle, modalOpen }) {
  if (articlePicked || !idle || modalOpen) return null;
  const newest = shelfArticles(shelf)[0];
  if (!newest || newest.text === local?.text) return null;
  if (newest.updatedAt <= (Number(local?.savedAt) || 0)) return null;
  return newest;
}
