import { store, save } from '../store.js';
import { LEVELS, PRIORITIES, TRANSPOSITIONS, CATEGORIES, KEY_MODES } from '../constants.js';
import { dateStr, daysBetween, addDays } from '../dates.js';
import { keyName, parseKey, isMinor } from '../keys.js';
import { uid } from '../util.js';
import { itemStats, itemById, isDue, isPlayedToday, todaysEntry, setLevel, deleteItem } from '../practice.js';
import { ensurePlan, makePlanItem, syncFocus, refreshTypes } from '../plan.js';
import { VARY, SHAPES, SCALES, CHORDS, typeInfo, parsePattern } from '../theory.js';
import { keyFamiliarity, keySessions, entryKeys } from '../keystats.js';
import { setTempo, clampBpm } from '../tempo.js';
import { addEntry, openTodos, entriesFor } from '../diary.js';
import { recordingsFor } from '../listen.js';

// Tools the practice assistant can call. Each has a JSON schema (strict: every property is
// listed in `required`; optional ones accept null) and a run function over the app state.
// Key names going in and out are as written for the instrument the user is viewing, which is
// what they see in the app.

const view = () => store.state.settings.view;
const levelLabel = (l) => (l == null ? 'not rated' : LEVELS[l].label.toLowerCase());
const writtenName = (k) => keyName(k, view());
const rootName = (r) => keyName(r % 12, view());

// A written key name ("F", "Gm", "B♭") → concert key index (0–23), or null.
export function concertKey(name) {
  const k = parseKey(String(name).replace('♭', 'b').replace('♯', '#'));
  if (k == null) return null;
  const root = (k % 12 - TRANSPOSITIONS[view()].offset + 12) % 12;
  return root + (isMinor(k) ? 12 : 0);
}

// Key names → concert keys, or an error naming the ones that couldn't be read.
function readKeys(names) {
  const keys = (names || []).map(concertKey);
  const bad = (names || []).filter((_, i) => keys[i] == null);
  if (bad.length) return { error: `Couldn’t read these key names: ${bad.join(', ')}. Use names like C, Bb, F#, Ebm.` };
  return { keys };
}
function readName(name) {
  const n = String(name || '').trim().replace(/\s+/g, ' ');
  if (!n) return { error: 'The name is empty.' };
  if (n.length > 120) return { error: 'The name is too long (120 characters at most).' };
  return { name: n };
}

// Optional fields: may be left out, or sent as null.
const OPTIONAL = new WeakSet();
// Scale or chord variation from tool input, applied to an exercise. Returns an error, or null.
const typeLabel = (kind, id) => typeInfo(kind, id)?.label || id;
function applyVary(t, a) {
  const kind = a.vary === 'none' ? null : a.vary || t.vary?.kind || null;
  if (!kind) {
    if (a.types?.length || a.shape || a.pattern) return 'Set vary to "scale" or "chord" to choose types, a shape or a pattern.';
    if (a.vary === 'none') t.vary = null;
    return null;
  }
  const known = VARY[kind].types;
  const bad = (a.types || []).filter((id) => !known[id]);
  if (bad.length) return `Not ${kind} types: ${bad.join(', ')}. Use: ${Object.keys(known).join(', ')}.`;
  if (a.shape && !SHAPES[a.shape]?.kinds.includes(kind)) return `The shape "${a.shape}" isn't available for ${kind}s.`;
  const shape = a.shape || (t.vary?.kind === kind ? t.vary.shape : 'updown');
  const pattern = a.pattern ?? (t.vary?.kind === kind ? t.vary.pattern : '');
  if (shape === 'custom') {
    const { error } = parsePattern(pattern, kind);
    if (error) return `Pattern: ${error}`;
  }
  const types = a.types?.length ? Object.keys(known).filter((id) => a.types.includes(id))
    : t.vary?.kind === kind ? t.vary.types : [...VARY[kind].defaults];
  t.vary = { kind, types, shape, pattern: pattern || '' };
  return null;
}
const varySummary = (t) => (t.vary ? {
  varies: t.vary.kind,
  types: t.vary.types.map((id) => typeLabel(t.vary.kind, id)),
  shape: SHAPES[t.vary.shape]?.label,
  ...(t.vary.shape === 'custom' ? { pattern: t.vary.pattern } : {}),
} : {});
const varyFields = () => ({
  vary: nullable({ type: 'string', enum: ['scale', 'chord', 'none'], description: 'Change the scale or chord type each session (notation is then written out for each type, so `abc` isn\'t used); none = the same notes every time.' }),
  types: nullable({ type: 'array', items: { type: 'string', enum: [...Object.keys(SCALES), ...Object.keys(CHORDS)] }, description: `Which types are turned on. Scales: ${Object.entries(SCALES).map(([id, x]) => `${id} (${x.label})`).join(', ')}. Chords: ${Object.entries(CHORDS).map(([id, x]) => `${id} (${x.label})`).join(', ')}. Defaults: scales ${VARY.scale.defaults.join(', ')}; chords ${VARY.chord.defaults.join(', ')}.` }),
  shape: nullable({ type: 'string', enum: Object.keys(SHAPES), description: 'updown = up and down an octave; updown2 = two octaves; thirds, fours (groups of 4) and p1235 (1-2-3-5 from each note) are for scales; inversions for chords; custom uses `pattern`.' }),
  pattern: nullable({ type: 'string', description: 'For shape custom: note numbers. Scales: notes of the scale, 1 = root (8 = octave on a 7-note scale), e.g. "1 2 3 5". Chords: chord tones 1 3 5 7, and 8 10 12 14 an octave up.' }),
});

