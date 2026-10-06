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
  hone: { label: 'Hone', fallback: ['learn', 'fresh'] },
  learn: { label: 'Learn', fallback: ['fresh', 'hone'] },
  fresh: { label: 'New', fallback: ['learn', 'hone'] },
};
export const BUCKET_ORDER = { focus: 0, hone: 1, learn: 2, fresh: 3 };
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
export const BASE_INTERVAL = { null: 1, 0: 1, 1: 2, 2: 4, 3: 7 };
export const MAX_INTERVAL = { null: 14, 0: 14, 1: 30, 2: 45, 3: 90 };
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

export const DEFAULT_SETTINGS = {
  hone: 2,
  learn: 2,
  fresh: 1,
  priority: 'some',
  newKeys: 'mastered', // 'mastered' | 'proficient' | 'never'
  instruments: ['c'], // transpositions you play, in toggle order
  view: 'c', // transposition keys are currently shown in
  listen: 'apple', // service recording links open in
};
