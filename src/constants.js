export const LEVELS = [
  { v: 0, label: "Don't know" },
  { v: 1, label: 'Familiar' },
  { v: 2, label: 'Proficient' },
  { v: 3, label: 'Mastered' },
];
export const PRIORITIES = [
  { v: 1, label: 'Critical' },
  { v: 2, label: 'High' },
  { v: 3, label: 'Medium' },
  { v: 4, label: 'Low' },
];
export const BUCKETS = {
  focus: { label: 'Focus', fallback: [] },
  exercise: { label: 'Exercise', fallback: [] },
  hone: { label: 'Hone', fallback: ['learn', 'fresh'] },
  learn: { label: 'Learn', fallback: ['fresh', 'hone'] },
  fresh: { label: 'New', fallback: ['learn', 'hone'] },
};
export const BUCKET_ORDER = { focus: 0, exercise: 1, hone: 2, learn: 3, fresh: 4 };
export const PRIORITY_WEIGHTS = {
  off: [1, 1, 1, 1],
  some: [3, 2, 1.4, 1],
  strong: [8, 4, 2, 1],
};

export const SHIFTS = {
  1: 'up a half step', 2: 'up a whole step', 3: 'up a minor 3rd', 4: 'up a major 3rd',
  5: 'up a 4th', 6: 'a tritone away', 7: 'down a 4th', 8: 'down a major 3rd',
  9: 'down a minor 3rd', 10: 'down a whole step', 11: 'down a half step',
};
export const TRANSPOSITIONS = {
  c: { label: 'Concert', offset: 0, hint: 'Piano, guitar, bass, flute, vocals' },
  bb: { label: 'B♭', offset: 2, hint: 'Tenor & soprano sax, trumpet, clarinet' },
  eb: { label: 'E♭', offset: 9, hint: 'Alto & baritone sax' },
  f: { label: 'F', offset: 7, hint: 'French horn' },
};

// Spaced repetition: starting and maximum review interval (days) per familiarity level.
export const BASE_INTERVAL = { 0: 1, 1: 2, 2: 4, 3: 7 };
export const MAX_INTERVAL = { 0: 14, 1: 30, 2: 45, 3: 90 };
export const RATINGS = [
  { v: 'rough', label: 'Rough' },
  { v: 'ok', label: 'OK' },
  { v: 'solid', label: 'Solid' },
];
// Level suggestions: up after this many solid sessions in a row, down after this many rough.
export const SOLID_TO_LEVEL_UP = 3;
export const ROUGH_TO_LEVEL_DOWN = 2;

export const LISTEN_SERVICES = {
  apple: { label: 'Apple Music' },
  spotify: { label: 'Spotify' },
  youtube: { label: 'YouTube' },
};

// Exercises: what kind of thing it is, and how its keys are chosen each session.
export const CATEGORIES = {
  scale: 'Scale',
  arpeggio: 'Arpeggio',
  pattern: 'Pattern',
  lick: 'Lick',
  other: 'Other',
};
export const KEY_MODES = {
  weak: { label: 'Weak keys', hint: 'Keys you’ve practiced least overall and for this exercise' },
  fourths: { label: 'Cycle of 4ths', hint: 'C, F, B♭, E♭… picking up where you left off' },
  chromatic: { label: 'Chromatic', hint: 'C, D♭, D… picking up where you left off' },
  random: { label: 'Random', hint: 'Any keys' },
  fixed: { label: 'Chosen keys', hint: 'Only the keys you pick, least practiced first' },
  none: { label: 'No key', hint: 'For things like long tones or the chromatic scale' },
};
export const CYCLE_OF_FOURTHS = [0, 5, 10, 3, 8, 1, 6, 11, 4, 9, 2, 7];

export const DEFAULT_SETTINGS = {
  exercises: 2,
  hone: 1,
  learn: 2,
  fresh: 1,
  priority: 'some',
  newKeys: 'mastered', // 'mastered' | 'proficient' | 'never'
  instruments: ['c'], // transpositions you play, in toggle order
  view: 'c', // transposition keys are currently shown in
  listen: 'apple', // service recording links open in
  a4: 440, // tuner reference pitch
  sound: 'piano', // notation playback (see sounds.js)
  swing: 'straight', // notation playback feel
  exerciseFocus: 'own', // own | day (see plan.js)
  tuneOrder: 'mixed', // mixed | group: today's tunes in a random order, or hone → learn → new
};
