export const MIN_PREVIEW_LINES = 3;
export const PREVIEW_INSET = 4;
/** At this many rows or fewer, a recital phrase starts on the top row. */
export const RECITAL_TOP_ROWS = 3;
const SAME_ROW = 2;
export const SCROLL_TAKEOVER = 2;

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

// Recital keeps the phrase's first row near the top: the second row when more
// than three fit, and the top row when the view is that short or shorter.
export function scrollTopForRecitalLine({
  scrollTop,
  viewHeight,
  wordTop,
  wordHeight,
  pad = 12,
  lineHeight = 0,
} = {}) {
  const fitted = scrollTopToReveal(scrollTop, viewHeight, wordTop, wordHeight, pad);
  const view = Math.max(0, Number.isFinite(viewHeight) ? viewHeight : 0);
  const step = Math.max(0, Number.isFinite(lineHeight) ? lineHeight : 0);
  if (view <= 0 || step <= 0) return fitted;

  const top = Math.max(0, Number.isFinite(wordTop) ? wordTop : 0);
  const rows = Math.floor(view / step);
  if (rows <= RECITAL_TOP_ROWS) return Math.max(0, top - Math.max(0, pad));
  return Math.max(0, top - step);
}

// Padding under the article so the last row can reach that same slot.
// `lastTop` and `lastBottom` are that row's box, measured from the content top.
export function recitalTailSpace({
  viewHeight,
  lineHeight,
  lastTop = 0,
  lastBottom = 0,
  pad = 12,
} = {}) {
  const view = Math.max(0, Number.isFinite(viewHeight) ? viewHeight : 0);
  const step = Math.max(0, Number.isFinite(lineHeight) ? lineHeight : 0);
  if (view <= 0 || step <= 0) return 0;

  const top = Math.max(0, Number.isFinite(lastTop) ? lastTop : 0);
  const bottom = Math.max(top, Number.isFinite(lastBottom) ? lastBottom : top);
  const target = scrollTopForRecitalLine({
    scrollTop: 0,
    viewHeight: view,
    wordTop: top,
    wordHeight: bottom - top,
    pad,
    lineHeight: step,
  });
  if (target <= 0) return 0;
  return Math.max(0, Math.ceil(target + view - bottom));
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

// A line of text settles in a fraction of a second. A long jump stays brief.
export function scrollEaseMs(distance) {
  const px = Math.abs(Number.isFinite(distance) ? distance : 0);
  if (px < 1) return 0;
  return Math.round(Math.min(420, Math.max(180, px * 5)));
}

// Ease-out so the line starts moving immediately and settles at the end.
export function easedScrollTop(from, to, elapsed, duration) {
  const start = Number.isFinite(from) ? from : 0;
  const end = Number.isFinite(to) ? to : start;
  const span = Number.isFinite(duration) ? duration : 0;
  if (span <= 0) return end;
  const t = Math.min(1, Math.max(0, elapsed / span));
  const eased = 1 - (1 - t) ** 2;
  return start + (end - start) * eased;
}

// Start a glide, keep the one already running, or jump when motion is reduced.
export function beginScroll({ current, target, now = 0, motion = null, smooth = true } = {}) {
  const from = Number.isFinite(current) ? current : 0;
  const to = Number.isFinite(target) ? target : from;
  if (!smooth || Math.abs(to - from) < 1) {
    return { motion: null, scrollTop: Math.abs(to - from) >= 1 ? to : null };
  }
  if (motion && Math.abs(motion.to - to) < 1) return { motion, scrollTop: null };
  return {
    motion: {
      from,
      to,
      start: Number.isFinite(now) ? now : 0,
      duration: scrollEaseMs(to - from),
      expected: from,
    },
    scrollTop: null,
  };
}

export function advanceScroll(motion, now = 0, smooth = true) {
  if (!motion) return { motion: null, scrollTop: null };
  if (!smooth) return { motion: null, scrollTop: motion.to };
  const start = Number.isFinite(motion.start) ? motion.start : 0;
  const elapsed = (Number.isFinite(now) ? now : 0) - start;
  const done = elapsed >= motion.duration;
  const scrollTop = done
    ? motion.to
    : easedScrollTop(motion.from, motion.to, elapsed, motion.duration);
  if (done) return { motion: null, scrollTop };
  return { motion: { ...motion, expected: scrollTop }, scrollTop };
}

export function scrollWasTaken(motion, scrollTop) {
  if (!motion || motion.applying || motion.expected == null) return false;
  const top = Number.isFinite(scrollTop) ? scrollTop : 0;
  return Math.abs(top - motion.expected) > SCROLL_TAKEOVER;
}
