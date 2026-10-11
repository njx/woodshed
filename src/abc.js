import { TRANSPOSITIONS } from './constants.js';

// Notation for exercises is ABC (abcnotation.com) with an eighth note as the unit (L:1/8),
// written as if in C. To show it in another key it's shifted up 0–11 semitones, so a pattern
// written around middle C stays in a comfortable range.

export const DURATIONS = {
  whole: { label: 'Whole', units: 8 },
  half: { label: 'Half', units: 4 },
  quarter: { label: 'Quarter', units: 2 },
  eighth: { label: 'Eighth', units: 1 },
  sixteenth: { label: 'Sixteenth', units: 0.5 },
};

// Length suffix for a number of eighth-note units: 1 → '', 2 → '2', 0.5 → '/', 1.5 → '3/2'.
export function lengthSuffix(units) {
  if (units === 1) return '';
  if (Number.isInteger(units)) return String(units);
  if (units === 0.5) return '/';
  for (const den of [2, 4, 8]) {
    const num = units * den;
    if (Number.isInteger(num)) return `${num}/${den}`;
  }
  return '';
}

export function unitsFor(duration, dotted = false) {
  return DURATIONS[duration].units * (dotted ? 1.5 : 1);
}

// One note: letter A–G, accidental '' | '^' (sharp) | '_' (flat) | '=' (natural),
// octave 4 = the octave from middle C up.
export function noteToken({ letter, accidental = '', octave = 4, duration = 'eighth', dotted = false }) {
  return `${accidental}${noteName(letter, octave)}${lengthSuffix(unitsFor(duration, dotted))}`;
}

