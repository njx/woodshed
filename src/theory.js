// Scales and chords for exercises that vary from session to session ("C dorian, then F harmonic
// minor…"), and notation generated for them. Everything is spelled as written in C; like any
// exercise notation, it's then shifted into each key (see abc.js).

// Notes spelled in C: [letter, accidental] with accidental −2…2 (♭♭ … ♯♯).
// A lowercase letter is an octave up (a 9th above the root).
const n = (s) => s.split(' ').map((x) => [x.at(-1).toUpperCase(), { __: -2, _: -1, '': 0, '^': 1, '^^': 2 }[x.slice(0, -1)], x.at(-1) === x.at(-1).toLowerCase() ? 1 : 0]);

export const SCALES = {
  major: { label: 'Major', short: 'maj', notes: n('C D E F G A B') },
  dorian: { label: 'Dorian', short: 'dor', notes: n('C D _E F G A _B') },
  aeolian: { label: 'Aeolian (natural minor)', short: 'aeol', notes: n('C D _E F G _A _B') },
  harmonic: { label: 'Harmonic minor', short: 'harm min', notes: n('C D _E F G _A B') },
  melodic: { label: 'Melodic minor', short: 'mel min', notes: n('C D _E F G A B') },
  dimHW: { label: 'Diminished (half–whole)', short: 'dim H/W', notes: n('C _D _E E ^F G A _B') },
  dimWH: { label: 'Diminished (whole–half)', short: 'dim W/H', notes: n('C D _E F _G _A A B') },
  mixolydian: { label: 'Mixolydian', short: 'mixo', notes: n('C D E F G A _B') },
  lydian: { label: 'Lydian', short: 'lyd', notes: n('C D E ^F G A B') },
  lydianDom: { label: 'Lydian dominant', short: 'lyd dom', notes: n('C D E ^F G A _B') },
  altered: { label: 'Altered', short: 'alt', notes: n('C _D _E _F _G _A _B') },
  phrygian: { label: 'Phrygian', short: 'phryg', notes: n('C _D _E F G _A _B') },
  locrian: { label: 'Locrian', short: 'loc', notes: n('C _D _E F _G _A _B') },
  wholeTone: { label: 'Whole tone', short: 'whole tone', notes: n('C D E ^F ^G ^A') },
  majPent: { label: 'Major pentatonic', short: 'maj pent', notes: n('C D E G A') },
  minPent: { label: 'Minor pentatonic', short: 'min pent', notes: n('C _E F G _B') },
  blues: { label: 'Blues', short: 'blues', notes: n('C _E F ^F G _B') },
  bebopDom: { label: 'Bebop dominant', short: 'bebop dom', notes: n('C D E F G A _B B') },
};

// Chord tones 1–3–5–7 (a 6 chord's 6th stands in for the 7th).
export const CHORDS = {
  maj7: { label: 'Major 7', short: 'maj7', notes: n('C E G B') },
  m7: { label: 'Minor 7', short: 'm7', notes: n('C _E G _B') },
  dom7: { label: 'Dominant 7', short: '7', notes: n('C E G _B') },
  m7b5: { label: 'Half-diminished (m7♭5)', short: 'ø7', notes: n('C _E _G _B') },
  dim7: { label: 'Diminished 7', short: '°7', notes: n('C _E _G __B') },
  mMaj7: { label: 'Minor-major 7', short: 'm(maj7)', notes: n('C _E G B') },
  maj6: { label: 'Major 6', short: '6', notes: n('C E G A') },
  m6: { label: 'Minor 6', short: 'm6', notes: n('C _E G A') },
  maj7s5: { label: 'Major 7 ♯5', short: 'maj7♯5', notes: n('C E ^G B') },
  dom7s5: { label: 'Dominant 7 ♯5', short: '7♯5', notes: n('C E ^G _B') },
  dom7sus: { label: 'Dominant 7 sus4', short: '7sus4', notes: n('C F G _B') },
  // With the 9th: the colours of dominants in minor keys and altered dominants.
  dom7b9: { label: 'Dominant 7♭9', short: '7♭9', notes: n('C E G _B _d') },
  dom7s9: { label: 'Dominant 7♯9', short: '7♯9', notes: n('C E G _B ^d') },
};

export const VARY = {
  scale: { label: 'Scale type', types: SCALES, defaults: ['major', 'dorian', 'aeolian', 'harmonic', 'melodic', 'dimHW'] },
  chord: { label: 'Chord type', types: CHORDS, defaults: ['maj7', 'm7', 'dom7', 'm7b5', 'dim7'] },
};

// Shapes of the notation, for any scale or chord (they adapt to how many notes it has).
// Numbers count the notes of the scale or chord: 1 = root; one past the last note is the octave.
export const SHAPES = {
  updown: { label: 'Up and down', kinds: ['scale', 'chord'] },
  updown2: { label: 'Two octaves', kinds: ['scale', 'chord'] },
  thirds: { label: 'In 3rds', kinds: ['scale'] },
  fours: { label: 'Groups of 4', kinds: ['scale'] },
  p1235: { label: '1-2-3-5', kinds: ['scale'] },
  inversions: { label: 'Inversions', kinds: ['chord'] },
  custom: { label: 'Custom', kinds: ['scale', 'chord'] },
};

