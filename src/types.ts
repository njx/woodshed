// The app's data: what store.state holds (see store.ts for the schema's history, validate.ts for
// how saved and imported data is checked before it's used).

import type { BUCKETS, CATEGORIES, KEY_MODES, LISTEN_SERVICES, TRANSPOSITIONS } from './constants.js';
import type { CHORDS, SCALES, SHAPES } from './theory.js';
import type { SOUNDS, SWING } from './sounds.js';

export type Id = string;
/** A calendar day, 'YYYY-MM-DD' (see dates.ts). */
export type DateStr = string;
/** A key: a root pitch class 0–11 (C = 0), +12 for minor (so 0–23). Concert pitch unless said. */
export type Key = number;

export type Bucket = keyof typeof BUCKETS;
export type Category = keyof typeof CATEGORIES;
export type KeyMode = keyof typeof KEY_MODES;
export type Transposition = keyof typeof TRANSPOSITIONS;
export type ListenService = keyof typeof LISTEN_SERVICES;
export type Rating = 'rough' | 'ok' | 'solid';
/** How well you know it: 0 don't know, 1 familiar, 2 proficient, 3 mastered. */
export type Level = 0 | 1 | 2 | 3;
/** 1 critical … 4 low. */
export type Priority = 1 | 2 | 3 | 4;
export type ScaleType = keyof typeof SCALES;
export type ChordType = keyof typeof CHORDS;
export type Shape = keyof typeof SHAPES;
export type SoundId = keyof typeof SOUNDS;
export type SwingId = keyof typeof SWING;

// ---------- Chord charts (see chords.ts) ----------

/** A chord: its root (pitch class, in the chart's own key), quality ('m7', '7b9'…), and a bass note. */
export interface Chord { root: number; q: string; bass?: number }
/** A bar: its chords, and alternative changes shown smaller. */
export interface Bar { chords: Chord[]; alts: Chord[] }
export interface Section { label: string; repeats: number; bars: Bar[]; endings: Bar[][] }
export interface Chart { key: Key | null; meter: string; sections: Section[] }

/** A progression for a warm-up: chords as degrees above its key (see warmups.ts). */
export interface Progression { name: string; chords: { d: number; family: string }[] }

// ---------- Practice items ----------

interface ItemBase {
  id: Id;
  name: string;
  priority: Priority;
  level: Level;
  notes: string;
  /** Always in today's set (they take turns, see plan.ts pickFocus). */
  focus: boolean;
  /** Left out of the daily picks (see plan.ts itemStatus). */
  off?: boolean;
  /** Spaced repetition: days until the next review, and when that is. */
  ivl: number | null;
  due: DateStr | null;
  levelSetAt?: number;
  /** Working tempo and goal (BPM), see tempo.ts. */
  tempo?: number | null;
  goalTempo?: number | null;
  tempoSetAt?: number;
}

export interface Tune extends ItemBase {
  type: 'tune';
  /** Its name in the starting list, if it came from there. */
  seedName?: string;
  style: string;
  /** Its usual keys (concert), the most common first. */
  keys: Key[];
  /** Added by you (not from the starting list). */
  mine: boolean;
  /** Recordings you've added to listen to (see listen.ts). */
  recordings?: Recording[];
  chart?: Chart | null;
  chartEdited?: boolean;
  /** The tempo its warm-ups start at, once one's been set (until then, its own). */
  warmupTempo?: number | null;
}

/** A recording to listen to (search links, see listen.ts): your own or from data/recordings.ts. */
export interface Recording { artist: string; album?: string | null; year?: number | null }

/** An exercise's scale or chord type for each key (see theory.ts). */
export interface Vary {
  kind: 'scale' | 'chord';
  types: string[];
  shape: Shape;
  /** Scale degrees, for a custom shape. */
  pattern: string;
}

export interface Exercise extends ItemBase {
  type: 'exercise';
  category: Category;
  keyMode: KeyMode;
  keysPerSession: number;
  /** Roots 0–11, for keyMode 'fixed'. */
  keys: Key[];
  /** Its notation (ABC), written in `home` (C if unset). */
  abc: string;
  meter: string;
  vary: Vary | null;
  /** Its chords come from a tune: only a warm-up (Through the changes). */
  fromTune?: boolean;
  /** Technical, played on its own: not suggested with tunes. */
  solo?: boolean;
  /** The chords it goes with, typed (otherwise read from its notation). */
  harmony?: string;
  /** The key it's written in (see abc.ts homeKey). */
  home?: Key;
  /** Its notation shown only as written, in C. */
  asWritten?: boolean;
}

export type Item = Tune | Exercise;

// ---------- Today's set ----------

export interface PlanItem {
  /** The plan item's own id: an exercise can be in a set more than once. */
  pid: Id;
  itemId: Id;
  bucket: Bucket;
  /** A tune's key today (concert), or null. */
  key: Key | null;
  /** An exercise's keys today. */
  keys?: Key[] | null;
  /** …and its scale or chord type in each. */
  types?: string[];
  alt: boolean;
  /** Transposed from its usual key by this many half steps (see SHIFTS). */
  shift: number | null;
  /** Its random place among the day's tunes. */
  mix?: number;
  /** The tune it's a warm-up for. */
  warmup?: Id;
  /** A warm-up's own tempo: its tune's warm-up tempo when it was added (see practice.ts playTempo). */
  tempo?: number | null;
  /** A progression, for a fromTune exercise. */
  prog?: Progression | null;
  /** What a written exercise is played over (see warmups.ts), in overKey; parts: which bars. */
  over?: string;
  overKey?: Key;
  parts?: (number | null)[];
  /** Through a tune's whole form. */
  form?: boolean;
  slot?: 'setup' | 'changes';
}

