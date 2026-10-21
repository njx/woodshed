import { SEED_TUNES } from './data/tunes.js';
import { SEED_EXERCISES } from './data/exercises.js';
import { DEFAULT_SETTINGS } from './constants.js';
import { parseKey } from './keys.js';
import { uid } from './util.js';
import { sanitizeState } from './validate.js';
import { seedChart, loadSeedCharts } from './charts.js';
import { kvGet, kvSet, kvFallback } from './db.js';
import type { State, Exercise, Tune } from './types.js';

// The whole app state lives in memory in store.state and is written to IndexedDB after changes.
//
// Schema (version 10):
//   items:    practice items, all with { id, type, name, priority 1–4, level null|0–3, notes,
//             focus, ivl, due, levelSetAt }, plus by type:
//             tune:     { seedName?, style, keys [concert key, 0–23], mine, recordings?, chart?,
//                         chartEdited? } (chart: chord chart, see chords.js and charts.js)
//             exercise: { category, keyMode, keysPerSession, keys [roots 0–11, for 'fixed'],
//                         abc (notation, written in `home` — C if unset), meter,
//                         vary: null | { kind 'scale'|'chord', types [ids], shape, pattern },
//                         fromTune? (its chords come from a tune: only a warm-up) }
//             all items may have tempo (working BPM), goalTempo, tempoSetAt (see tempo.js)
//   log:      { id, date, itemId, pid? (the plan item it was played from), at, key, keys?, types?, alt, shift, rating, bpm?, prev: { ivl, due } }
//             (exercises log every key practiced in keys; bpm is the tempo it was played at)
//   plan:     today's set { date, items: [{ pid, itemId, bucket, key, keys?, types?, alt, shift,
//             warmup?, prog?, mix? }] (mix: its random place among the day's tunes; pid: the plan item's own id, as an exercise can be in a set more
//             than once; warmup: the tune it's before; prog: a progression for a fromTune
//             exercise, see warmups.js; over/overKey/parts: what a written one is played over,
//             see warmups.js; slot), mode (the exercise setting it was made with), dayKeys?,
//             skipped, focusSkipped }
//   diary:    practice notes { id, date, at, text, flag, done, itemId?, media? } (see diary.js,
//             media.js; recorded clips themselves live in IndexedDB's media store)
//   sessions: practice time [{ id, date, start, end (ms), away? }]; timing: id of the running one
//             or null (see practicetime.js); greetedOn: the day the welcome was last shown
//   settings: see DEFAULT_SETTINGS
export const SCHEMA_VERSION = 13;
const STATE_KEY = 'state';
const COPIES_KEY = 'copies';
const MAX_COPIES = 3;
const LEGACY_KEY = 'woodshed.v1'; // version 1 lived in localStorage

// rev counts saves: an undo only applies if nothing has changed since it was offered.
// (state is null only while it loads, before anything reads it.)
export const store: { state: State; rev: number } = { state: null as unknown as State, rev: 0 };

// Saved or imported data, before migrate() and validate.ts have made it a State.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Raw = any;

// Starter exercises; `since` limits them to ones added after a given data version.
export function seedExercises(since = 0): Exercise[] {
  return SEED_EXERCISES.filter((x) => (x.since || 3) > since).map((x) => ({
    id: uid(),
    type: 'exercise',
    name: x.name,
    category: x.category,
    keyMode: x.keyMode,
    keysPerSession: x.keysPerSession,
    keys: [],
    abc: x.abc,
    vary: x.vary ? { ...x.vary, types: [...x.vary.types] } : null,
    ...(x.fromTune ? { fromTune: true } : {}),
    ...(x.solo ? { solo: true } : {}),
    meter: '4/4',
    notes: x.notes,
    priority: 3,
    level: 0,
    focus: false,
    ivl: null,
    due: null,
  } as Exercise));
}

export function seedState(): State {
  return normalize({
    version: SCHEMA_VERSION,
    items: [...SEED_TUNES.map((t) => ({
      id: uid(),
      type: 'tune',
      name: t.name,
      seedName: t.name,
      style: t.style,
      priority: t.priority,
      level: t.level ?? 0,
      keys: (t.keys || []).map(parseKey).filter((k) => k != null),
      notes: t.notes || '',
      mine: !!t.mine,
      chart: seedChart({ name: t.name }),
      focus: false,
      ivl: null,
      due: null,
    } as Tune)), ...seedExercises()],
    log: [],
    diary: [],
    plan: null,
    settings: { ...DEFAULT_SETTINGS },
  });
}

