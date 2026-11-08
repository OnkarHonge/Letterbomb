/** True when this device has a touchscreen, including a laptop with a touch panel. */
export function hasTouchscreen(target = globalThis) {
  const match = target.matchMedia;
  if (typeof match === 'function') {
    try {
      if (match.call(target, '(any-pointer: coarse)').matches) return true;
    } catch {
      // An unsupported query is not a touchscreen.
    }
  }
  const points = target.navigator?.maxTouchPoints;
  return typeof points === 'number' && points > 0;
}
