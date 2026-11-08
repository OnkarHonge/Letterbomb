import { zoneForKey, zoneName } from './quadrant.js';

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

export function drillMissNote(letter) {
  return `${letter} belongs in ${zoneName(zoneForKey(letter))}.`;
}

/**
 * One letter at a time. A correct corner brings the next letter.
 * A miss keeps this letter up and names its corner.
 */
export function createDrill({ random = Math.random } = {}) {
  let on = false;
  let letter = 'A';
  let hits = 0;
  let misses = 0;
  let streak = 0;
  let note = '';
  let mark = '';

  function pick(avoid) {
    const index = Math.min(25, Math.max(0, Math.floor(Number(random()) * 26) || 0));
    let next = LETTERS[index];
    if (next === avoid) next = LETTERS[(index + 1) % 26];
    return next;
  }

  return {
    start() {
      on = true;
      hits = 0;
      misses = 0;
      streak = 0;
      note = '';
      mark = '';
      letter = pick(null);
    },
    stop() {
      on = false;
      mark = '';
      note = '';
    },
    answer(zone) {
      if (!on || !zoneName(zone)) return null;
      const hit = zone === zoneForKey(letter);
      if (hit) {
        hits += 1;
        streak += 1;
        note = '';
        mark = '';
        letter = pick(letter);
      } else {
        misses += 1;
        streak = 0;
        note = drillMissNote(letter);
        mark = 'miss';
      }
      return { hit, letter, note, mark, hits, misses, streak };
    },
    snapshot() {
      return { on, letter, hits, misses, streak, note, mark };
    },
  };
}