const nullable = (schema) => {
  const s = { ...schema, type: [schema.type, 'null'], ...(schema.enum ? { enum: [...schema.enum, null] } : {}) };
  OPTIONAL.add(s);
  return s;
};
const obj = (properties) => ({
  type: 'object',
  properties,
  required: Object.keys(properties).filter((k) => !OPTIONAL.has(properties[k])),
  additionalProperties: false,
});

function itemSummary(t, stats) {
  const s = stats.get(t.id);
  return {
    id: t.id,
    name: t.name,
    type: t.type,
    ...(t.type === 'tune' ? { style: t.style, keys: t.keys.map(writtenName) } : {
      category: CATEGORIES[t.category],
      key_mode: KEY_MODES[t.keyMode]?.label,
      keys_per_session: t.keyMode === 'none' ? 0 : t.keysPerSession,
      has_notation: !!(t.abc || t.vary),
      ...varySummary(t),
    }),
    level: levelLabel(t.level),
    priority: PRIORITIES[(t.priority || 3) - 1].label.toLowerCase(),
    focus: !!t.focus,
    last_played: s?.last || null,
    times_played: s?.count || 0,
    due: isDue(t, stats),
    tempo: t.tempo || null,
  };
}

function planSummary() {
  ensurePlan();
  const stats = itemStats();
  return store.state.plan.items.map((it) => {
    const t = itemById(it.itemId);
    if (!t) return null;
    const e = todaysEntry(t.id);
    return {
      item_id: t.id,
      name: t.name,
      type: t.type,
      group: it.bucket,
      key: it.key != null ? writtenName(it.key) : null,
      new_key: !!it.alt,
      keys: it.keys?.map(rootName),
      ...(it.types?.length && t.vary ? { types: it.types.map((id) => typeLabel(t.vary.kind, id)) } : {}),
      tempo: t.tempo || null,
      played: !!e,
      rating: e?.rating || null,
      level: levelLabel(t.level),
      last_played: stats.get(t.id)?.last || null,
    };
  }).filter(Boolean);
}

// A short snapshot added to each message so the assistant starts with the basics.
export function appSnapshot() {
  const s = store.state.settings;
  const stats = itemStats();
  const today = dateStr();
  const plan = planSummary();
  const tunes = store.state.items.filter((t) => t.type === 'tune');
  return [
    `Today is ${today}. Keys are shown for ${TRANSPOSITIONS[s.view].label} instruments (${s.instruments.map((i) => TRANSPOSITIONS[i].label).join(' and ')} enabled).`,
    `Library: ${tunes.length} tunes (${tunes.filter((t) => isDue(t, stats)).length} due for review), ${store.state.items.length - tunes.length} exercises.`,
    `Today's set: ${plan.map((p) => `${p.name}${p.played ? ' (played)' : ''}`).join('; ') || 'empty'}.`,
    `Open to-dos: ${openTodos().length}.`,
  ].join('\n');
}

const changes = []; // what the assistant changed this turn, for the summary shown to the user
export function takeChanges() {
  return changes.splice(0);
}

