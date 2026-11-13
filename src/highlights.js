// Kept lines. One article has many. The id is assigned here and never shown.
import { isTerminator } from './engine/parseText.js';

export const HIGHLIGHT_CAP = 200;
export const HIGHLIGHT_TOMBSTONE_CAP = 200;
export const NOTE_LIMIT = 8_000;

export function createHighlightId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `h-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function asHighlight(record) {
  if (!record || typeof record !== 'object') return null;
  const id = typeof record.id === 'string' ? record.id.trim() : '';
  const articleKey = typeof record.articleKey === 'string' ? record.articleKey.trim() : '';
  const source = typeof record.source === 'string' ? record.source.trim() : '';
  const note = typeof record.note === 'string' ? record.note.trim() : '';
  const start = Number(record.start);
  const end = Number(record.end);
  const updatedAt = Number(record.updatedAt);
  const createdAt = Number(record.createdAt);
  if (!id || id.length > 80 || !articleKey || articleKey.length > 80) return null;
  if (!source || source.length > NOTE_LIMIT || !note || note.length > NOTE_LIMIT) return null;
  if (!Number.isInteger(start) || start < 0 || !Number.isInteger(end) || end <= start) return null;
  if (!Number.isFinite(updatedAt) || updatedAt <= 0) return null;
  const articleLabel = String(record.articleLabel || 'Article').replace(/\s+/g, ' ').trim().slice(0, 120) || 'Article';
  return {
    id,
    articleKey,
    articleLabel,
    source,
    note,
    start,
    end,
    updatedAt,
    createdAt: Number.isFinite(createdAt) && createdAt > 0 ? createdAt : updatedAt,
  };
}

export function planHighlights(records) {
  const byId = new Map();
  const list = Array.isArray(records) ? records : [];
  for (const record of list) {
    const item = asHighlight(record);
    if (!item) continue;
    const current = byId.get(item.id);
    if (!current || item.updatedAt >= current.updatedAt) byId.set(item.id, item);
  }
  const bySpan = new Map();
  for (const item of byId.values()) {
    const key = `${item.articleKey}:${item.start}:${item.end}`;
    const current = bySpan.get(key);
    if (!current || item.updatedAt >= current.updatedAt) bySpan.set(key, item);
  }
  return [...bySpan.values()].sort(
    (a, b) => b.updatedAt - a.updatedAt || a.note.localeCompare(b.note),
  );
}

export function planHighlightTombstones(records) {
  const byId = new Map();
  const list = Array.isArray(records) ? records : [];
  for (const record of list) {
    const id = typeof record?.id === 'string' ? record.id : '';
    const deletedAt = Number(record?.deletedAt);
    if (!id || !Number.isFinite(deletedAt) || deletedAt <= 0) continue;
    const current = byId.get(id);
    if (!current || deletedAt >= current.deletedAt) byId.set(id, { id, deletedAt });
  }
  return [...byId.values()]
    .sort((a, b) => b.deletedAt - a.deletedAt)
    .slice(0, HIGHLIGHT_TOMBSTONE_CAP);
}

export function blockedHighlight(highlight, tombstones) {
  const id = highlight?.id;
  if (!id) return false;
  const tomb = planHighlightTombstones(tombstones).find((item) => item.id === id);
  if (!tomb) return false;
  return (Number(highlight.updatedAt) || 0) <= tomb.deletedAt;
}

export function findSpan(highlights, articleKey, start, end) {
  return planHighlights(highlights).find(
    (item) => item.articleKey === articleKey && item.start === start && item.end === end,
  ) || null;
}

/** A new line is refused once the bucket is full. The same span keeps its id. */
export function admitHighlight(existing, incoming) {
  const item = asHighlight(incoming);
  const highlights = planHighlights(existing);
  if (!item) return { ok: false, reason: 'invalid', highlights };
  const same = highlights.find((entry) => entry.id === item.id)
    || highlights.find(
      (entry) => entry.articleKey === item.articleKey && entry.start === item.start && entry.end === item.end,
    );
  if (!same && highlights.length >= HIGHLIGHT_CAP) {
    return { ok: false, reason: 'full', highlights };
  }
  const stored = same && same.id !== item.id
    ? { ...item, id: same.id, createdAt: same.createdAt }
    : item;
  const rest = highlights.filter((entry) => entry.id !== stored.id);
  return { ok: true, highlight: stored, highlights: planHighlights([...rest, stored]) };
}

export function sentenceBounds(words, index) {
  const list = Array.isArray(words) ? words : [];
  if (!list.length) return null;
  const at = Math.min(Math.max(0, index), list.length - 1);
  let start = at;
  while (start > 0 && !list[start]?.breakBefore && !isTerminator(list[start - 1]?.original)) {
    start -= 1;
  }
  let end = at + 1;
  while (end < list.length && !list[end]?.breakBefore && !isTerminator(list[end - 1]?.original)) {
    end += 1;
  }
  return { start, end };
}

export function spanText(words, start, end) {
  const list = Array.isArray(words) ? words : [];
  const from = Math.max(0, Number(start) || 0);
  const to = Math.min(list.length, Number(end) || 0);
  let text = '';
  for (let i = from; i < to; i += 1) {
    const word = list[i];
    if (!word) continue;
    const original = String(word.original ?? '');
    if (word.isGap && /^\s+$/.test(original)) continue;
    if (text && word.breakBefore) text += '\n\n';
    else if (text) text += ' ';
    text += original;
  }
  return text.trim();
}

/** Words immediately before a selection: the rest of this sentence, or the sentence before it. */
export function contextBefore(words, start) {
  if (!Array.isArray(words) || start <= 0) return '';
  const bounds = sentenceBounds(words, start - 1);
  if (!bounds) return '';
  return spanText(words, bounds.start, start);
}

export function extendNote(note, words, start) {
  const current = String(note || '').trim();
  const immediate = contextBefore(words, start);
  if (!immediate) return current;
  if (!current.startsWith(immediate)) {
    if (current.includes(immediate)) return current;
    return `${immediate} ${current}`.trim();
  }
  const covered = sentenceBounds(words, start - 1);
  if (!covered || covered.start <= 0) return current;
  const further = contextBefore(words, covered.start);
  if (!further || current.startsWith(further) || current.includes(further)) return current;
  return `${further} ${current}`.trim();
}

export function groupHighlights(highlights) {
  const groups = [];
  for (const item of planHighlights(highlights)) {
    let group = groups.find((entry) => entry.articleKey === item.articleKey);
    if (!group) {
      group = {
        articleKey: item.articleKey,
        label: item.articleLabel || 'Article',
        newest: item.updatedAt,
        items: [],
      };
      groups.push(group);
    }
    if (item.updatedAt >= group.newest) {
      group.newest = item.updatedAt;
      if (item.articleLabel) group.label = item.articleLabel;
    }
    group.items.push(item);
  }
  groups.sort((a, b) => b.newest - a.newest || a.label.localeCompare(b.label));
  return groups;
}

export function highlightsMarkdown(highlights) {
  const groups = groupHighlights(highlights);
  if (!groups.length) return '';
  return groups.map((group) => {
    const blocks = [`# ${group.label}`];
    for (const item of group.items) {
      const note = item.note.trim();
      const source = item.source.trim();
      blocks.push(note);
      if (source && source !== note) blocks.push(`Source: ${source}`);
    }
    return blocks.join('\n\n');
  }).join('\n\n');
}
