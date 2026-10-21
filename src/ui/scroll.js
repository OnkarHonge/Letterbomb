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