function addToPlan(t, keys, types = null) {
  ensurePlan();
  const plan = store.state.plan;
  if (plan.items.some((i) => i.itemId === t.id)) return `${t.name} is already in today's set.`;
  const item = makePlanItem(t, itemStats());
  if (keys?.length) {
    if (t.type === 'exercise') {
      const roots = keys.map(concertKey).filter((k) => k != null).map((k) => k % 12);
      if (roots.length) item.keys = [...new Set(roots)];
    } else {
      const k = concertKey(keys[0]);
      if (k != null) {
        item.key = k;
        item.alt = !t.keys.includes(k);
        item.shift = null;
      }
    }
  }
  plan.items.push(item);
  plan.skipped = (plan.skipped || []).filter((id) => id !== t.id);
  // Types to go with the keys (asked-for ones first).
  if (t.vary && (keys?.length || types?.length)) refreshTypes(t, types);
  return null;
}

function findItem(id) {
  const t = itemById(id);
  if (!t) throw new Error(`No item with id ${id}. Use search_library to find ids.`);
  return t;
}

export const TOOLS = [
  {
    name: 'get_today',
    description: "Today's practice set: each item with its group (focus, exercise, hone = proficient/mastered, learn = familiar, fresh = new), suggested key(s), working tempo, and whether it's been played and how it was rated.",
    input_schema: obj({}),
    run: () => ({ items: planSummary() }),
  },
  {
    name: 'search_library',
    description: 'Search tunes and exercises. All filters are optional (null = any). Returns compact summaries with ids to use in other tools.',
    input_schema: obj({
      query: nullable({ type: 'string', description: 'Words in the name, style or category' }),
      type: nullable({ type: 'string', enum: ['tune', 'exercise'] }),
      levels: nullable({ type: 'array', items: { type: 'string', enum: ['not rated', "don't know", 'familiar', 'proficient', 'mastered'] } }),
      style: nullable({ type: 'string', description: 'Tune style, e.g. Ballad, Latin, Blues, Standard' }),
      key: nullable({ type: 'string', description: 'Only tunes usually played in this key (as written for the current instrument), e.g. "F" or "Gm"' }),
      due_only: nullable({ type: 'boolean' }),
      focus_only: nullable({ type: 'boolean' }),
      not_played_in_days: nullable({ type: 'integer', description: 'Only items not played in at least this many days (never played counts)' }),
      sort: nullable({ type: 'string', enum: ['priority', 'longest_ago', 'recent', 'most_played', 'name'] }),
      limit: nullable({ type: 'integer', description: 'Default 25, max 100' }),
    }),
    run: (a) => {
      const stats = itemStats();
      const q = a.query?.toLowerCase().trim();
      const levels = a.levels?.map((l) => (l === 'not rated' ? null : LEVELS.findIndex((x) => x.label.toLowerCase() === l)));
      const key = a.key ? concertKey(a.key) : null;
      const today = dateStr();
      let list = store.state.items.filter((t) => {
        if (a.type && t.type !== a.type) return false;
        if (q && !`${t.name} ${t.style || ''} ${CATEGORIES[t.category] || ''}`.toLowerCase().includes(q)) return false;
        if (levels && !levels.includes(t.level ?? null)) return false;
        if (a.style && (t.style || '').toLowerCase() !== a.style.toLowerCase()) return false;
        if (key != null && !(t.type === 'tune' && t.keys.includes(key))) return false;
        if (a.due_only && !isDue(t, stats)) return false;
        if (a.focus_only && !t.focus) return false;
        if (a.not_played_in_days) {
          const last = stats.get(t.id)?.last;
          if (last && daysBetween(last, today) < a.not_played_in_days) return false;
        }
        return true;
      });
      const last = (t) => stats.get(t.id)?.last || '';
      const sorts = {
        priority: (x, y) => x.priority - y.priority || x.name.localeCompare(y.name),
        longest_ago: (x, y) => last(x).localeCompare(last(y)) || x.priority - y.priority,
        recent: (x, y) => last(y).localeCompare(last(x)),
        most_played: (x, y) => (stats.get(y.id)?.count || 0) - (stats.get(x.id)?.count || 0),
        name: (x, y) => x.name.localeCompare(y.name),
      };
      list = list.sort(sorts[a.sort || 'priority']);
      const limit = Math.max(1, Math.min(100, a.limit || 25));
      return { total: list.length, items: list.slice(0, limit).map((t) => itemSummary(t, stats)) };
    },
  },
  {
    name: 'get_item',
    description: 'Everything about one tune or exercise: details, notes, notation (exercises), recent practice history with keys, ratings and tempos, diary notes, and recordings to listen to (tunes).',
    input_schema: obj({ item_id: { type: 'string' } }),
    run: ({ item_id }) => {
      const t = findItem(item_id);
      const stats = itemStats();
      const history = store.state.log
        .filter((e) => e.itemId === t.id)
        .sort((x, y) => y.date.localeCompare(x.date))
        .slice(0, 12)
        .map((e) => ({ date: e.date, keys: entryKeys(e).map(t.type === 'tune' ? writtenName : rootName), rating: e.rating, tempo: e.bpm || null }));
      return {
        ...itemSummary(t, stats),
        goal_tempo: t.goalTempo || null,
        next_review: t.due || null,
        notes: t.notes || '',
        ...(t.type === 'exercise' ? { notation_abc: t.abc || null, meter: t.meter } : { recordings: recordingsFor(t).map((r) => [r.artist, r.album, r.year].filter(Boolean).join(', ')) }),
        history,
        diary: entriesFor(t.id).slice(0, 8).map((e) => ({ date: e.date, text: e.text, flag: e.flag, done: e.done })),
      };
    },
  },
  {
    name: 'get_practice_stats',
    description: 'Overall practice picture: streak, recent days, sessions per key in the last 30 days (keys as written for the current instrument) and how familiar each key is, repertoire by level, and what was played in the last week.',
    input_schema: obj({}),
    run: () => {
      const log = store.state.log;
      const today = dateStr();
      const days = new Set(log.map((e) => e.date));
      let streak = 0;
      for (let d = days.has(today) ? today : addDays(today, -1); days.has(d); d = addDays(d, -1)) streak++;
      const fam = keyFamiliarity();
      const sess = keySessions(30);
      const tunes = store.state.items.filter((t) => t.type === 'tune');
      const lastWeek = {};
      for (const e of log) {
        if (daysBetween(e.date, today) >= 7) continue;
        (lastWeek[e.date] ||= []).push(itemById(e.itemId)?.name);
      }
      return {
        streak_days: streak,
        days_practiced_last_30: [...days].filter((d) => daysBetween(d, today) < 30).length,
        keys: [...Array(12).keys()].map((r) => ({ key: rootName(r), sessions_30d: sess[r], familiarity: Math.round(fam[r] * 10) / 10 })),
        tunes_by_level: Object.fromEntries([3, 2, 1, 0, null].map((l) => [levelLabel(l), tunes.filter((t) => (t.level ?? null) === l).length])),
        last_7_days: lastWeek,
      };
    },
  },
  {
    name: 'get_diary',
    description: 'Practice diary notes, newest first. Flags: "remember" (things to remember while practicing) and "teacher" (questions for the teacher).',
    input_schema: obj({
      open_todos_only: nullable({ type: 'boolean' }),
      flag: nullable({ type: 'string', enum: ['remember', 'teacher'] }),
      limit: nullable({ type: 'integer' }),
    }),
    run: (a) => {
      let list = [...store.state.diary].sort((x, y) => y.date.localeCompare(x.date) || y.at - x.at);
      if (a.flag) list = list.filter((e) => e.flag === a.flag);
      if (a.open_todos_only) list = list.filter((e) => e.flag && !e.done);
      return list.slice(0, a.limit || 30).map((e) => ({
        date: e.date, text: e.text || '(recording)', flag: e.flag, done: e.done,
        about: e.itemId ? itemById(e.itemId)?.name : null, recordings: e.media?.length || 0,
      }));
    },
  },
  {
    name: 'add_to_today',
    description: "Add tunes or exercises to today's set. Optionally choose keys: for a tune, one key it should be played in; for an exercise, the keys to play it in. For exercises that vary the scale or chord type, optionally the type for each key, in the same order (type ids as in create_exercise). Leave keys and types null to let the app choose (usual keys rotate; weak keys for exercises; least-played types).",
    input_schema: obj({
      items: {
        type: 'array',
        items: obj({
          item_id: { type: 'string' },
          keys: nullable({ type: 'array', items: { type: 'string' } }),
          types: nullable({ type: 'array', items: { type: 'string' } }),
        }),
      },
    }),
    write: true,
    run: ({ items }) => {
      const added = [];
      const notes = [];
      for (const { item_id, keys, types } of items) {
        const t = itemById(item_id);
        if (!t) { notes.push(`No item with id ${item_id}; use search_library to find ids.`); continue; }
        const unknown = t.vary ? (types || []).filter((id) => !t.vary.types.includes(id)) : [];
        if (unknown.length) notes.push(`${t.name}: ${unknown.join(', ')} isn't turned on for it, so the app chose instead (turn types on with update_item).`);
        const msg = addToPlan(t, keys, types);
        if (msg) notes.push(msg);
        else added.push(t.name);
      }
      if (added.length) changes.push(`Added to today: ${added.join(', ')}`);
      syncFocus();
      save();
      return { added, notes };
    },
  },
  {
    name: 'remove_from_today',
    description: "Remove items from today's set (they won't be suggested again today). Items already played can't be removed.",
    input_schema: obj({ item_ids: { type: 'array', items: { type: 'string' } } }),
    write: true,
    run: ({ item_ids }) => {
      ensurePlan();
      const plan = store.state.plan;
      const removed = [];
      const kept = [];
      for (const id of item_ids) {
        const t = itemById(id);
        if (!t || !plan.items.some((i) => i.itemId === id)) continue;
        if (isPlayedToday(id)) { kept.push(t.name); continue; }
        plan.items = plan.items.filter((i) => i.itemId !== id);
        if (t.focus) plan.focusSkipped.push(id);
        else plan.skipped.push(id);
        removed.push(t.name);
      }
      if (removed.length) changes.push(`Removed from today: ${removed.join(', ')}`);
      save();
      return { removed, already_played_so_kept: kept };
    },
  },
  {
    name: 'delete_item',
    description: 'Delete a tune or exercise from the library, with its practice history (diary notes about it are kept). Only when the user asks, e.g. to remove an exercise you created by mistake. If it has practice history, check with the user first unless they already said to delete it anyway.',
    input_schema: obj({ item_id: { type: 'string' } }),
    write: true,
    run: ({ item_id }) => {
      const t = findItem(item_id);
      const { sessions } = deleteItem(t.id);
      changes.push(`Deleted ${t.type === 'exercise' ? 'exercise' : 'tune'}: ${t.name}${sessions ? ` (and ${sessions} practice session${sessions > 1 ? 's' : ''})` : ''}`);
      save();
      return { deleted: t.name, practice_sessions_removed: sessions };
    },
  },
  {
    name: 'update_item',
    description: 'Change a tune or exercise. Every field is optional: null leaves it unchanged. Tempos are quarter-note BPM.',
    input_schema: obj({
      item_id: { type: 'string' },
      level: nullable({ type: 'string', enum: ["don't know", 'familiar', 'proficient', 'mastered'] }),
      priority: nullable({ type: 'string', enum: ['critical', 'high', 'medium', 'low'] }),
      focus: nullable({ type: 'boolean', description: 'Focus items are in the set every day until turned off' }),
      tempo: nullable({ type: 'integer', description: 'Working tempo' }),
      goal_tempo: nullable({ type: 'integer' }),
      keys: nullable({ type: 'array', items: { type: 'string' }, description: 'Tunes: the usual keys, most common first. Exercises: the chosen keys (sets key mode to chosen keys).' }),
      notes_append: nullable({ type: 'string', description: 'Text to add to the item’s notes' }),
      ...varyFields(),
    }),
    write: true,
    run: (a) => {
      const t = findItem(a.item_id);
      const keys = readKeys(a.keys);
      if (keys.error) return keys; // check before changing anything
      const wantsVary = a.vary || a.types?.length || a.shape || a.pattern != null;
      if (wantsVary && t.type !== 'exercise') return { error: 'Only exercises can vary the scale or chord type.' };
      const before = JSON.stringify(t.vary ?? null);
      if (wantsVary) {
        const draft = { vary: t.vary ? { ...t.vary, types: [...t.vary.types] } : null };
        const err = applyVary(draft, a);
        if (err) return { error: err };
      }
      const did = [];
      if (a.level) { setLevel(t, LEVELS.findIndex((l) => l.label.toLowerCase() === a.level)); did.push(`level → ${a.level}`); }
      if (a.priority) { t.priority = PRIORITIES.findIndex((p) => p.label.toLowerCase() === a.priority) + 1; did.push(`priority → ${a.priority}`); }
      if (a.focus != null) {
        t.focus = a.focus;
        if (store.state.plan?.date === dateStr()) {
          if (t.focus) store.state.plan.focusSkipped = (store.state.plan.focusSkipped || []).filter((x) => x !== t.id);
          syncFocus();
        }
        did.push(a.focus ? 'focus on' : 'focus off');
      }
      if (a.tempo) { setTempo(t, a.tempo, { nextTime: true }); did.push(`tempo → ${t.tempo}`); }
      if (a.goal_tempo) { t.goalTempo = clampBpm(a.goal_tempo); did.push(`goal tempo → ${t.goalTempo}`); }
      if (a.keys?.length) {
        const ks = keys.keys;
        if (t.type === 'exercise') { t.keys = [...new Set(ks.map((k) => k % 12))]; t.keyMode = 'fixed'; }
        else t.keys = [...new Set(ks)];
        did.push(`keys → ${a.keys.join(', ')}`);
      }
      if (a.notes_append) { t.notes = [t.notes, a.notes_append].filter(Boolean).join('\n'); did.push('notes added'); }
      if (wantsVary) {
        applyVary(t, a);
        if (JSON.stringify(t.vary ?? null) !== before) {
          did.push(t.vary ? `varies ${t.vary.kind}: ${t.vary.types.map((id) => typeLabel(t.vary.kind, id)).join(', ')} (${SHAPES[t.vary.shape].label.toLowerCase()})` : 'same notes each time');
          refreshTypes(t);
        }
      }
      if (did.length) changes.push(`${t.name}: ${did.join(', ')}`);
      save();
      return { updated: t.name, changes: did };
    },
  },
  {
    name: 'create_exercise',
    description: 'Create an exercise (scale, arpeggio, pattern, lick…), optionally with notation, and optionally add it to today. Notation is ABC with L:1/8 (C = eighth, C2 = quarter, C/ = sixteenth, ^ sharp, _ flat, lowercase = octave up, | bar line), written in C starting around middle C; the app transposes it into each key.',
    input_schema: obj({
      name: { type: 'string' },
      category: { type: 'string', enum: Object.keys(CATEGORIES) },
      key_mode: { type: 'string', enum: Object.keys(KEY_MODES), description: 'weak = weakest keys; fourths/chromatic continue around; random; fixed = only `keys`; none = no key' },
      keys_per_session: { type: 'integer' },
      keys: nullable({ type: 'array', items: { type: 'string' }, description: 'For key_mode fixed' }),
      abc: nullable({ type: 'string', description: 'Notation body only (no header), written in C' }),
      meter: nullable({ type: 'string', enum: ['4/4', '3/4', '5/4', '6/8', '2/4'] }),
      tempo: nullable({ type: 'integer' }),
      notes: nullable({ type: 'string', description: 'How to practice it' }),
      ...varyFields(),
      add_to_today: { type: 'boolean' },
    }),
    write: true,
    run: (a) => {
      const name = readName(a.name);
      const keys = readKeys(a.keys);
      if (name.error || keys.error) return name.error ? name : keys;
      if (a.key_mode === 'fixed' && !keys.keys.length) return { error: 'key_mode fixed needs at least one key.' };
      const t = {
        id: uid(), type: 'exercise', name: name.name, category: a.category, keyMode: a.key_mode,
        keysPerSession: Math.max(1, Math.min(12, a.keys_per_session || 1)),
        keys: [...new Set(keys.keys.map((k) => k % 12))],
        abc: a.abc?.trim() || '', meter: a.meter || '4/4', notes: a.notes || '',
        tempo: a.tempo ? clampBpm(a.tempo) : null, priority: 2, level: null, ivl: null, due: null, vary: null,
      };
      const varyError = applyVary(t, a);
      if (varyError) return { error: varyError };
      store.state.items.push(t);
      if (a.add_to_today) addToPlan(t, null);
      changes.push(`New exercise: ${t.name}${a.add_to_today ? ' (added to today)' : ''}`);
      save();
      return { created: t.id, name: t.name };
    },
  },
  {
    name: 'create_tune',
    description: 'Add a tune to the library (for tunes not already in it — search first).',
    input_schema: obj({
      name: { type: 'string' },
      style: nullable({ type: 'string' }),
      keys: nullable({ type: 'array', items: { type: 'string' }, description: 'Usual keys as written for the current instrument, most common first' }),
      level: nullable({ type: 'string', enum: ["don't know", 'familiar', 'proficient', 'mastered'] }),
      priority: nullable({ type: 'string', enum: ['critical', 'high', 'medium', 'low'] }),
      add_to_today: { type: 'boolean' },
    }),
    write: true,
    run: (a) => {
      const name = readName(a.name);
      const keys = readKeys(a.keys);
      if (name.error || keys.error) return name.error ? name : keys;
      const t = {
        id: uid(), type: 'tune', name: name.name, style: a.style || 'Standard',
        keys: [...new Set(keys.keys)],
        level: a.level ? LEVELS.findIndex((l) => l.label.toLowerCase() === a.level) : 0,
        priority: a.priority ? PRIORITIES.findIndex((p) => p.label.toLowerCase() === a.priority) + 1 : 2,
        notes: '', mine: true, ivl: null, due: null,
      };
      store.state.items.push(t);
      if (a.add_to_today) addToPlan(t, null);
      changes.push(`New tune: ${t.name}${a.add_to_today ? ' (added to today)' : ''}`);
      save();
      return { created: t.id, name: t.name };
    },
  },
  {
    name: 'add_diary_note',
    description: 'Add a note to the practice diary, optionally flagged as a to-do ("remember" shows on the Today screen; "teacher" collects questions for lessons) and optionally about a tune or exercise.',
    input_schema: obj({
      text: { type: 'string' },
      flag: nullable({ type: 'string', enum: ['remember', 'teacher'] }),
      item_id: nullable({ type: 'string' }),
    }),
    write: true,
    run: (a) => {
      const e = addEntry({ text: a.text, flag: a.flag || null, itemId: a.item_id && itemById(a.item_id) ? a.item_id : null });
      changes.push(`Diary note${e.flag ? ` (${e.flag === 'teacher' ? 'for teacher' : 'to remember'})` : ''}: “${e.text.slice(0, 60)}${e.text.length > 60 ? '…' : ''}”`);
      save();
      return { added: true };
    },
  },
  {
    name: 'report_unsupported',
    description: "Call this when the user asks for something the app or these tools can't do, so it can be added later. Then tell the user it isn't possible yet.",
    input_schema: obj({ request: { type: 'string', description: 'What they wanted, in a sentence' } }),
    run: ({ request }) => {
      const s = store.state;
      (s.assistantWishes ||= []).push({ date: dateStr(), request });
      save();
      return { noted: true };
    },
  },
];

