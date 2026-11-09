// One shelf per sync phrase. The phrase is hashed and never stored.
// Articles and their kept lines share that shelf. A line never travels alone.
import {
  articleKey,
  blockedByTombstone,
  decodePhrase,
  normalizePhrase,
  planShelf,
  planTombstones,
} from '../src/shelf.js';
import {
  admitHighlight,
  blockedHighlight,
  planHighlightTombstones,
  planHighlights,
} from '../src/highlights.js';

const PHRASE_HEADER = 'X-Reflex-Phrase';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function withCors(response) {
  const headers = new Headers(response.headers);
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Access-Control-Allow-Methods', 'GET, PUT, DELETE, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Content-Type, Accept, X-Reflex-Phrase');
  headers.set('Access-Control-Max-Age', '86400');
  return new Response(response.body, { status: response.status, headers });
}

async function shelfKey(phrase) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(phrase));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function phraseFrom(request) {
  return normalizePhrase(decodePhrase(request.headers.get(PHRASE_HEADER)));
}

function emptyShelf() {
  return {
    version: 1,
    articles: [],
    tombstones: [],
    highlights: [],
    highlightTombstones: [],
  };
}

function publicArticle(article) {
  return {
    id: article.id,
    label: article.label,
    text: article.text,
    updatedAt: article.updatedAt,
  };
}

async function readShelf(env, key) {
  const raw = await env.SHELF.get(key);
  if (!raw) return emptyShelf();
  try {
    const data = JSON.parse(raw);
    const tombstones = planTombstones(data?.tombstones);
    const highlightTombstones = planHighlightTombstones(data?.highlightTombstones);
    const articles = planShelf(data?.articles).articles
      .filter((article) => !blockedByTombstone(article.text, article.updatedAt, tombstones))
      .map(publicArticle);
    const highlights = planHighlights(data?.highlights)
      .filter((item) => !blockedHighlight(item, highlightTombstones));
    return { version: 1, articles, tombstones, highlights, highlightTombstones };
  } catch {
    return emptyShelf();
  }
}

function stored(document, extra = {}) {
  return {
    version: 1,
    articles: document.articles,
    tombstones: document.tombstones,
    highlights: document.highlights,
    highlightTombstones: document.highlightTombstones,
    ...extra,
  };
}

export async function handleRequest(request, env) {
  if (request.method === 'OPTIONS') return withCors(new Response(null, { status: 204 }));

  const path = new URL(request.url).pathname;
  if (path !== '/' && path !== '/shelf') return withCors(json({ error: 'not-found' }, 404));

  const phrase = phraseFrom(request);
  if (!phrase) return withCors(json({ error: 'phrase' }, 401));
  const key = await shelfKey(phrase);

  if (request.method === 'GET') return withCors(json(await readShelf(env, key)));

  if (request.method === 'PUT') {
    let body;
    try {
      body = await request.json();
    } catch {
      return withCors(json({ error: 'body' }, 400));
    }
    const current = await readShelf(env, key);
    if (body?.highlight) {
      const admitted = admitHighlight(current.highlights, body.highlight);
      if (!admitted.ok) return withCors(json(stored(current, { refused: admitted.reason })));
      if (blockedHighlight(admitted.highlight, current.highlightTombstones)) {
        return withCors(json(stored(current, { refused: 'blocked' })));
      }
      const highlightTombstones = planHighlightTombstones(
        current.highlightTombstones.filter((item) => item.id !== admitted.highlight.id),
      );
      const next = stored({
        ...current,
        highlights: admitted.highlights,
        highlightTombstones,
      });
      await env.SHELF.put(key, JSON.stringify(next));
      return withCors(json(next));
    }

    const incoming = Array.isArray(body?.articles) ? body.articles : body?.article ? [body.article] : [];
    let tombstones = current.tombstones;
    const kept = [];
    for (const article of incoming) {
      const text = String(article?.text || '');
      const updatedAt = Number(article?.updatedAt) || 0;
      if (!text.trim()) continue;
      if (blockedByTombstone(text, updatedAt, tombstones)) continue;
      tombstones = tombstones.filter((item) => item.key !== articleKey(text));
      kept.push(article);
    }
    const articles = planShelf([...current.articles, ...kept]).articles.map(publicArticle);
    const next = stored({
      ...current,
      articles,
      tombstones: planTombstones(tombstones),
    });
    await env.SHELF.put(key, JSON.stringify(next));
    return withCors(json(next));
  }

  if (request.method === 'DELETE') {
    let body;
    try {
      body = await request.json();
    } catch {
      return withCors(json({ error: 'body' }, 400));
    }
    const current = await readShelf(env, key);
    const highlightId = typeof body?.highlightId === 'string' ? body.highlightId.trim() : '';
    if (highlightId) {
      const deletedAt = Date.now();
      const next = stored({
        ...current,
        highlights: current.highlights.filter((item) => item.id !== highlightId),
        highlightTombstones: planHighlightTombstones([
          ...current.highlightTombstones,
          { id: highlightId, deletedAt },
        ]),
      });
      await env.SHELF.put(key, JSON.stringify(next));
      return withCors(json(next));
    }

    const text = String(body?.text || '');
    if (!text.trim()) return withCors(json({ error: 'body' }, 400));
    const removal = articleKey(text);
    const deletedAt = Date.now();
    const next = stored({
      ...current,
      articles: current.articles.filter((article) => articleKey(article.text) !== removal),
      tombstones: planTombstones([...current.tombstones, { key: removal, deletedAt }]),
    });
    await env.SHELF.put(key, JSON.stringify(next));
    return withCors(json(next));
  }

  return withCors(json({ error: 'method' }, 405));
}

export default {
  fetch(request, env) {
    return handleRequest(request, env);
  },
};
