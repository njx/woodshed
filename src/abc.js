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
  let name = octave >= 5 ? letter.toLowerCase() : letter.toUpperCase();
  if (octave > 5) name += "'".repeat(octave - 5);
  if (octave < 4) name += ','.repeat(4 - octave);
  return `${accidental}${name}${lengthSuffix(unitsFor(duration, dotted))}`;
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

export function buildAbc(body, { meter = '4/4', tempo = 100 } = {}) {
  return ['X:1', `M:${meter}`, 'L:1/8', `Q:1/4=${tempo}`, 'K:C', body.trim() || 'z8|'].join('\n');
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

// A lick's first n chords: its notation up to its (n+1)th chord change (a chord symbol unlike
// the one before), cut at the bar line before it. (For playing part of a lick over part of a
// progression.)
export function abcFirstChords(abc, n) {
  let changes = 0;
  let prev = null;
  for (const m of String(abc).matchAll(/"([^"]*)"/g)) {
    if (m[1] === prev) continue;
    prev = m[1];
    if (++changes === n + 1) {
      const before = abc.slice(0, m.index);
      const bar = before.lastIndexOf('|');
      return (bar >= 0 ? before.slice(0, bar + 1) : before).trim();
    }
  }
  return abc;
}