// Numbers to tap when writing your own pattern.
export const PATTERN_PAD = {
  scale: [...Array(15).keys()].map((i) => i + 1),
  chord: [1, 3, 5, 7, 8, 10, 12, 14, 15],
};

export const typesOf = (kind) => VARY[kind]?.types || {};
export const typeInfo = (kind, id) => typesOf(kind)[id] || null;

// "C dorian", "Cm7": a root name plus a type's short label.
export function variantName(rootName, kind, id) {
  const t = typeInfo(kind, id);
  if (!t) return rootName;
  return kind === 'chord' ? `${rootName}${t.short}` : `${rootName} ${t.short}`;
}

// Note numbers (1-based) for a shape on a scale or chord with `len` notes. `ninth`: the chord's
// last note is a 9th, so "up and down" tops out there rather than on the octave.
export function shapeNumbers(shape, len, kind, custom = '', { ninth = false } = {}) {
  const oct = ninth ? len : len + 1; // the top of one octave's worth
  const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
  const up = (top) => range(1, top);
  const down = (top) => range(1, top - 1).reverse();
  switch (shape) {
    case 'updown2': return [...up(len + oct), ...down(len + oct)];
    case 'thirds': return [...range(1, len).flatMap((i) => [i, i + 2]), oct];
    case 'fours': return [...range(1, len).flatMap((i) => [i, i + 1, i + 2, i + 3]), oct];
    case 'p1235': return [...range(1, len).flatMap((i) => [i, i + 1, i + 2, i + 4]), oct];
    // Root position, then each inversion, up from the next chord tone; end on the top root.
    case 'inversions': return [...range(0, len - 1).flatMap((i) => range(i + 1, i + len)), 2 * len + 1];
    case 'custom': return parsePattern(custom, kind).numbers;
    default: return [...up(oct), ...down(oct)];
  }
}

// A custom pattern: note numbers separated by spaces or dashes. For chords, numbers are chord
// tones 1 3 5 7 (and 8 10 12 14 an octave up); for scales, they count the scale's notes (on a
// 7-note scale 8 is the octave). Chord patterns come back as positions among the 4 chord tones.
export function parsePattern(text, kind) {
  const parts = String(text || '').trim().split(/[\s,–-]+/).filter(Boolean);
  if (!parts.length) return { numbers: [], error: 'Type some note numbers, like 1 2 3 5.' };
  const numbers = [];
  for (const p of parts) {
    const v = Number(p);
    if (!Number.isInteger(v) || v < 1 || v > 22) return { numbers: [], error: `“${p}” isn’t a note number.` };
    if (kind === 'chord') {
      // 1 3 5 7 are the chord tones; 8 10 12 14 the same an octave up (and 15 17… two up).
      const octaves = Math.floor((v - 1) / 7);
      const base = v - 7 * octaves;
      if (base % 2 === 0) return { numbers: [], error: 'Chord patterns use the chord tones 1 3 5 7 (and 8 10 12 14 an octave up).' };
      numbers.push((base + 1) / 2 + 4 * octaves);
    } else numbers.push(v);
  }
  return { numbers };
}

// A pattern as note numbers to show and edit: your own as typed, or a preset as it comes out on a
// 7-note scale or a 4-note chord (written as chord tones 1 3 5 7, 8 10 12 14…).
export function patternText(kind, shape, pattern = '') {
  if (shape === 'custom') return String(pattern || '').trim().split(/[\s,–-]+/).filter(Boolean).join(' ');
  const numbers = shapeNumbers(shape, kind === 'chord' ? 4 : 7, kind);
  if (kind !== 'chord') return numbers.join(' ');
  return numbers.map((v) => [1, 3, 5, 7][(v - 1) % 4] + 7 * Math.floor((v - 1) / 4)).join(' ');
}

// Writes notes ({ letter, acc, octave }) as ABC eighth notes, the last one held to the end of
// its bar (or for `lastUnits`). Accidentals are marked only where they change within a bar, and
// eighths are beamed in groups: fours in 4/4 (two beats), pairs in 3/4, threes in 6/8.
function writeAbc(notes, meter = '4/4') {
  const [num, den] = meter.split('/').map(Number);
  const perBar = Math.max(1, Math.round((num * 8) / den));
  const group = den === 8 ? 3 : num % 2 === 0 ? 4 : 2;
  const ACC = { '-2': '__', '-1': '_', 0: '=', 1: '^', 2: '^^' };
  const name = ({ letter, octave }) => {
    let s = octave >= 5 ? letter.toLowerCase() : letter;
    if (octave > 5) s += "'".repeat(octave - 5);
    if (octave < 4) s += ','.repeat(4 - octave);
    return s;
  };
  const bars = [];
  let bar = '';
  let used = 0;
  let accidentals = {}; // accidentals in force this bar, per written note
  notes.forEach((note, i) => {
    const last = i === notes.length - 1;
    const id = `${note.letter}${note.octave}`;
    const current = accidentals[id] ?? 0;
    const mark = note.acc !== current ? ACC[note.acc] : '';
    accidentals[id] = note.acc;
    const units = last ? perBar - used : 1;
    // A space ends a beam (ABC beams notes written together).
    if (bar && (used % group === 0 || units > 1)) bar += ' ';
    bar += `${mark}${name(note)}${units > 1 ? units : ''}`;
    used += units;
    if (used >= perBar) {
      bars.push(bar);
      bar = '';
      used = 0;
      accidentals = {};
    }
  });
  if (bar) bars.push(bar);
  return `${bars.join(' | ')} |`;
}

