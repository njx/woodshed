import { SEED_TUNES } from './data/tunes.js';
import { SEED_EXERCISES } from './data/exercises.js';
import { DEFAULT_SETTINGS } from './constants.js';
import { parseKey } from './keys.js';
import { uid } from './util.js';
import { sanitizeState } from './validate.js';
import { seedChart, loadSeedCharts } from './charts.js';
import { kvGet, kvSet, kvFallback } from './db.js';

// The whole app state lives in memory in store.state and is written to IndexedDB after changes.
//
// Schema (version 8):
//   items:    practice items, all with { id, type, name, priority 1–4, level null|0–3, notes,
//             focus, ivl, due, levelSetAt }, plus by type:
//             tune:     { seedName?, style, keys [concert key, 0–23], mine, recordings?, chart?,
//                         chartEdited? } (chart: chord chart, see chords.js and charts.js)
//             exercise: { category, keyMode, keysPerSession, keys [roots 0–11, for 'fixed'],
//                         abc (notation written in C), meter,
//                         vary: null | { kind 'scale'|'chord', types [ids], shape, pattern },
//                         fromTune? (its chords come from a tune: only a warm-up) }
//             all items may have tempo (working BPM), goalTempo, tempoSetAt (see tempo.js)
//   log:      { id, date, itemId, pid? (the plan item it was played from), at, key, keys?, types?, alt, shift, rating, bpm?, prev: { ivl, due } }
//             (exercises log every key practiced in keys; bpm is the tempo it was played at)
//   plan:     today's set { date, items: [{ pid, itemId, bucket, key, keys?, types?, alt, shift,
//             warmup?, prog?, mix? }] (mix: its random place among the day's tunes; pid: the plan item's own id, as an exercise can be in a set more
//             than once; warmup: the tune it's before; prog: a progression for a fromTune
//             exercise, see warmups.js), mode (the exercise setting it was made with), prepped
//             (tunes given warm-ups), dayKeys?, skipped, focusSkipped }
//   diary:    practice notes { id, date, at, text, flag, done, itemId?, media? } (see diary.js,
//             media.js; recorded clips themselves live in IndexedDB's media store)
//   sessions: practice time [{ id, date, start, end (ms), away? }]; timing: id of the running one
//             or null (see practicetime.js); greetedOn: the day the welcome was last shown
//   settings: see DEFAULT_SETTINGS
export const SCHEMA_VERSION = 8;
const STATE_KEY = 'state';
const LEGACY_KEY = 'woodshed.v1'; // version 1 lived in localStorage

// rev counts saves: an undo only applies if nothing has changed since it was offered.
export const store = { state: null, rev: 0 };

// Starter exercises; `since` limits them to ones added after a given data version.
export function seedExercises(since = 0) {
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
    meter: '4/4',
    notes: x.notes,
    priority: 3,
    level: null,
    ivl: null,
    due: null,
  }));
}

export function seedState() {
  return normalize({
    version: SCHEMA_VERSION,
    items: [...SEED_TUNES.map((t) => ({
      id: uid(),
      type: 'tune',
      name: t.name,
      seedName: t.name,
      style: t.style,
      priority: t.priority,
      level: t.level ?? null,
      keys: (t.keys || []).map(parseKey).filter((k) => k != null),
      notes: t.notes || '',
      mine: !!t.mine,
      chart: seedChart({ name: t.name }),
      ivl: null,
      due: null,
    })), ...seedExercises()],
    log: [],
    diary: [],
    plan: null,
    settings: { ...DEFAULT_SETTINGS },
  });
}

// Bring any saved or imported state up to the current schema.
export function migrate(s) {
  if (!s.version || s.version < 2) {
    // v1: tunes / tuneId → items / itemId, every item a tune.
    s.items = (s.tunes || s.items || []).map((t) => ({ type: 'tune', seedName: t.name, ...t }));
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
    const names = new Set((s.items || []).map((t) => t.name));
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
    const names = new Set((s.items || []).map((t) => t.name));
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
  return normalize(s);
}

export function normalize(s) {
  return sanitizeState(s);
}

export async function loadState() {
  let s = await kvGet(STATE_KEY); // throws if storage can't be read: never seed over real data
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
  store.state = s ? migrate(s) : seedState();
  await flush();
  return store.state;
}

let saveTimer = null;
let onSaveError = () => {};
export function setSaveErrorHandler(fn) {
  onSaveError = fn;
}

// Debounced: many small edits (typing notes) become one write.
export function save() {
  store.rev++;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, 250);
}

export async function flush() {
  clearTimeout(saveTimer);
  saveTimer = null;
  if (!store.state) return; // still loading: nothing to save, and never write over saved data
  store.state.savedAt = Date.now();
  try {
    await kvSet(STATE_KEY, store.state);
  } catch (e) {
    onSaveError(e);
  }
}