// ---------- Notes near the one before ----------
const LETTERS = 'CDEFGAB';
const noteName = (letter, octave) => {
  let name = octave >= 5 ? letter.toLowerCase() : letter.toUpperCase();
  if (octave > 5) name += "'".repeat(octave - 5);
  if (octave < 4) name += ','.repeat(4 - octave);
  return name;
};
const octaveOf = (letter, marks) => (letter === letter.toLowerCase() ? 5 + (marks.match(/'/g) || []).length : 4 - (marks.match(/,/g) || []).length);

// The last note in `text` (e.g. the notation before the cursor), skipping chord symbols and
// decorations: { index, length (of the letter and octave marks), letter, octave }, or null.
export function lastNote(text) {
  const plain = String(text).replace(/"[^"]*"|![^!]*!|\[[A-Za-z]:[^\]]*\]/g, (m) => ' '.repeat(m.length));
  let found = null;
  for (const m of plain.matchAll(/([A-Ga-g])([,']*)/g)) found = m;
  if (!found) return null;
  return { index: found.index, length: found[0].length, letter: found[1].toUpperCase(), octave: octaveOf(found[1], found[2]) };
}

// The octave for `letter` that puts it nearest the note before (`prev`, from lastNote): C after B
// goes up, B after C goes down. Without one, octave 4.
export function nearestOctave(letter, prev) {
  if (!prev) return 4;
  const from = prev.octave * 7 + LETTERS.indexOf(prev.letter);
  let best = 4;
  for (let o = 2; o <= 6; o++) if (Math.abs(o * 7 + LETTERS.indexOf(letter) - from) < Math.abs(best * 7 + LETTERS.indexOf(letter) - from)) best = o;
  return best;
}

// `text` with its last note moved an octave up (d = 1) or down (-1), if there's room; and how
// many characters longer it got. (For moving the note before the cursor.)
export function moveLastNote(text, d) {
  const n = lastNote(text);
  if (!n) return null;
  const octave = Math.max(2, Math.min(6, n.octave + d));
  if (octave === n.octave) return null;
  const name = noteName(n.letter, octave);
  return { text: text.slice(0, n.index) + name + text.slice(n.index + n.length), delta: name.length - n.length, octave };
}

export function restToken(duration = 'eighth', dotted = false) {
  return `z${lengthSuffix(unitsFor(duration, dotted))}`;
}

// Lays notation out a bar per line (easier to read on a phone), except that bars with only a note
// or two, not counting rests (a pickup, or a last note on the 1), stay on the line next to them,
// and a line holds at most 4 bars. Existing line breaks are kept. Repeat signs stay together: "|:" starts a bar;
// ":|", "||" and "|]" end one.
const BAR_END = /(\|\]|\|\||:\||\|)(?![:\]|])/g;
const notesIn = (bar) => (bar.replace(/"[^"]*"|![^!]*!|\[[A-Za-z]:[^\]]*\]/g, '').match(/[A-Ga-g]/g) || []).length;

// perLine: how many bars with several notes go on a line (1 on a phone held upright; more when
// there's room, as in full screen).
export function barPerLine(body, perLine = 1) {
  return body.split('\n').map((line) => {
    const bars = [];
    let last = 0;
    for (const m of line.matchAll(BAR_END)) {
      bars.push(line.slice(last, m.index + m[0].length).trim());
      last = m.index + m[0].length;
    }
    if (line.slice(last).trim()) bars.push(line.slice(last).trim());
    const lines = [];
    let cur = null; // { bars, full }
    for (const bar of bars) {
      const full = notesIn(bar) > 2;
      if (!cur || (full && cur.full >= perLine) || cur.bars.length >= 4 * perLine) lines.push((cur = { bars: [], full: 0 }));
      cur.bars.push(bar);
      if (full) cur.full++;
    }
    return lines.map((l) => l.bars.join(' ')).join('\n');
  }).join('\n');
}

// key: the key it's written in (0–11 major, 12–23 minor), for the key signature.
export function buildAbc(body, { meter = '4/4', tempo = 100, key = 0 } = {}) {
  return ['X:1', `M:${meter}`, 'L:1/8', `Q:1/4=${tempo}`, `K:${abcKey(key)}`, body.trim() || 'z8|'].join('\n');
}

// ---------- The key a written exercise is in ----------
// A written exercise (a lick, a riff) is written in a key of your choosing (`home`: 0–11 major,
// 12–23 minor; C if not set), as you read it on your instrument; it's transposed from there.
// (Generated notation — scales, arpeggios, progressions — is always in C.)
export const homeKey = (t) => (t?.vary || t?.fromTune ? 0 : t?.home ?? 0);
const MAJOR = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const MINOR = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'G#', 'A', 'Bb', 'B'];
export const abcKey = (k) => (k >= 12 ? `${MINOR[k % 12]}m` : MAJOR[k % 12]);
// For showing: B♭, F♯m.
export const homeName = (k) => abcKey(k).replace('b', '♭').replace('#', '♯');
// Semitones to shift an exercise written in `home` so it shows in concert key `root`.
export const homeShift = (root, home, view = 'c') => (((writtenShift(root, view) - (home % 12)) % 12) + 12) % 12;

// Sharps (+) or flats (−) in a key's signature, and what it does to each letter.
const SIG_COUNT = [0, -5, 2, -3, 4, -1, -6, 1, -4, 3, -2, 5]; // major keys C…B
function signature(k) {
  const n = SIG_COUNT[(k >= 12 ? k + 3 : k) % 12]; // a minor key: its relative major's
  const out = { C: 0, D: 0, E: 0, F: 0, G: 0, A: 0, B: 0 };
  for (const l of [...(n > 0 ? 'FCGDAEB' : 'BEADGCF')].slice(0, Math.abs(n))) out[l] = Math.sign(n);
  return out;
}
const ACC = { '^^': 2, '^': 1, '=': 0, _: -1, __: -2 };
const accText = (a) => ({ 2: '^^', 1: '^', 0: '=', '-1': '_', '-2': '__' })[a];

// The same notes under another key signature: accidentals added or dropped so every note keeps
// its pitch (an accidental lasts to the end of its bar, as in ABC). Chord symbols are untouched.
export function rekey(body, from, to) {
  const [a, b] = [signature(from), signature(to)];
  if (Object.keys(a).every((l) => a[l] === b[l])) return body;
  let oldBar = {}, newBar = {};
  return String(body).replace(/"[^"]*"|![^!]*!|\||(\^\^|\^|__|_|=)?([A-Ga-g])([,']*)/g, (m, acc, letter, oct) => {
    if (m === '|') { oldBar = {}; newBar = {}; return m; }
    if (!letter) return m;
    const id = letter + oct;
    const L = letter.toUpperCase();
    let pitch;
    if (acc) { pitch = ACC[acc]; oldBar[id] = pitch; } else pitch = oldBar[id] ?? a[L];
    if (pitch === (newBar[id] ?? b[L])) return letter + oct;
    newBar[id] = pitch;
    return accText(pitch) + letter + oct;
  });
}

// Semitones to shift notation written in C so it shows in concert key `root`, written for an
// instrument (e.g. concert E♭ on a B♭ instrument is written in F: shift up 5).
export function writtenShift(root, view = 'c') {
  return (root + TRANSPOSITIONS[view].offset) % 12;
}

// What the shifted notation actually sounds like on that instrument, relative to the written
// notes: B♭ instruments sound a step lower, E♭ ones a sixth lower, F ones a fifth lower.
export function soundingShift(view = 'c') {
  return -TRANSPOSITIONS[view].offset;
}
