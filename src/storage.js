const KEY = 'reflexread.v1';
export const TEXT_LIMIT = 400_000;

function storedArticle(article) {
  const stored = {
    id: article.id || 'custom',
    label: article.label || 'Custom',
    text: article.text,
  };
  const savedAt = Number(article.savedAt);
  if (Number.isFinite(savedAt) && savedAt > 0) stored.savedAt = savedAt;
  return stored;
}

export function loadSave() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    return data && typeof data === 'object' ? data : null;
  } catch {
    return null;
  }
}

export function writeSave(data) {
  const existing = loadSave();
  let article = data.article || null;
  let skippedArticle = false;

  if (article?.text && article.text.length > TEXT_LIMIT) {
    skippedArticle = true;
    article = existing?.article || null;
  }

  const payload = {
    version: 1,
    config: data.config,
    best: data.best,
    article: article?.text ? storedArticle(article) : null,
  };

  try {
    localStorage.setItem(KEY, JSON.stringify(payload));
    return { ok: true, skippedArticle };
  } catch {
    return { ok: false, skippedArticle };
  }
}
