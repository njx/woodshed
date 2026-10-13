import { store } from '../store.js';
import { CATEGORIES, KEY_MODES } from '../constants.js';
import { uid } from '../util.js';
import { VARY, SHAPES, SCALES, CHORDS, typeInfo, parsePattern } from '../theory.js';
import { itemById, setLevel, deleteItem as dropItem } from '../practice.js';
import { setItemStatus, refreshKeys, refreshTypes, addToToday as addItem } from '../plan.js';
import { setTempo, clampBpm } from '../tempo.js';
import { command, f, CommandError, type Field } from './core.js';
import type { Category, Chart, Exercise, Id, Item, Key, KeyMode, Level, Priority, Shape, Tune, Vary } from '../types.js';

// The library: tunes and exercises, made, changed and deleted.

const STATUS = ['focus', 'on', 'off'] as const;
const METERS = ['4/4', '3/4', '5/4', '6/8', '2/4'] as const;
const CATEGORY_IDS = Object.keys(CATEGORIES) as Category[];
const KEY_MODE_IDS = Object.keys(KEY_MODES) as KeyMode[];

// What can be set on a tune or exercise. The same for a new one, one being changed, and one still
// being made in its sheet (not in the library yet: see applyItem).
export interface ItemFields {
  name?: string;
  style?: string;
  notes?: string;
  notes_append?: string;
  level?: Level;
  priority?: Priority;
  status?: (typeof STATUS)[number];
  tempo?: number;
  /** The tempo played at today (on the metronome): today's session changes too. Otherwise it's for next time. */
  tempo_today?: boolean;
  goal_tempo?: number;
  keys?: Key[];
  key_mode?: KeyMode;
  keys_per_session?: number;
  category?: Category;
  use_with_tunes?: boolean;
  vary?: Vary['kind'] | 'none';
  types?: string[];
  shape?: Shape;
  pattern?: string;
  /** The pattern is still being typed (the app's number pad): kept even if it can't be played yet. */
  pattern_unfinished?: boolean;
  abc?: string;
  meter?: (typeof METERS)[number];
  harmony?: string;
  as_written?: boolean;
  /** The key its notation is written in (0–23: see abc.ts homeKey). */
  home?: Key;
}
const itemFields = (): { [K in keyof ItemFields]-?: Field<NonNullable<ItemFields[K]>> } => ({
  name: f.opt(f.str(undefined, 120)),
  style: f.opt(f.str('Tunes: e.g. Ballad, Latin, Blues, Standard', 60)),
  notes: f.opt(f.text('Replaces its notes')),
  notes_append: f.opt(f.text('Text to add to its notes')),
  level: f.opt(f.level()),
  priority: f.opt(f.priority()),
  status: f.opt(f.oneOf(STATUS, 'focus: comes first in the set, a few a day (Settings), taking turns; on: can be picked; off: left out of the pool (not picked, and for exercises not offered as a warm-up)')),
  tempo: f.opt(f.int('Working tempo, quarter-note BPM')),
  tempo_today: f.opt(f.app()),
  goal_tempo: f.opt(f.int('Goal tempo, quarter-note BPM (0 clears it)')),
  keys: f.opt(f.list(f.key(), 'Tunes: the usual keys, most common first. Exercises: the keys for key_mode fixed (giving keys sets it, unless key_mode is given).')),
  key_mode: f.opt(f.oneOf(KEY_MODE_IDS, 'Exercises: weak = weakest keys; fourths/chromatic continue around; random; fixed = only `keys`; none = no key (played as written)')),
  keys_per_session: f.opt(f.int('Exercises: how many keys each time (1–12)')),
  category: f.opt(f.oneOf(CATEGORY_IDS)),
  use_with_tunes: f.opt(f.bool('Exercises: false keeps a technical one (long tones, interval drills) out of tunes: not suggested as a warm-up')),
  vary: f.opt(f.oneOf(['scale', 'chord', 'none'] as const, 'Exercises: change the scale or chord type each session (notation is then written out for each type, so `abc` isn\'t used); none = the same notes every time.')),
  types: f.opt(f.list(f.oneOf([...Object.keys(SCALES), ...Object.keys(CHORDS)]), `Which types are turned on. Scales: ${Object.entries(SCALES).map(([id, x]) => `${id} (${x.label})`).join(', ')}. Chords: ${Object.entries(CHORDS).map(([id, x]) => `${id} (${x.label})`).join(', ')}. Defaults: scales ${VARY.scale.defaults.join(', ')}; chords ${VARY.chord.defaults.join(', ')}.`)),
  shape: f.opt(f.oneOf(Object.keys(SHAPES) as Shape[], 'updown = up and down an octave; updown2 = two octaves; thirds, fours (groups of 4) and p1235 (1-2-3-5 from each note) are for scales; inversions for chords; custom uses `pattern`.')),
  pattern: f.opt(f.str('For shape custom: note numbers. Scales: notes of the scale, 1 = root (8 = octave on a 7-note scale), e.g. "1 2 3 5". Chords: chord tones 1 3 5 7, and 8 10 12 14 an octave up.', 400)),
  pattern_unfinished: f.opt(f.app()),
  abc: f.opt(f.text('Exercises: notation body only (no header), ABC with L:1/8 (C = eighth, C2 = quarter, C/ = sixteenth, ^ sharp, _ flat, lowercase = octave up, | bar line), written in C starting around middle C; the app transposes it into each key.')),
  meter: f.opt(f.oneOf(METERS)),
  harmony: f.opt(f.str('Exercises: the chords it goes over, as written, like "Dm7 G7 Cmaj7" (empty: read from the chord symbols in its notation)', 2000)),
  as_written: f.opt(f.bool('Exercises: notation shown only as written, in C (transposed in your head)')),
  home: f.opt(f.app()),
});