export interface Plan {
  date: DateStr;
  items: PlanItem[];
  /** The exercise setting it was made with. */
  mode: 'own' | 'day' | 'tunes' | null;
  dayKeys?: Key[];
  skipped: Id[];
  focusSkipped: Id[];
  /** Made since sets had exercises (see plan.ts ensurePlan). */
  withExercises?: boolean;
}

// ---------- History ----------

export interface LogEntry {
  id: Id;
  date: DateStr;
  itemId: Id;
  /** The plan item it was played from. */
  pid?: Id;
  at: number;
  key: Key | null;
  /** Every key an exercise was practiced in, and the type in each. */
  keys?: Key[];
  types?: string[];
  progName?: string;
  alt: boolean;
  shift: number | null;
  rating: Rating | null;
  /** The tempo it was played at. */
  bpm?: number | null;
  /** Played as a warm-up for this tune. */
  warmup?: Id;
  /** Where its review stood before this (for undoing a rating). */
  prev: { ivl: number | null; due: DateStr | null };
}

/** An item's totals from the practice log (see practice.ts itemStats). */
export interface ItemStats {
  count: number;
  last: DateStr | null;
  /** Keys played, oldest first. */
  keys: Key[];
  /** Root (0–11) → the last day played in that key. */
  keyLast: Record<number, DateStr>;
  types: string[];
}

/** A recorded clip; the recording itself is in IndexedDB's media store (see media.ts). */
export interface Clip { id: Id; kind: 'audio' | 'video'; mime: string; ms: number; size: number }

export interface DiaryEntry {
  id: Id;
  date: DateStr;
  at: number;
  text: string;
  flag: 'remember' | 'teacher' | null;
  done: boolean;
  /** A take: a recording made from an item, rather than a note. */
  take?: boolean;
  itemId: Id | null;
  media: Clip[];
}

/** A stretch of practice time (see practicetime.ts). */
export interface PracticeSession { id: Id; date: DateStr; start: number; end: number; away?: boolean }

export interface Settings {
  exercises: number;
  /** Tunes a day, focus ones included (see plan.ts fillTunes). */
  tunes: number;
  /** Focus tunes a day, at most (of those). */
  focusTunes: number;
  focusExercises: number;
  priority: string;
  newKeys: 'mastered' | 'proficient' | 'never';
  instruments: Transposition[];
  view: Transposition;
  listen: ListenService;
  a4: number;
  sound: SoundId;
  swing: SwingId;
  exerciseFocus: 'own' | 'day';
  tuneOrder: 'mixed' | 'group';
  instrumentsChosen?: boolean;
  recordKind?: 'audio' | 'video';
  recordMic?: string | null;
  recordMicLabel?: string | null;
  metroBpm?: number;
  metroBeats?: number;
  bassClick?: 'all' | 'twofour' | 'off';
  /** Bars of clicks before the walking bass comes in (0–2; 1 if not set). */
  bassCountIn?: number;
  /** The metronome for a tune with a chart plays a walking bass through it. */
  metroBass?: boolean;
}

export interface State {
  version: number;
  items: Item[];
  log: LogEntry[];
  diary: DiaryEntry[];
  plan: Plan | null;
  settings: Settings;
  sessions: PracticeSession[];
  /** The running practice session's id. */
  timing: Id | null;
  /** The day the welcome was last shown. */
  greetedOn: DateStr | null;
  hintsSeen: string[];
  assistantWishes: { date: DateStr; request: string }[];
  savedAt?: number;
}

// ---------- Browser APIs TypeScript's DOM types lack ----------

declare global {
  /** Safari before 14.1: AudioContext by its prefixed name (undefined elsewhere). */
  var webkitAudioContext: typeof AudioContext | undefined;
  /** Dictation (Web Speech API), Safari's by its prefixed name: undefined where there's none. */
  var SpeechRecognition: { new (): SpeechRecognition } | undefined;
  var webkitSpeechRecognition: { new (): SpeechRecognition } | undefined;
  /** The parts of it the app uses. */
  interface SpeechRecognition extends EventTarget {
    continuous: boolean;
    interimResults: boolean;
    lang: string;
    onresult: ((ev: SpeechRecognitionEvent) => void) | null;
    onerror: ((ev: SpeechRecognitionErrorEvent) => void) | null;
    onend: ((ev: Event) => void) | null;
    onstart: ((ev: Event) => void) | null;
    onaudiostart: ((ev: Event) => void) | null;
    start(): void;
    stop(): void;
    abort(): void;
  }
  interface SpeechRecognitionEvent extends Event { readonly resultIndex: number; readonly results: SpeechRecognitionResultList }
  interface SpeechRecognitionErrorEvent extends Event { readonly error: string }
}