// Bring any saved or imported state up to the current schema.
export function migrate(s: Raw): State {
  if (!s.version || s.version < 2) {
    // v1: tunes / tuneId → items / itemId, every item a tune.
    s.items = (s.tunes || s.items || []).map((t: Raw) => ({ type: 'tune', seedName: t.name, ...t }));
    delete s.tunes;
    for (const e of s.log || []) {
      if (e.tuneId) { e.itemId = e.tuneId; delete e.tuneId; }
    }
    if (s.plan) {
      for (const it of s.plan.items || []) {
        if (it.tuneId) { it.itemId = it.tuneId; delete it.tuneId; }
      }
    }
    s.version = 2;
  }
  if (s.version < 3) {
    // v3: exercises arrive, starting with a starter set.
    s.items = [...(s.items || []), ...seedExercises()];
    s.version = 4;
  }
  if (s.version < 4) {
    // v4: exercises that vary the scale or chord type; add the new starters.
    const names = new Set((s.items || []).map((t: Raw) => t.name));
    s.items = [...(s.items || []), ...seedExercises(3).filter((x) => !names.has(x.name))];
    s.version = 4;
  }
  if (s.version < 5) {
    // v5: tunes get chord charts (for the starting tunes; see charts.js).
    for (const t of s.items || []) {
      if ((t.type || 'tune') === 'tune' && !t.chart?.sections?.length) t.chart = seedChart(t);
    }
    s.version = 5;
  }
  if (s.version < 6) {
    // v6: an exercise that arpeggiates a tune's progressions, for warm-ups.
    const names = new Set((s.items || []).map((t: Raw) => t.name));
    s.items = [...(s.items || []), ...seedExercises(5).filter((x) => !names.has(x.name))];
    s.version = 6;
  }
  if (s.version < 7) {
    // v7: "From tunes" (warm-ups before each tune) becomes the default way exercises fit a day.
    if (s.settings && (s.settings.exerciseFocus ?? 'own') === 'own') s.settings.exerciseFocus = 'tunes';
    s.version = 7;
  }
  if (s.version < 8) {
    // v8: one hone tune a day by default (was two).
    if (s.settings?.hone === 2) s.settings.hone = 1;
    s.version = 8;
  }
  if (s.version < 9) {
    // v9: the starter exercises' notation gets chord symbols (unless it's been edited since).
    const withChords = new Map([
      ["C D E F G A B c | B A G F E D C2 |", "\"Cmaj7\"C D E F G A B c | B A G F E D C2 |"],
      ["C D _E F G A _B c | _B A G F _E D C2 |", "\"Cm7\"C D _E F G A _B c | _B A G F _E D C2 |"],
      ["C D E F G A _B c | _B A G F E D C2 |", "\"C7\"C D E F G A _B c | _B A G F E D C2 |"],
      ["c B _B A G F E D | C8 |", "\"C7\"c B _B A G F E D | C8 |"],
      ["C E G B c B G E | C8 |", "\"Cmaj7\"C E G B c B G E | C8 |"],
      ["C E G _B c _B G E | C8 |", "\"C7\"C E G _B c _B G E | C8 |"],
      ["C _E G _B c _B G _E | C8 |", "\"Cm7\"C _E G _B c _B G _E | C8 |"],
      ["D E F A G A B d | c8 |", "\"Dm7\"D E F A \"G7\"G A B d | \"Cmaj7\"c8 |"],
    ]);
    for (const t of s.items || []) if (t.type === 'exercise' && withChords.has(t.abc)) t.abc = withChords.get(t.abc);
    s.version = 9;
  }
  if (s.version < 10) {
    // v10: warm-ups are added by hand (+ Warm-up on a tune), not before every tune: today's
    // set is made again without them (see ensurePlan), keeping any already played.
    const played = new Set((s.log || []).map((e: Raw) => e.pid).filter(Boolean));
    if (s.plan) s.plan.items = (s.plan.items || []).filter((it: Raw) => !it.warmup || played.has(it.pid));
    s.version = 10;
  }
  if (s.version < 11) {
    // v11: exercises can be kept out of tunes (technical ones): the starting ones that are.
    for (const t of s.items || []) if (t.type === 'exercise' && ['Long tones', 'Chromatic scale'].includes(t.name)) t.solo = true;
    s.version = 11;
  }
  if (s.version < 12) {
    // v12: minor-major chords (Cm/maj7) and 6/9s were missing from the starting charts: a tune's
    // chart that hasn't been edited is the starting one again, with them in.
    for (const t of s.items || []) {
      if ((t.type || 'tune') === 'tune' && t.chart && !t.chartEdited) t.chart = seedChart(t) ?? t.chart;
    }
    s.version = 12;
  }
  if (s.version < 13) {
    // v13: so many hone, learn and new tunes a day becomes a number of tunes, focus ones included
    // (picked by priority, mixing the groups): those numbers' total.
    const st = s.settings;
    if (st && ['hone', 'learn', 'fresh'].some((k) => st[k] != null)) st.tunes = Math.min(8, (st.hone ?? 1) + (st.learn ?? 2) + (st.fresh ?? 1)) || 1;
    if (st) for (const k of ['hone', 'learn', 'fresh']) delete st[k];
    s.version = 13;
  }
  return normalize(s);
}