const typeLabel = (kind: Vary['kind'], id: string) => typeInfo(kind, id)?.label || id;

// The scale or chord variation asked for, from what's there: its kind, types, shape and pattern.
// An error (and nothing changed) if it can't be.
function varyFrom(t: { vary: Vary | null }, a: ItemFields): Vary | null {
  const kind = a.vary === 'none' ? null : a.vary || t.vary?.kind || null;
  if (!kind) {
    if (a.types?.length || a.shape || a.pattern) throw new CommandError('Set vary to "scale" or "chord" to choose types, a shape or a pattern.');
    return null;
  }
  const known = VARY[kind].types as Record<string, unknown>;
  const bad = (a.types || []).filter((id) => !known[id]);
  if (bad.length) throw new CommandError(`Not ${kind} types: ${bad.join(', ')}. Use: ${Object.keys(known).join(', ')}.`);
  if (a.types && !a.types.length) throw new CommandError('Keep at least one turned on');
  if (a.shape && !(SHAPES[a.shape]?.kinds as readonly string[]).includes(kind)) throw new CommandError(`The shape "${a.shape}" isn't available for ${kind}s.`);
  const same = t.vary?.kind === kind;
  const shape = a.shape || (same ? t.vary!.shape : 'updown');
  const pattern = a.pattern ?? (same ? t.vary!.pattern : '');
  if (shape === 'custom' && !a.pattern_unfinished) {
    const { error } = parsePattern(pattern, kind);
    if (error) throw new CommandError(`Pattern: ${error}`);
  }
  // (in the catalogue's order)
  const types = a.types?.length ? Object.keys(known).filter((id) => a.types!.includes(id)) : same ? t.vary!.types : [...VARY[kind].defaults];
  return { kind, types, shape, pattern: pattern || '' };
}

/**
 * Sets the fields given on a tune or exercise — one in the library, or one still being made in its
 * sheet (whose follow-ups find nothing to do) — with what follows: its status in today's set, today's
 * keys and types picked again. Checks everything first (CommandError, nothing changed). Returns
 * what changed, in words.
 */