const byName = new Map(TOOLS.map((t) => [t.name, t]));

// Check tool input against its schema (tool inputs stream in unvalidated).
export function validate(schema, value, path = 'input') {
  const types = [].concat(schema.type);
  const typeOf = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : Number.isInteger(v) ? 'integer' : typeof v);
  const actual = typeOf(value);
  if (!types.includes(actual) && !(actual === 'integer' && types.includes('number'))) {
    return `${path} should be ${types.join(' or ')}, got ${actual}`;
  }
  if (actual === 'null') return null;
  if (schema.enum && !schema.enum.includes(value)) return `${path} should be one of ${schema.enum.join(', ')}`;
  if (actual === 'object' && schema.properties) {
    for (const k of schema.required || []) if (!(k in value)) return `${path}.${k} is missing`;
    for (const [k, v] of Object.entries(value)) {
      if (!schema.properties[k]) return `${path}.${k} is not a known field`;
      const err = validate(schema.properties[k], v, `${path}.${k}`);
      if (err) return err;
    }
  }
  if (actual === 'array' && schema.items) {
    for (let i = 0; i < value.length; i++) {
      const err = validate(schema.items, value[i], `${path}[${i}]`);
      if (err) return err;
    }
  }
  return null;
}

export function runTool(name, input) {
  const tool = byName.get(name);
  if (!tool) return { error: `Unknown tool ${name}` };
  const err = validate(tool.input_schema, input);
  if (err) return { error: `Invalid input: ${err}` };
  try {
    return tool.run(input);
  } catch (e) {
    return { error: e.message };
  }
}

export const isWriteTool = (name) => !!byName.get(name)?.write;

// Tool definitions for the API (without the run functions).
// Not strict: the API's strict mode allows at most 16 optional (nullable) fields across all tools,
// and these tools have more. Inputs are checked here instead (validate, before any tool runs).
export const apiTools = () => TOOLS.map(({ name, description, input_schema }) => ({
  name, description, input_schema, eager_input_streaming: true,
}));

