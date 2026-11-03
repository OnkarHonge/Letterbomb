/**
 * A spoken first letter.
 * The phone's recognizer hears words, not keys, so "bee" and "bravo" both mean B.
 * A sentence is not a letter: "the" must not become T.
 * `oh` is the letter O, and the digit 0 only when that is the letter this word wants.
 */

/** Extra time on the bar so a transcript can arrive after the player has spoken. */
export const VOICE_LATE_MS = 1200;

/** How long a heard voice may wait for a letter before it counts as unheard. */
export const VOICE_HOLD_MS = 1800;

const ALIASES = new Map([
  ['a', 'A'], ['ay', 'A'], ['alpha', 'A'],
  ['b', 'B'], ['be', 'B'], ['bee', 'B'], ['bravo', 'B'],
  ['c', 'C'], ['see', 'C'], ['sea', 'C'], ['cee', 'C'], ['charlie', 'C'],
  ['d', 'D'], ['dee', 'D'], ['delta', 'D'],
  ['e', 'E'], ['ee', 'E'], ['echo', 'E'],
  ['f', 'F'], ['ef', 'F'], ['eff', 'F'], ['foxtrot', 'F'],
  ['g', 'G'], ['gee', 'G'], ['golf', 'G'],
  ['h', 'H'], ['aitch', 'H'], ['haitch', 'H'], ['hotel', 'H'],
  ['i', 'I'], ['eye', 'I'], ['india', 'I'],
  ['j', 'J'], ['jay', 'J'], ['juliet', 'J'], ['juliett', 'J'],
  ['k', 'K'], ['kay', 'K'], ['kilo', 'K'],
  ['l', 'L'], ['el', 'L'], ['ell', 'L'], ['lima', 'L'],
  ['m', 'M'], ['em', 'M'], ['mike', 'M'],
  ['n', 'N'], ['en', 'N'], ['november', 'N'],
  ['o', 'O'], ['oh', 'O'], ['oscar', 'O'],
  ['p', 'P'], ['pee', 'P'], ['pea', 'P'], ['papa', 'P'],
  ['q', 'Q'], ['cue', 'Q'], ['queue', 'Q'], ['quebec', 'Q'],
  ['r', 'R'], ['ar', 'R'], ['are', 'R'], ['romeo', 'R'],
  ['s', 'S'], ['ess', 'S'], ['es', 'S'], ['sierra', 'S'],
  ['t', 'T'], ['tee', 'T'], ['tea', 'T'], ['tango', 'T'],
  ['u', 'U'], ['you', 'U'], ['uniform', 'U'],
  ['v', 'V'], ['vee', 'V'], ['victor', 'V'],
  ['w', 'W'], ['double u', 'W'], ['double you', 'W'], ['whiskey', 'W'],
  ['x', 'X'], ['ex', 'X'], ['x ray', 'X'], ['ex ray', 'X'], ['xray', 'X'],
  ['y', 'Y'], ['why', 'Y'], ['wye', 'Y'], ['yankee', 'Y'],
  ['z', 'Z'], ['zee', 'Z'], ['zed', 'Z'], ['zulu', 'Z'],
  ['0', '0'], ['zero', '0'],
  ['1', '1'], ['one', '1'],
  ['2', '2'], ['two', '2'],
  ['3', '3'], ['three', '3'],
  ['4', '4'], ['four', '4'],
  ['5', '5'], ['five', '5'],
  ['6', '6'], ['six', '6'],
  ['7', '7'], ['seven', '7'],
  ['8', '8'], ['eight', '8'],
  ['9', '9'], ['nine', '9'],
]);

function normalizeSpeech(raw) {
  let text = String(raw ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  for (let pass = 0; pass < 3 && text; pass += 1) {
    const next = text
      .replace(/^(?:um|uh|hmm|hm|er|ah)\s+/, '')
      .replace(/^(?:the letter|letter)\s+/, '')
      .trim();
    if (next === text) break;
    text = next;
  }
  return text;
}

/**
 * The letter a transcript names, or null when it is noise or a real word.
 * Interim results skip a bare character so a partial "b" inside a longer word waits.
 */
export function letterFromSpeech(raw, { interim = false, expected = null } = {}) {
  const text = normalizeSpeech(raw);
  if (!text) return null;
  if (interim && text.length < 2) return null;
  if (text === 'o' || text === 'oh') {
    return expected === '0' ? '0' : 'O';
  }
  return ALIASES.get(text) ?? null;
}

/** Prefer the letter this word wants when the recognizer offers more than one guess. */
export function chooseSpokenLetter(raws, options = {}) {
  const list = Array.isArray(raws) ? raws : [raws];
  const letters = [];
  for (const raw of list) {
    const letter = letterFromSpeech(raw, options);
    if (letter && !letters.includes(letter)) letters.push(letter);
  }
  if (!letters.length) return null;
  if (options.expected && letters.includes(options.expected)) return options.expected;
  return letters[0];
}