export function applyItem(t: Item, a: ItemFields): string[] {
  const x = t.type === 'exercise' ? t : null;
  const exerciseOnly = (['key_mode', 'keys_per_session', 'category', 'use_with_tunes', 'vary', 'types', 'shape', 'pattern', 'abc', 'meter', 'harmony', 'as_written', 'home'] as const).filter((k) => a[k] != null);
  if (!x && exerciseOnly.length) throw new CommandError(`Only exercises have ${exerciseOnly.join(', ')}.`);
  if (a.name != null && !a.name.trim()) throw new CommandError('The name is empty.');
  const vary = x && (a.vary || a.types || a.shape || a.pattern != null) ? varyFrom(x, a) : undefined;

  const did: string[] = [];
  if (a.name != null) { t.name = a.name.replace(/\s+/g, ' ').trimStart(); did.push(`name → ${t.name.trim()}`); }
  if (a.style != null && t.type === 'tune') { t.style = a.style.trim() || 'Standard'; did.push(`style → ${t.style}`); }
  if (a.notes != null) { t.notes = a.notes; did.push('notes'); }
  if (a.notes_append) { t.notes = [t.notes, a.notes_append].filter(Boolean).join('\n'); did.push('notes added'); }
  if (a.level != null) { setLevel(t, a.level); did.push(`level → ${['don’t know', 'familiar', 'proficient', 'mastered'][a.level]}`); }
  if (a.priority != null) { t.priority = a.priority; did.push(`priority → ${['critical', 'high', 'medium', 'low'][a.priority - 1]}`); }
  if (a.status) { setItemStatus(t, a.status); did.push({ focus: 'focus on', on: 'turned on', off: 'turned off (left out of the pool)' }[a.status]); }
  if (a.tempo) { setTempo(t, a.tempo, { nextTime: !a.tempo_today }); did.push(`tempo → ${t.tempo}`); }
  if (a.goal_tempo != null) { t.goalTempo = a.goal_tempo ? clampBpm(a.goal_tempo) : null; did.push(t.goalTempo ? `goal tempo → ${t.goalTempo}` : 'no goal tempo'); }
  if (t.type === 'tune' && a.keys) { t.keys = [...new Set(a.keys)]; did.push('usual keys'); }
  if (x) {
    let keysChanged = false;
    if (a.keys) { x.keys = [...new Set(a.keys.map((k) => k % 12))]; if (!a.key_mode) x.keyMode = 'fixed'; keysChanged = true; did.push('keys'); }
    if (a.key_mode) { x.keyMode = a.key_mode; keysChanged = true; did.push(`keys: ${KEY_MODES[a.key_mode].label.toLowerCase()}`); }
    if (a.keys_per_session != null) { x.keysPerSession = Math.max(1, Math.min(12, a.keys_per_session)); keysChanged = true; did.push(`${x.keysPerSession} keys a session`); }
    if (a.category) { x.category = a.category; did.push(CATEGORIES[a.category].toLowerCase()); }
    if (a.use_with_tunes != null) { if (a.use_with_tunes) delete x.solo; else x.solo = true; did.push(a.use_with_tunes ? 'used with tunes' : 'kept out of tunes'); }
    if (a.abc != null) { x.abc = a.abc.trim(); did.push('notation'); }
    if (a.meter) { x.meter = a.meter; did.push(`in ${a.meter}`); }
    if (a.home != null) { if (a.home) x.home = a.home; else delete x.home; did.push('written in another key'); }
    if (a.harmony != null) { if (a.harmony.trim()) x.harmony = a.harmony.trim(); else delete x.harmony; did.push('its chords'); }
    if (a.as_written != null) { if (a.as_written) x.asWritten = true; else delete x.asWritten; did.push(a.as_written ? 'only as written' : 'in every key'); }
    if (vary !== undefined && JSON.stringify(vary) !== JSON.stringify(x.vary ?? null)) {
      x.vary = vary;
      did.push(vary ? `varies ${vary.kind}: ${vary.types.map((id) => typeLabel(vary.kind, id)).join(', ')} (${SHAPES[vary.shape].label.toLowerCase()})` : 'same notes each time');
      if (!keysChanged) refreshTypes(x);
    }
    // Today's keys (and types) picked again, for how it picks them now.
    if (keysChanged) refreshKeys(x);
  }
  return did;
}

type UpdateInput = ItemFields & { item: Id };
export const updateItem = command<UpdateInput>({
  name: 'update_item',
  description: 'Change a tune or exercise. Every field is optional: null leaves it unchanged. Tempos are quarter-note BPM.',
  fields: { item: f.item(), ...itemFields() },
  // Typing into a field (or the notation), or nudging a tempo: one undo for it.
  coalesce(a) {
    const set = Object.keys(a).filter((k) => k !== 'item' && k !== 'tempo_today');
    if (set.length && set.every((k) => ['abc', 'meter', 'home'].includes(k))) return `notation:${a.item}`;
    return set.length === 1 && ['name', 'notes', 'tempo', 'goal_tempo'].includes(set[0]) ? `${set[0]}:${a.item}` : undefined;
  },
  run(a, { note }) {
    const t = itemById(a.item)!; // (checked by its field, or by the app)
    const did = applyItem(t, a);
    if (did.length) note(`${t.name}: ${did.join(', ')}`);
    return { updated: t.name, changes: did };
  },
});

// A new one: made with what's given, into the library (and today's set, if asked).
function create(t: Item, a: ItemFields & { add_to_today?: boolean }, note: (s: string) => void) {
  // (In its sheet, Fixed can be picked before its keys are; made in one go, it needs them.)
  if (a.key_mode === 'fixed' && !a.keys?.length) throw new CommandError('key_mode fixed needs at least one key.');
  applyItem(t, a);
  if (!t.name.trim()) throw new CommandError('The name is empty.');
  t.name = t.name.trim();
  store.state.items.push(t);
  if (a.add_to_today) addItem(t);
  note(`New ${t.type}: ${t.name}${a.add_to_today ? ' (added to today)' : ''}`);
  return { created: t.id, name: t.name };
}
const blank = {
  tune: (): Tune => ({ id: uid(), type: 'tune', name: '', style: 'Standard', keys: [], notes: '', mine: true, priority: 2, level: 0, focus: false, ivl: null, due: null }),
  exercise: (): Exercise => ({ id: uid(), type: 'exercise', name: '', category: 'pattern', keyMode: 'weak', keysPerSession: 2, keys: [], abc: '', meter: '4/4', vary: null, notes: '', priority: 2, level: 0, focus: false, ivl: null, due: null }),
};
/** A new tune or exercise, to fill in (in its sheet) before it's added: blank.tune(), blank.exercise(). */
export { blank };

