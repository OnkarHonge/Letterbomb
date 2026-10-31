// One shelf per sync phrase. The phrase is hashed and never stored.
import { decodePhrase, normalizePhrase, planShelf } from '../src/shelf.js';

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
  headers.set('Access-Control-Allow-Methods', 'GET, PUT, OPTIONS');
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

async function readShelf(env, key) {
  const raw = await env.SHELF.get(key);
  if (!raw) return { version: 1, articles: [] };
  try {
    const data = JSON.parse(raw);
    const articles = planShelf(data?.articles).articles.map(publicArticle);
    return { version: 1, articles };
  } catch {
    return { version: 1, articles: [] };
  }
}

function publicArticle(article) {
  return {
    id: article.id,
    label: article.label,
    text: article.text,
    updatedAt: article.updatedAt,
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
    const incoming = Array.isArray(body?.articles) ? body.articles : body?.article ? [body.article] : [];
    const stored = await readShelf(env, key);
    const articles = planShelf([...stored.articles, ...incoming]).articles.map(publicArticle);
    const next = { version: 1, articles };
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
