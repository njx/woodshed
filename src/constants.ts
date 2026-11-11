import type { Level, Settings } from './types.js';

export const LEVELS = [
  { v: 0, label: "Don't know" },
  { v: 1, label: 'Familiar' },
  { v: 2, label: 'Proficient' },
  { v: 3, label: 'Mastered' },
] as const;
export const PRIORITIES = [
  { v: 1, label: 'Critical' },
  { v: 2, label: 'High' },
  { v: 3, label: 'Medium' },
  { v: 4, label: 'Low' },
] as const;
export const BUCKETS = {
  focus: { label: 'Focus', fallback: [] },
  exercise: { label: 'Exercise', fallback: [] },
  hone: { label: 'Hone', fallback: ['learn', 'fresh'] },
  learn: { label: 'Learn', fallback: ['fresh', 'hone'] },
  fresh: { label: 'New', fallback: ['learn', 'hone'] },
} as const;
export const BUCKET_ORDER = { focus: 0, exercise: 1, hone: 2, learn: 3, fresh: 4 };
export const PRIORITY_WEIGHTS = {
  off: [1, 1, 1, 1],
  some: [3, 2, 1.4, 1],
  strong: [8, 4, 2, 1],
};

export const SHIFTS: Record<number, string> = {
  1: 'up a half step', 2: 'up a whole step', 3: 'up a minor 3rd', 4: 'up a major 3rd',
  5: 'up a 4th', 6: 'a tritone away', 7: 'down a 4th', 8: 'down a major 3rd',
  9: 'down a minor 3rd', 10: 'down a whole step', 11: 'down a half step',
};
// The instruments keys and notes can be shown for: each one's key (as its name says: a B♭
// instrument), offset (how many half steps above concert its keys are written, as a pitch class)
// and written (how far above concert its notes are written, octaves and all: a tenor sax reads a
// 9th above, a soprano a step above). Keys only need the offset; octaves need written.
export const TRANSPOSITIONS = {
  c: { label: 'Concert', key: 'C', offset: 0, written: 0, hint: 'Piano, guitar, bass, flute, trombone, vocals' },
  soprano: { label: 'Soprano sax', key: 'B♭', offset: 2, written: 2, hint: 'B♭' },
  tenor: { label: 'Tenor sax', key: 'B♭', offset: 2, written: 14, hint: 'B♭, an octave below a soprano' },
  trumpet: { label: 'Trumpet', key: 'B♭', offset: 2, written: 2, hint: 'B♭ (and flugelhorn, cornet)' },
  clarinet: { label: 'Clarinet', key: 'B♭', offset: 2, written: 2, hint: 'B♭' },
  alto: { label: 'Alto sax', key: 'E♭', offset: 9, written: 9, hint: 'E♭' },
  bari: { label: 'Baritone sax', key: 'E♭', offset: 9, written: 21, hint: 'E♭, an octave below an alto' },
  horn: { label: 'French horn', key: 'F', offset: 7, written: 7, hint: 'F' },
};
// What earlier versions saved (by key, not instrument): the likeliest instrument for each.
export const LEGACY_INSTRUMENTS: Record<string, keyof typeof TRANSPOSITIONS> = { bb: 'tenor', eb: 'alto', f: 'horn' };

// Spaced repetition: starting and maximum review interval (days) per familiarity level.
export const BASE_INTERVAL: Record<Level, number> = { 0: 1, 1: 2, 2: 4, 3: 7 };
export const MAX_INTERVAL: Record<Level, number> = { 0: 14, 1: 30, 2: 45, 3: 90 };
export const RATINGS = [
  { v: 'rough', label: 'Rough' },
  { v: 'ok', label: 'OK' },
  { v: 'solid', label: 'Solid' },
] as const;
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

export const DEFAULT_SETTINGS: Settings = {
  exercises: 2,
  tunes: 4, // tunes a day: focus ones (up to half, taking turns), the rest by priority, mixing the groups
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