type CreateInput = ItemFields & { name: string; add_to_today?: boolean };
export const createTune = command<CreateInput>({
  name: 'create_tune',
  description: 'Add a tune to the library (for tunes not already in it — search first).',
  fields: { ...itemFields(), name: f.str(undefined, 120), add_to_today: f.opt(f.bool()) },
  run: (a, { note }) => create(blank.tune(), a, note),
});
export const createExercise = command<CreateInput>({
  name: 'create_exercise',
  description: 'Create an exercise (scale, arpeggio, pattern, lick…), optionally with notation (`abc`), and optionally add it to today.',
  fields: { ...itemFields(), name: f.str(undefined, 120), add_to_today: f.opt(f.bool()) },
  run: (a, { note }) => create(blank.exercise(), a, note),
});

// One made in its sheet (see blank): into the library as it is.
export const addDraft = command<{ draft: Item }>({
  name: 'add_item',
  fields: { draft: f.app() },
  undoToast: true,
  run({ draft }, { note }) {
    if (!draft.name.trim()) throw new CommandError(`Give the ${draft.type} a name`);
    draft.name = draft.name.trim();
    store.state.items.push(draft);
    note(`Added ${draft.name}`);
    return { created: draft.id };
  },
});

export const deleteItem = command<{ item: Id }>({
  name: 'delete_item',
  description: 'Delete a tune or exercise from the library, with its practice history (diary notes about it are kept). Only when the user asks, e.g. to remove an exercise you created by mistake. If it has practice history, the user is asked to confirm with a tap.',
  fields: { item: f.item() },
  undoToast: true,
  ask({ item }) {
    const t = itemById(item);
    const n = store.state.log.filter((e) => e.itemId === item).length;
    return t && n ? `Delete ${t.name} and its ${n} practice session${n > 1 ? 's' : ''}?` : null;
  },
  run({ item }, { note }) {
    const t = itemById(item)!;
    const { sessions } = dropItem(t.id);
    note(`Deleted ${t.name}${sessions ? ` (and ${sessions} practice session${sessions > 1 ? 's' : ''})` : ''}`);
    return { deleted: t.name, practice_sessions_removed: sessions };
  },
});

// ---------- Recordings to listen to, and charts ----------

export const addRecording = command<{ tune: Id; artist: string; album?: string }>({
  name: 'add_recording',
  description: 'Add a recording of a tune to listen to (shown in its details, with a search link on their listening service).',
  fields: { tune: f.item('tune'), artist: f.str(), album: f.opt(f.str()) },
  run({ tune, artist, album }, { note }) {
    const t = itemById(tune) as Tune;
    if (!artist.trim()) throw new CommandError('Who’s it by?');
    t.recordings = [...(t.recordings || []), { artist: artist.trim(), album: album?.trim() || null }];
    note(`${t.name}: added ${artist.trim()}’s recording`);
    return {};
  },
});
export const removeRecording = command<{ tune: Id; artist: string; album?: string }>({
  name: 'remove_recording',
  description: 'Take away a recording of a tune that was added (by the user or you).',
  fields: { tune: f.item('tune'), artist: f.str(), album: f.opt(f.str()) },
  run({ tune, artist, album }, { note }) {
    const t = itemById(tune) as Tune;
    const i = (t.recordings || []).findIndex((r) => r.artist === artist && (album == null || (r.album || '') === album));
    if (i < 0) throw new CommandError(`No recording by ${artist} was added to ${t.name}.`);
    t.recordings = t.recordings!.filter((_, j) => j !== i);
    note(`${t.name}: took away ${artist}’s recording`);
    return {};
  },
});

// A tune's chord chart, as edited (see ui/chart.ts), or back to the one it came with (edited false).
export const setChart = command<{ tune: Id; chart: Chart | null; edited: boolean }>({
  name: 'set_chart',
  fields: { tune: f.item('tune'), chart: f.app(), edited: f.app() },
  coalesce: ({ tune }) => `chart:${tune}`,
  run({ tune, chart, edited }, { note }) {
    const t = itemById(tune) as Tune;
    t.chart = chart;
    t.chartEdited = edited && !!chart;
    note(`${t.name}: chart ${edited ? 'changed' : 'back to how it was'}`);
    return {};
  },
});