// ABC notation (in C, L:1/8, eighth notes) for a shape on a scale or chord type.
export function generateAbc(kind, id, { shape = 'updown', pattern = '', meter = '4/4' } = {}) {
  const t = typeInfo(kind, id);
  if (!t) return '';
  const len = t.notes.length;
  const ninth = t.notes.at(-1)[2] === 1;
  const numbers = shapeNumbers(shape, len, kind, pattern, { ninth });
  if (!numbers.length) return '';
  return writeAbc(numbers.map((v) => {
    const [letter, acc, up] = t.notes[(v - 1) % len];
    return { letter, acc, octave: 4 + up + Math.floor((v - 1) / len) };
  }), meter);
}

// ---------- Progressions ----------

const LETTERS = 'CDEFGAB';
const NATURAL = [0, 2, 4, 5, 7, 9, 11];
// How each degree of a key (semitones above its root) is spelled in C.
const DEGREE_ROOT = [['C', 0], ['D', -1], ['D', 0], ['E', -1], ['E', 0], ['F', 0], ['F', 1], ['G', 0], ['A', -1], ['A', 0], ['B', -1], ['B', 0]];

// A chord type's note (spelled on C) moved onto the root a degree above C, spelled by letter:
// the 3rd of a chord on D is an F-something, whatever its accidental.
export function spellOn([letter, acc, up], degree) {
  const [rootLetter] = DEGREE_ROOT[degree];
  const idx = LETTERS.indexOf(letter) + LETTERS.indexOf(rootLetter);
  const octaves = Math.floor(idx / 7) + up;
  const want = degree + NATURAL[LETTERS.indexOf(letter)] + acc + 12 * up;
  return { letter: LETTERS[idx % 7], acc: want - (NATURAL[idx % 7] + 12 * octaves), octave: 4 + octaves };
}

// Notation (in C) for a progression into C: a bar per chord, arpeggiated up from its root and
// back, then the I. chords: [{ d (semitones above the I), family (a chord type) }]. Roots from G
// up start below middle C, so the line stays in one range.
export function progressionAbc(chords, { meter = '4/4' } = {}) {
  const [num, den] = meter.split('/').map(Number);
  const perBar = Math.max(1, Math.round((num * 8) / den));
  const notes = [];
  for (const { d, family } of chords) {
    const t = CHORDS[family];
    if (!t) continue;
    const len = t.notes.length;
    const top = t.notes.at(-1)[2] === 1 ? len : len + 1;
    const up = Array.from({ length: top }, (_, i) => i + 1);
    const seq = [...up, ...up.slice(1, -1).reverse()];
    const low = d >= 7 ? -1 : 0;
    for (let i = 0; i < perBar; i++) {
      const v = seq[i % seq.length];
      const n = spellOn(t.notes[(v - 1) % len], d);
      notes.push({ ...n, octave: n.octave + low + Math.floor((v - 1) / len) });
    }
  }
  if (!notes.length) return '';
  notes.push({ letter: 'C', acc: 0, octave: 4 });
  return writeAbc(notes, meter);
}

// Which types to practice this session, one per key: the ones played least on this exercise
// come up most, and (with `overall`, counts across all exercises) the ones played least anywhere;
// no repeats within a session until every enabled type has had a turn.
export function chooseTypes(vary, count, history = [], random = Math.random, overall = null) {
  const enabled = (vary?.types || []).filter((id) => typeInfo(vary.kind, id));
  if (!enabled.length || !count) return [];
  const played = {};
  for (const id of history) played[id] = (played[id] || 0) + 1;
  // Overall: relative to the average across the enabled types (a type played half as much as
  // average comes up about twice as often, other things equal).
  const avg = overall ? enabled.reduce((a, id) => a + (overall[id] || 0), 0) / enabled.length : 0;
  const weight = (id) => 1 / Math.pow(1 + (played[id] || 0), 1.5) / (overall && avg ? 0.5 + (overall[id] || 0) / avg : 1);
  const out = [];
  let pool = [];
  for (let i = 0; i < count; i++) {
    if (!pool.length) pool = [...enabled];
    const ws = pool.map((id) => weight(id));
    let r = random() * ws.reduce((a, b) => a + b, 0);
    let j = 0;
    while (j < pool.length - 1 && (r -= ws[j]) > 0) j++;
    const id = pool.splice(j, 1)[0];
    out.push(id);
    played[id] = (played[id] || 0) + 1;
  }
  return out;
}
