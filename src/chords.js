import { TRANSPOSITIONS } from './constants.js';
import { isMinor } from './keys.js';

// Chord charts for tunes, and what's in them.
//
// A chart: { key (concert, 0–23 like tunes' keys), meter, sections: [section] }
//   section: { label, repeats, bars: [bar], endings: [[bar]] }
//   bar: { chords: [chord], alts: [chord] }   (no chords = the previous chord continues)
//   chord: { root 0–11 (concert), q (quality as written, e.g. 'm7b5', '7b9', '07'), bass? }
// Charts come from mikeoliphant/JazzStandards (iReal Pro's playlists), or are typed in.

const NOTE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const SHARPS = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
const FLATS = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'];

function noteNum(s) {
  const m = /^([A-G])([b#♭♯]?)$/.exec(s);
  if (!m) return null;
  return (NOTE[m[1]] + (m[2] === 'b' || m[2] === '♭' ? 11 : m[2] ? 1 : 0)) % 12;
}

// "Bbm7b5/E" → { root: 10, q: 'm7b5', bass: 4 }; null if it isn't a chord.
export function parseChord(s) {
  const m = /^([A-G][b#♭♯]?)([^/]*)(?:\/([A-G][b#♭♯]?))?$/.exec(String(s).trim());
  if (!m) return null;
  const q = m[2].replace(/♭/g, 'b').replace(/♯/g, '#').replace(/^(maj|Δ|\^)$/, 'maj7').replace(/^-/, 'm').replace(/^ø7?$/, 'm7b5').replace(/^[°o]7$/, '07').replace(/^[°o]$/, '0');
  if (!/^[\w#()+/]*$/.test(q)) return null;
  return { root: noteNum(m[1]), q, ...(m[3] ? { bass: noteNum(m[3]) } : {}) };
}

// One bar as written in JazzStandards: chords separated by commas; alternates in parentheses,
// which can follow a chord ("Dmaj7(Em7b5)") or stand alone, and can span a comma.
export function parseBar(s) {
  const alts = [];
  const main = String(s).replace(/\(([^)]*)\)?/g, (_, inner) => {
    for (const c of inner.split(',')) { const p = parseChord(c); if (p) alts.push(p); }
    return '';
  });
  const chords = main.split(',').map(parseChord).filter(Boolean);
  return { chords, alts };
}

// A JazzStandards entry → a chart.
export function chartFromStandard(x) {
  const keyM = /^([A-G][b#]?)(min)?$/.exec(x.Key || '');
  const key = keyM ? noteNum(keyM[1]) + (keyM[2] ? 12 : 0) : null;
  const bars = (seg) => String(seg?.Chords || '').split('|').map(parseBar);
  return {
    key,
    meter: x.TimeSignature || '4/4',
    sections: (x.Sections || []).map((s) => ({
      label: s.Label || '',
      repeats: s.Repeats || 0,
      bars: bars(s.MainSegment),
      endings: (s.Endings || []).map(bars),
    })),
  };
}

// ---------- Names ----------

// Sharps in sharp keys (G D A E B F♯ major and their minors), flats otherwise.
export function usesSharps(key) {
  const major = isMinor(key) ? (key + 3) % 12 : key % 12;
  return [7, 2, 9, 4, 11, 6].includes(major);
}
export const noteName = (pc, sharps) => (sharps ? SHARPS : FLATS)[((pc % 12) + 12) % 12];

// How a quality reads: 07 → °7, m7b5 → ø7, m/maj7 → m(maj7), 69 → 6/9.
export function qualityName(q) {
  return q
    .replace(/^m7b5$/, 'ø7').replace(/^07$/, '°7').replace(/^0$/, '°').replace(/^m\/maj7/, 'm(maj7)').replace(/^m69/, 'm6/9').replace(/^69/, '6/9')
    .replace(/b/g, '♭').replace(/#/g, '♯');
}

// A chord's name as written: shifted `shift` semitones, spelled for `key` (also shifted).
export function chordName(c, { shift = 0, sharps = false } = {}) {
  if (!c) return '';
  const bass = c.bass != null ? `/${noteName(c.bass + shift, sharps)}` : '';
  return `${noteName(c.root + shift, sharps)}${qualityName(c.q)}${bass}`;
}

// Semitones from a chart's key to the key it's shown in, written for an instrument.
export function chartShift(chart, toKey, view = 'c') {
  const from = chart.key ?? toKey ?? 0;
  const to = toKey ?? from;
  return ((((to - from) % 12) + 12) % 12) + TRANSPOSITIONS[view].offset;
}

// ---------- Editing as text ----------
// One section per line: "A: Cm7 | F7 | Bbmaj7 Ebmaj7 | %" (chords in a bar separated by spaces;
// % = the previous chord continues), endings as "A 1.: …", "A 2.: …".

export function chartToText(chart, { shift = 0, sharps = false } = {}) {
  // Plain text, as typed: "Bbm7b5", not "B♭ø7".
  const ascii = (pc) => noteName(pc + shift, sharps).replace('♭', 'b').replace('♯', '#');
  const name = (c) => `${ascii(c.root)}${c.q}${c.bass != null ? `/${ascii(c.bass)}` : ''}`;
  const bar = (b) => (b.chords.length ? b.chords.map(name).join(' ') : '%');
  const lines = [];
  for (const s of chart.sections) {
    lines.push(`${s.label || '-'}: ${s.bars.map(bar).join(' | ')}`);
    s.endings.forEach((e, i) => lines.push(`${s.label || '-'} ${i + 1}.: ${e.map(bar).join(' | ')}`));
  }
  return lines.join('\n');
}

// Back from text; `shift` is undone so the chart is stored in its own key. Returns
// { chart } or { error }.
export function chartFromText(text, { key = null, meter = '4/4', shift = 0 } = {}) {
  const sections = [];
  const lines = String(text).split('\n').map((l) => l.trim()).filter(Boolean);
  for (const [i, line] of lines.entries()) {
    const m = /^([^:]*?)(?:\s+(\d+)\.)?\s*:\s*(.*)$/.exec(line);
    const label = m ? m[1].trim().replace(/^-$/, '') : '';
    const body = m ? m[3] : line;
    const bars = [];
    for (const raw of body.split('|')) {
      const t = raw.trim();
      if (!t && bars.length === 0 && body.trim().startsWith('|')) continue;
      if (!t || t === '%') { bars.push({ chords: [], alts: [] }); continue; }
      const chords = [];
      for (const word of t.split(/\s+/)) {
        const c = parseChord(word);
        if (!c) return { error: `Line ${i + 1}: “${word}” isn’t a chord I can read.` };
        chords.push({ ...c, root: (c.root - shift + 120) % 12, ...(c.bass != null ? { bass: (c.bass - shift + 120) % 12 } : {}) });
      }
      bars.push({ chords, alts: [] });
    }
    while (bars.length && !bars.at(-1).chords.length && body.trim().endsWith('|')) bars.pop();
    if (m?.[2] && sections.length) sections.at(-1).endings.push(bars);
    else sections.push({ label, repeats: 0, bars, endings: [] });
  }
  if (!sections.length) return { error: 'Type at least one line of chords.' };
  return { chart: { key, meter, sections } };
}

// ---------- What's in a chart ----------

// The family a quality belongs to, as one of the chord types in theory.js, and whether a
// dominant is altered (for choosing a scale).
export function chordFamily(q) {
  if (/^m7b5|^h/.test(q)) return 'm7b5';
  if (/^0|^o|^dim/.test(q)) return 'dim7';
  if (/^m\(?\/?maj/.test(q)) return 'mMaj7';
  if (/^m(6|69|b6)?$/.test(q)) return 'm6';
  if (/^m(?!aj)/.test(q)) return 'm7'; // (maj7 starts with m too)
  if (/^maj7#5|^\+maj|^augmaj/.test(q)) return 'maj7s5';
  if (/^(maj|add9)/.test(q)) return 'maj7';
  if (/^(6|69)?$/.test(q)) return 'maj6';
  if (/sus/.test(q)) return 'dom7sus';
  if (/^(aug|\+)$|^7#5$|^9#5$/.test(q)) return 'dom7s5';
  // Colours: ♭9 (dominants in minor keys), ♯9 and altered.
  if (/#9|alt/.test(q)) return 'dom7s9';
  if (/b9/.test(q)) return 'dom7b9';
  return 'dom7';
}

// The kind of chord, for matching an exercise to a tune's chords: a dominant lick fits 7, 7♭9,
// 7♯9 or 7♯5; a minor one m7 or m6; a major one maj7 or 6.
const KIND = { maj7: 'maj', maj6: 'maj', maj7s5: 'maj', m7: 'min', m6: 'min', mMaj7: 'min', dom7: 'dom', dom7b9: 'dom', dom7s9: 'dom', dom7s5: 'dom', dom7sus: 'sus', m7b5: 'half', dim7: 'dim' };
export const chordKind = (family) => KIND[family] || family;

// Chord symbols in ABC notation ("Dm7" over a note), in order: [{ root, q, family }].
// (at: where it is in the notation.) Quotes that aren't chords (like "^swing") are skipped.
export function chordsInAbc(abc) {
  return [...String(abc || '').matchAll(/"([^"]+)"/g)]
    .map((m) => ({ c: parseChord(m[1]), at: m.index }))
    .filter((x) => x.c)
    .map(({ c, at }) => ({ root: c.root, q: c.q, family: chordFamily(c.q), at }));
}

// A chord repeated in a row (Dm7 then Dm9 is the same m7 chord) counts once.
export const chordChanges = (list) => list.filter((c, i) => i === 0 || c.root !== list[i - 1].root || c.family !== list[i - 1].family);

// A lick's first n chords: its notation up to its (n+1)th chord change, cut at the bar line before
// it. (For playing part of a lick over part of a progression; counted as warmups.js's harmonyOf.)
export function abcFirstChords(abc, n) {
  const next = chordChanges(chordsInAbc(abc))[n];
  if (!next) return abc;
  const before = abc.slice(0, next.at);
  const bar = before.lastIndexOf('|');
  return (bar >= 0 ? before.slice(0, bar + 1) : before).trim();
}

// Chords typed as text ("Dm7 G7 Cmaj7", spaces, commas or bars between): the list, or null if
// one of them can't be read.
export function chordsFromText(text) {
  const parts = String(text || '').split(/[\s,|]+/).filter(Boolean);
  const list = parts.map(parseChord);
  if (list.some((c) => !c)) return null;
  return list.map((c) => ({ root: c.root, q: c.q, family: chordFamily(c.q) }));
}

export const isDominant = (family) => ['dom7', 'dom7b9', 'dom7s9'].includes(family);

// A scale that goes with a chord (one of theory.js's scale types).
export function scaleFor(c) {
  const f = chordFamily(c.q);
  if (f.startsWith('dom7') && !['dom7sus', 'dom7s5'].includes(f)) {
    if (/alt|#9|#5|b13/.test(c.q)) return 'altered';
    if (/b9/.test(c.q)) return 'dimHW';
    if (/#11|b5/.test(c.q)) return 'lydianDom';
    return 'mixolydian';
  }
  return {
    maj7: /#11/.test(c.q) ? 'lydian' : 'major', maj6: 'major', maj7s5: 'lydian', m7: 'dorian', m6: 'melodic',
    mMaj7: 'melodic', m7b5: 'locrian', dim7: 'dimWH', dom7sus: 'mixolydian', dom7s5: 'wholeTone',
  }[f];
}

// The chords in playing order, with how long each lasts (in beats): sections in order, each
// section's endings after it. Alternate chords are left out.
export function chordTimeline(chart) {
  const beats = Number(String(chart.meter || '4/4').split('/')[0]) || 4;
  const out = [];
  const addBars = (bars) => {
    for (const b of bars) {
      if (!b.chords.length) { if (out.length) out.at(-1).beats += beats; continue; }
      for (const c of b.chords) out.push({ ...c, beats: beats / b.chords.length });
    }
  };
  for (const s of chart.sections) {
    addBars(s.bars);
    for (const e of s.endings) addBars(e);
  }
  return out;
}

// The chords that take up the most time, distinct by root and family, most first.
export function mainChords(chart, limit = 4) {
  const totals = new Map();
  for (const c of chordTimeline(chart)) {
    const id = `${c.root}:${chordFamily(c.q)}`;
    const t = totals.get(id) || { root: c.root, family: chordFamily(c.q), q: c.q, beats: 0 };
    t.beats += c.beats;
    totals.set(id, t);
  }
  return [...totals.values()].sort((a, b) => b.beats - a.beats).slice(0, limit);
}

// ii–V(–I)s: a minor 7th (or m7♭5) followed by a dominant a 4th up. Returns the key each one
// leads to (the I's root), whether it's minor, and how often it comes up, most first.
export function twoFives(chart) {
  const seq = chordTimeline(chart);
  const found = new Map();
  for (let i = 0; i + 1 < seq.length; i++) {
    const a = seq[i], b = seq[i + 1];
    const fa = chordFamily(a.q), fb = chordFamily(b.q);
    if (!['m7', 'm7b5'].includes(fa) || !isDominant(fb) || (b.root - a.root + 12) % 12 !== 5) continue;
    const target = (b.root + 5) % 12;
    const next = seq[i + 2];
    const minor = fa === 'm7b5' || (next && next.root === target && ['m6', 'm7', 'mMaj7'].includes(chordFamily(next.q)));
    const id = `${target}:${minor}`;
    const f = found.get(id) || { target, minor, count: 0 };
    f.count++;
    found.set(id, f);
  }
  return [...found.values()].sort((a, b) => b.count - a.count);
}

// ---------- Progressions ----------

const ROMAN = ['I', '♭II', 'II', '♭III', 'III', 'IV', '♯IV', 'V', '♭VI', 'VI', '♭VII', 'VII'];
const MINORISH = ['m7', 'm6', 'm7b5', 'mMaj7', 'dim7'];

// A chord's Roman numeral against a key centre: ii, V7, iiø, vii°, I, i.
export function roman(degree, family) {
  const base = ROMAN[((degree % 12) + 12) % 12];
  const numeral = MINORISH.includes(family) ? base.toLowerCase() : base;
  if (family === 'm7b5') return `${numeral}ø`;
  if (family === 'dim7') return `${numeral}°`;
  if (isDominant(family) || family === 'dom7sus' || family === 'dom7s5') return `${numeral}7`;
  return numeral;
}

// The chords in order with repeats merged (a chord held over two bars counts once).
function changes(chart) {
  const out = [];
  for (const c of chordTimeline(chart)) {
    const f = chordFamily(c.q);
    const last = out.at(-1);
    if (last && last.root === c.root && last.family === f) last.beats += c.beats;
    else out.push({ root: c.root, q: c.q, family: f, beats: c.beats });
  }
  return out;
}

// Progressions in a chart, most important first (by length × how often they come up):
//   - chains moving round the cycle of 4ths: ii–V, VI–ii–V, iii–VI–ii–V… (with the I they
//     resolve to, if they do);
//   - the I–vi–ii–V turnaround;
//   - ii–♭II7–I (a tritone substitute for the V).
// Each: { name ('iii–vi–ii–V7'), target (the I's root, concert), minor, chords: [{ d (semitones
// above the target), family, q }], count }.
export function progressions(chart) {
  const seq = changes(chart);
  const found = new Map();
  const add = (chords, target, minor) => {
    const named = chords.map((c) => ({ d: (c.root - target + 12) % 12, family: c.family, q: c.q }));
    const name = named.map((c) => roman(c.d, c.family)).join('–');
    const id = `${name}@${target}`;
    const f = found.get(id) || { name, target, minor, chords: named, count: 0 };
    f.count++;
    found.set(id, f);
  };
  const chainable = (f) => ['m7', 'm7b5'].includes(f) || isDominant(f);
  // Cycle-of-4ths chains.
  for (let i = 0; i < seq.length; i++) {
    if (!chainable(seq[i].family) || (i > 0 && chainable(seq[i - 1].family) && (seq[i].root - seq[i - 1].root + 12) % 12 === 5)) continue;
    let j = i;
    while (j + 1 < seq.length && chainable(seq[j + 1].family) && (seq[j + 1].root - seq[j].root + 12) % 12 === 5) j++;
    if (j === i) continue;
    // A chain should end on a dominant (…ii–V) to be a progression into a key.
    while (j > i && !isDominant(seq[j].family)) j--;
    if (j === i) continue;
    const target = (seq[j].root + 5) % 12;
    const next = seq[j + 1];
    const resolves = next && next.root === target && !chainable(next.family);
    const chain = seq.slice(i, j + 1).concat(resolves ? [next] : []);
    const minor = seq[j - 1]?.family === 'm7b5' || (resolves && MINORISH.includes(next.family));
    // Long chains also count their ii–V(–I) on its own, so it's found across tunes.
    add(chain, target, minor);
    if (j - i >= 2) add(seq.slice(j - 1, j + 1).concat(resolves ? [next] : []), target, minor);
  }
  for (let i = 0; i + 3 < seq.length; i++) {
    const [a, b, c, d] = seq.slice(i, i + 4);
    const rel = (x) => (x.root - a.root + 12) % 12;
    if (['maj7', 'maj6', 'm6', 'm7', 'mMaj7'].includes(a.family) && rel(b) === 9 && rel(c) === 2 && rel(d) === 7
      && (MINORISH.includes(c.family)) && isDominant(d.family)) add([a, b, c, d], a.root, MINORISH.includes(a.family));
  }
  for (let i = 0; i + 2 < seq.length; i++) {
    const [a, b, c] = seq.slice(i, i + 3);
    if (MINORISH.includes(a.family) && isDominant(b.family) && (a.root - c.root + 12) % 12 === 2 && (b.root - c.root + 12) % 12 === 1) {
      add([a, b, c], c.root, MINORISH.includes(c.family));
    }
  }
  // How much of the tune it accounts for: length times how often, longer first on a tie.
  return [...found.values()].sort((x, y) => y.chords.length * y.count - x.chords.length * x.count || y.chords.length - x.chords.length);
}
