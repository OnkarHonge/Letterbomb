export const MIN_PREVIEW_LINES = 3;
export const PREVIEW_INSET = 4;
const SAME_ROW = 2;

// Move the scroller only far enough to put the word inside the padded view.
export function scrollTopToReveal(scrollTop, viewHeight, wordTop, wordHeight, pad = 12) {
  const current = Number.isFinite(scrollTop) ? scrollTop : 0;
  const view = Math.max(0, viewHeight);
  const top = Math.max(0, wordTop);
  const height = Math.max(0, wordHeight);
  const inset = Math.max(0, pad);
  if (view <= 0) return Math.max(0, current);

  if (height + inset * 2 >= view) {
    if (top < current || top + height > current + view) return top;
    return current;
  }

  if (top < current + inset) return Math.max(0, top - inset);
  const wordBottom = top + height;
  if (wordBottom > current + view - inset) return wordBottom - view + inset;
  return current;
}

// Keep one full line under the line being read when the box is tall enough.
// The last line of the article has nothing under it, so it may sit at the bottom.
export function scrollTopForReadingLine({
  scrollTop,
  viewHeight,
  wordTop,
  wordHeight,
  pad = 12,
  lineHeight = 0,
  nextLineBottom = null,
}) {
  const fitted = scrollTopToReveal(scrollTop, viewHeight, wordTop, wordHeight, pad);
  if (nextLineBottom == null) return fitted;

  const current = Number.isFinite(scrollTop) ? scrollTop : 0;
  const view = Math.max(0, viewHeight);
  const step = Math.max(0, lineHeight);
  if (view <= 0 || step <= 0 || view / step < MIN_PREVIEW_LINES) return fitted;

  const inset = Math.max(0, pad);
  const top = Math.max(0, wordTop);
  let preview = nextLineBottom - view + PREVIEW_INSET;
  const maxScroll = Math.max(0, top - inset);
  if (preview > maxScroll) preview = maxScroll;
  if (preview < fitted) preview = fitted;
  if (preview < current) return fitted;
  return preview;
}

// The line height is the smallest step between word rows, so a paragraph gap
// does not look like the text is too short for a preview line.
export function nextLineUnder(words, activeTop, activeHeight = 0) {
  const origin = Number.isFinite(activeTop) ? activeTop : 0;
  let typical = 0;
  let rowTop = null;
  let nextTop = null;
  let nextBottom = 0;
  for (const word of words || []) {
    const wordTop = Number.isFinite(word?.top) ? word.top : 0;
    const wordHeight = Math.max(0, Number.isFinite(word?.height) ? word.height : 0);
    if (rowTop == null || wordTop > rowTop + SAME_ROW) {
      if (rowTop != null) {
        const step = wordTop - rowTop;
        if (!typical || step < typical) typical = step;
      }
      rowTop = wordTop;
    }
    if (wordTop <= origin + SAME_ROW) continue;
    if (nextTop == null || wordTop <= nextTop + SAME_ROW) {
      nextTop = nextTop == null ? wordTop : nextTop;
      nextBottom = Math.max(nextBottom, wordTop + wordHeight);
      continue;
    }
    break;
  }
  const fallback = Math.max(0, Number.isFinite(activeHeight) ? activeHeight : 0);
  return {
    lineHeight: typical || fallback,
    nextLineBottom: nextTop == null ? null : nextBottom,
  };
}