export function normalize(s: Raw): State {
  return sanitizeState(s);
}

export async function loadState() {
  let s: Raw = await kvGet(STATE_KEY); // throws if storage can't be read: never seed over real data
  // A save that failed in IndexedDB left a newer copy in localStorage.
  const spill = kvFallback(STATE_KEY);
  if (spill && spill !== s && (!s || (spill.savedAt || 0) > (s.savedAt || 0))) s = spill;
  if (!s) {
    // First run on this version: pick up data saved by version 1, if any.
    try {
      const legacy = globalThis.localStorage?.getItem(LEGACY_KEY);
      if (legacy) s = JSON.parse(legacy);
    } catch (e) {
      console.warn('Could not read old data', e);
    }
  }
  // Starting charts are only loaded when tunes need them (first run, or data from before charts).
  if (!s || (s.version || 1) < SCHEMA_VERSION) await loadSeedCharts();
  // An upgrade rewrites the data: a copy as it was first (see keepCopy).
  if (s && (s.version || 1) < SCHEMA_VERSION) await keepCopy('Before an update', s).catch(() => {});
  store.state = s ? migrate(s) : seedState();
  await flush();
  return store.state;
}

// ---------- Earlier copies ----------
// Before something rewrites or replaces the data wholesale (an update that upgrades it, restoring a
// backup, a reset, putting back an earlier copy), a copy of it as it was: the last few, newest
// first, which Settings can put back. (Kept on this device, next to the data.)

export interface Copy { at: number; reason: string; state: Raw }
export interface CopyInfo { at: number; reason: string; items: number; log: number }

export async function keepCopy(reason: string, state: Raw = store.state): Promise<void> {
  if (!state) return;
  const copies: Copy[] = (await kvGet(COPIES_KEY).catch(() => null)) || [];
  copies.unshift({ at: Date.now(), reason, state: JSON.parse(JSON.stringify(state)) });
  await kvSet(COPIES_KEY, copies.slice(0, MAX_COPIES), { spill: false });
}
export async function listCopies(): Promise<CopyInfo[]> {
  const copies: Copy[] = (await kvGet(COPIES_KEY).catch(() => null)) || [];
  return copies.map((c) => ({ at: c.at, reason: c.reason, items: (c.state?.items || c.state?.tunes || []).length, log: (c.state?.log || []).length }));
}
// Puts back the copy kept at `at` (keeping one of the data as it is now first). Needs the
// starting charts loaded, for an old copy (see migrate). False if there's no such copy.
export async function restoreCopy(at: number): Promise<boolean> {
  const copies: Copy[] = (await kvGet(COPIES_KEY).catch(() => null)) || [];
  const c = copies.find((x) => x.at === at);
  if (!c) return false;
  if ((c.state?.version || 1) > SCHEMA_VERSION) throw new Error('newer');
  await keepCopy('Before putting back an earlier copy').catch(() => {}); // (storage full: put back anyway)
  store.state = migrate(structuredClone(c.state));
  save();
  return true;
}

let saveTimer: ReturnType<typeof setTimeout> | undefined;
let onSaveError: (e: unknown) => void = () => {};
export function setSaveErrorHandler(fn: (e: unknown) => void) {
  onSaveError = fn;
}

// Debounced: many small edits (typing notes) become one write.
export function save() {
  store.rev++;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, 250);
}

// Whether it was saved (if not, the error handler has said so).
export async function flush(): Promise<boolean> {
  clearTimeout(saveTimer);
  saveTimer = undefined;
  if (!store.state) return true; // still loading: nothing to save, and never write over saved data
  store.state.savedAt = Date.now();
  try {
    await kvSet(STATE_KEY, store.state);
    return true;
  } catch (e) {
    onSaveError(e);
    return false;
  }
}
