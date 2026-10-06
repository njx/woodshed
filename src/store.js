import { SEED_TUNES } from './data/tunes.js';
import { SEED_EXERCISES } from './data/exercises.js';
import { DEFAULT_SETTINGS } from './constants.js';
import { parseKey } from './keys.js';
import { uid } from './util.js';
import { kvGet, kvSet } from './db.js';

// The whole app state lives in memory in store.state and is written to IndexedDB after changes.
//
// Schema (version 3):
//   items:    practice items, all with { id, type, name, priority 1–4, level null|0–3, notes,
//             focus, ivl, due, levelSetAt }, plus by type:
//             tune:     { seedName?, style, keys [concert key, 0–23], mine, recordings? }
//             exercise: { category, keyMode, keysPerSession, keys [roots 0–11, for 'fixed'],
//                         abc (notation written in C), meter }
//   log:      { id, date, itemId, at, key, keys?, alt, shift, rating, prev: { ivl, due } }
//             (exercises log every key practiced in keys)
//   plan:     today's set { date, items: [{ itemId, bucket, key, keys?, alt, shift }], skipped,
//             focusSkipped }
//   diary:    practice notes { id, date, at, text, flag, done, itemId?, media? } (see diary.js,
//             media.js; recorded clips themselves live in IndexedDB's media store)
//   settings: see DEFAULT_SETTINGS
export const SCHEMA_VERSION = 3;
const STATE_KEY = 'state';
const LEGACY_KEY = 'woodshed.v1'; // version 1 lived in localStorage

export const store = { state: null };

export function seedExercises() {
  return SEED_EXERCISES.map((x) => ({
    id: uid(),
    type: 'exercise',
    name: x.name,
    category: x.category,
    keyMode: x.keyMode,
    keysPerSession: x.keysPerSession,
    keys: [],
    abc: x.abc,
    meter: '4/4',
    notes: x.notes,
    priority: 3,
    level: null,
    ivl: null,
    due: null,
  }));
}

export function seedState() {
  return {
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
      ivl: null,
      due: null,
    })), ...seedExercises()],
    log: [],
    diary: [],
    plan: null,
    settings: { ...DEFAULT_SETTINGS },
  };
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
    s.version = 3;
  }
  return normalize(s);
}

export function normalize(s) {
  s.items ||= [];
  s.log ||= [];
  s.diary ||= [];
  s.plan ??= null;
  s.settings = { ...DEFAULT_SETTINGS, ...s.settings };
  if (!s.settings.instruments?.length) s.settings.instruments = ['c'];
  if (!s.settings.instruments.includes(s.settings.view)) s.settings.view = s.settings.instruments[0];
  for (const t of s.items) {
    t.type ||= 'tune';
    if (!Array.isArray(t.keys)) t.keys = [];
    if (t.type === 'exercise') {
      t.keyMode ||= 'weak';
      t.keysPerSession ||= 1;
      t.abc ??= '';
      t.meter ||= '4/4';
      t.category ||= 'other';
    }
  }
  return s;
}

export async function loadState() {
  let s = await kvGet(STATE_KEY);
  if (!s) {
    // First run on this version: pick up data saved by version 1, if any.
    try {
      const legacy = globalThis.localStorage?.getItem(LEGACY_KEY);
      if (legacy) s = JSON.parse(legacy);
    } catch (e) {
      console.warn('Could not read old data', e);
    }
  }
  store.state = s ? migrate(s) : seedState();
  await kvSet(STATE_KEY, store.state);
  return store.state;
}

let saveTimer = null;
let onSaveError = () => {};
export function setSaveErrorHandler(fn) {
  onSaveError = fn;
}

// Debounced: many small edits (typing notes) become one write.
export function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, 250);
}

export async function flush() {
  clearTimeout(saveTimer);
  saveTimer = null;
  try {
    await kvSet(STATE_KEY, store.state);
  } catch (e) {
    onSaveError(e);
  }
}
