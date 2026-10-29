import { store, save } from './store.js';
import { invalidateUndo } from './commands/core.js';
import { BUCKETS, BUCKET_ORDER, PRIORITY_WEIGHTS, SHIFTS } from './constants.js';
import { dateStr, addDays } from './dates.js';
import { isMinor } from './keys.js';
import { weightedPick, randomOf, uid } from './util.js';
import { itemStats, overdue, itemById, isPlayedToday, isPlanItemPlayed, planEntry } from './practice.js';
import { chooseExerciseKeys, keyFamiliarity } from './keystats.js';
import { chooseTypes } from './theory.js';
import { nextWarmups, altWarmup, warmupOf, fitsTune } from './warmups.js';
import { chartFor } from './charts.js';
import type { Bucket, Exercise, Id, Item, ItemStats, Key, LogEntry, Plan, PlanItem, Tune } from './types.js';

type Stats = Map<Id, ItemStats>;

export function bucketOf(t: Item): Bucket {
  if (t.type === 'exercise') return 'exercise';
  if (t.level >= 2) return 'hone';
  if (t.level === 1) return 'learn';
  return 'fresh';
}

export function weightFor(t: Item, stats: Stats, bucket: Bucket): number {
  // (settings.priority is any string saved)
  const pw = (PRIORITY_WEIGHTS as Partial<Record<string, number[]>>)[store.state.settings.priority] || PRIORITY_WEIGHTS.some;
  let w = pw[(t.priority || 3) - 1];
  const s = stats.get(t.id);
  if (s?.last === dateStr()) return 0;
  if (bucket === 'fresh') {
    // Keep coming back to a new tune you've started, while it's due.
    if (s?.count && overdue(t, stats) >= 1) w *= 4;
    return w;
  }
  const o = overdue(t, stats);
  w *= o < 0.5 ? 0.05 : Math.pow(Math.min(o, 4), 1.5);
  return w;
}

export function wantsNewKey(t: Tune): boolean {
  const mode = store.state.settings.newKeys;
  if (mode === 'never') return false;
  return mode === 'proficient' ? t.level >= 2 : t.level === 3;
}

// The candidates practiced least often (ties keep their order).
export function leastPracticed(candidates: Key[], played: Key[]): Key[] {
  let best: Key[] = [], min = Infinity;
  for (const k of candidates) {
    const n = played.filter((p) => p === k).length;
    if (n < min) { min = n; best = [k]; } else if (n === min) best.push(k);
  }
  return best;
}

// Which key to suggest: one of the usual keys, least practiced first; or for tunes you know
// well, a key outside the usual ones (same major/minor quality), least practiced first.
export function chooseKey(t: Tune, stats: Stats): Pick<PlanItem, 'key' | 'alt' | 'shift'> {
  const played = stats.get(t.id)?.keys || [];
  if (wantsNewKey(t)) {
    if (!t.keys.length) return { key: null, alt: true, shift: randomOf(Object.keys(SHIFTS).map(Number)) };
    const minor = isMinor(t.keys[0]);
    const others = [...Array(12).keys()].map((r) => r + (minor ? 12 : 0)).filter((k) => !t.keys.includes(k));
    if (!others.length) return { key: leastPracticed(t.keys, played)[0], alt: false, shift: null }; // already in every key
    return { key: randomOf(leastPracticed(others, played)), alt: true, shift: null };
  }
  if (!t.keys.length) return { key: null, alt: false, shift: null };
  return { key: leastPracticed(t.keys, played)[0], alt: false, shift: null };
}

// An exercise that only goes over a tune's chords (one that takes them from the tune, or is marked
// so): it comes up as a warm-up or through a tune, never in a key on its own.
export const onlyWithTunes = (t: Item): boolean => t.type === 'exercise' && (!!t.fromTune || !!t.tunesOnly);

export function pickItem(bucket: Bucket, exclude: Set<Id>, stats: Stats): Item | null {
  for (const b of [bucket, ...BUCKETS[bucket].fallback]) {
    const pool = store.state.items.filter((t) => !t.focus && !t.off && !onlyWithTunes(t) && bucketOf(t) === b && !exclude.has(t.id));
    const t = weightedPick(pool, (t) => weightFor(t, stats, b));
    if (t) return t;
  }
  return null;
}

// ---------- Today's tunes and exercises (Settings → Daily mix: so many of each) ----------
// Focus ones take up to half the places (rounded up: see syncFocus), and the rest if there's
// nothing else to pick. After them, each place goes to a group — for a tune hone, learn or new; for
// an exercise its kind (scale, arpeggio…) — then to one in it (by weightFor: priority and how
// overdue). A group's pull is its most pressing one's priority (one played recently counts for
// little), less for each of today's already from it and for each of the last few days one came
// up — so the groups mix, within a day and across days, but a critical one still gets in.
// (Picking from all tunes at once would mostly pick new ones: the starting list has hundreds.)
const RECENT_DAYS = 6;
type Kind = Item['type'];
const groupOf = (t: Item): string => (t.type === 'tune' ? bucketOf(t) : t.category || 'other');

function priorityWeight(t: Item): number {
  const pw = (PRIORITY_WEIGHTS as Partial<Record<string, number[]>>)[store.state.settings.priority] || PRIORITY_WEIGHTS.some;
  return pw[(t.priority || 3) - 1];
}
function pull(t: Item, stats: Stats): number {
  if (stats.get(t.id)?.last === dateStr()) return 0;
  if (bucketOf(t) === 'fresh') return priorityWeight(t);
  const o = overdue(t, stats);
  return priorityWeight(t) * (o < 0.5 ? 0.05 : o < 1 ? 0.5 : 1);
}
// Days of the last few one from each group was played (as they stand now).
function recentGroups(kind: Kind): Map<string, number> {
  const today = dateStr(), from = addDays(today, -RECENT_DAYS);
  const days = new Map<string, Set<string>>();
  for (const e of store.state.log) {
    if (e.date >= today || e.date < from || e.warmup) continue;
    const t = itemById(e.itemId);
    if (t?.type !== kind) continue;
    const g = groupOf(t);
    if (!days.has(g)) days.set(g, new Set());
    days.get(g)!.add(e.date);
  }
  return new Map([...days].map(([g, d]) => [g, d.size]));
}
const pickPool = (kind: Kind, exclude: Set<Id>) => store.state.items.filter((t) => t.type === kind && !t.focus && !t.off
  && !onlyWithTunes(t) && !exclude.has(t.id));
const inSetOf = (plan: Plan, kind: Kind) => plan.items.filter((i) => !i.warmup && itemById(i.itemId)?.type === kind);

// One more tune or exercise for today's set (plan), not one of `exclude`; null if there are none.
export function pickNext(plan: Plan, kind: Kind, exclude: Set<Id>, stats: Stats): Item | null {
  const recent = recentGroups(kind);
  const today = inSetOf(plan, kind).map((i) => groupOf(itemById(i.itemId)!)); // (focus ones too)
  const byGroup = new Map<string, Item[]>();
  for (const t of pickPool(kind, exclude)) byGroup.set(groupOf(t), [...(byGroup.get(groupOf(t)) || []), t]);
  const groups = [...byGroup].map(([g, pool]) => ({
    pool, w: Math.max(...pool.map((t) => pull(t, stats))) * 0.3 ** today.filter((x) => x === g).length / (1 + 0.5 * (recent.get(g) || 0)),
  }));
  const group = weightedPick(groups, (x) => x.w) || randomOf(groups);
  if (!group) return null;
  return weightedPick(group.pool, (t) => weightFor(t, stats, bucketOf(t))) || randomOf(group.pool);
}
export const pickTune = (plan: Plan, exclude: Set<Id>, stats: Stats) => pickNext(plan, 'tune', exclude, stats);
// Today's set up to the number of tunes or exercises (after its focus ones; more of those if
// there's nothing else). A focus one skipped today keeps its place.
function fill(plan: Plan, kind: Kind, exclude: Set<Id>, stats: Stats): void {
  const s = store.state.settings, want = (kind === 'tune' ? s.tunes : s.exercises) ?? 0;
  const skipped = (plan.focusSkipped || []).filter((id) => itemById(id)?.type === kind && itemById(id)!.focus).length;
  for (let n = inSetOf(plan, kind).length + skipped; n < want; n++) {
    const t = pickNext(plan, kind, exclude, stats);
    if (!t) return addFocus(plan, kind, want - n, stats);
    exclude.add(t.id);
    plan.items.push(makePlanItem(t, stats));
  }
}

export function makePlanItem(t: Item, stats: Stats, bucket: Bucket = bucketOf(t)): PlanItem {
  if (t.type === 'exercise') {
    const s = stats.get(t.id);
    const keys = chooseExerciseKeys(t, { played: s?.keys || [], lastPlayed: s?.keyLast || {}, familiarity: keyFamiliarity() });
    // Exercises that vary get a scale or chord type for each key (or one, if there are no keys).
    const types = t.vary ? chooseTypes(t.vary, Math.max(1, keys.length), s?.types || [], Math.random, typeCounts()) : null;
    return { pid: uid(), itemId: t.id, bucket, key: null, keys, ...(types ? { types } : {}), alt: false, shift: null };
  }
  return { pid: uid(), itemId: t.id, bucket, ...chooseKey(t, stats) };
}

// How often each scale or chord type has been played, across all exercises.
export function typeCounts(log: LogEntry[] = store.state.log): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const e of log) for (const id of e.types || []) counts[id] = (counts[id] || 0) + 1;
  return counts;
}

// ---------- How exercises relate to each other on a day (Settings → Exercises) ----------
//   own:   each exercise picks its own keys (and types);
//   day:   one or two keys of the day for all exercises that choose by weak keys or at random;
// (Warm-ups for tunes are added by hand: addWarmups.)
//
// Below, store.state.plan! where the code has just made sure of today's set (ensurePlan), or is only
// called once there is one.

export function applyExerciseFocus(plan: Plan = store.state.plan!): void {
  const mode = store.state.settings.exerciseFocus || 'own';
  if (mode === 'day') {
    if (!plan.dayKeys?.length) plan.dayKeys = chooseExerciseKeys({ keyMode: 'weak', keysPerSession: 2 }, { familiarity: keyFamiliarity() });
    for (const it of plan.items) {
      const t = itemById(it.itemId);
      if (t?.type === 'exercise' && !it.warmup && !isPlayedToday(t.id)) useDayKeys(t, it, plan);
    }
  }
  plan.mode = mode;
  orderPlan(plan);
}

// An exercise that picks keys by weak keys or at random takes the keys of the day (and types to go
// with them), when there are some.
function useDayKeys(t: Exercise, it: PlanItem, plan: Plan): void {
  if (!plan.dayKeys?.length || !['weak', 'random'].includes(t.keyMode || 'weak')) return;
  it.keys = plan.dayKeys.slice(0, Math.max(1, Math.min(t.keysPerSession || 1, plan.dayKeys.length)));
  if (t.vary) it.types = chooseTypes(t.vary, it.keys.length, itemStats().get(t.id)?.types || [], Math.random, typeCounts());
}

// Puts a tune or exercise into today's set (from its details). False if it's already there.
export function addToToday(t: Item): boolean {
  ensurePlan();
  const plan = store.state.plan!;
  if (inToday(t)) return false;
  plan.items.push(makePlanItem(t, itemStats(), t.focus ? 'focus' : bucketOf(t)));
  plan.skipped = (plan.skipped || []).filter((id) => id !== t.id);
  plan.focusSkipped = (plan.focusSkipped || []).filter((id) => id !== t.id); // (a focus one taken out earlier)
  orderPlan(plan);
  save();
  return true;
}
// Whether it's in today's set in its own right (not only as a warm-up).
export const inToday = (t: Item): boolean => !!todayItem(t);

// ---------- Changing today's instance of an item ----------
// What varies from day to day (an exercise's keys and types, a tune's key) can be changed for
// today; if it's been played already, the logged session changes with it. Not for warm-ups,
// whose keys and chords come from their tune.

// The item's own place in today's set (not a warm-up), if any.
export function todayItem(t: Item): PlanItem | null {
  const plan = store.state.plan;
  return plan?.date === dateStr() ? plan.items.find((i) => i.itemId === t.id && !i.warmup) || null : null;
}

// An exercise's keys today (roots 0–11, in order), with a type for each if it varies them.
export function setTodayKeys(it: PlanItem, keys: Key[], types: string[] | null = null): void {
  it.keys = [...keys];
  if (types) it.types = [...types];
  else delete it.types;
  const e = planEntry(it);
  if (e) {
    if (keys.length) e.keys = [...keys];
    else delete e.keys;
    if (types?.length) e.types = [...types];
    else delete e.types;
  }
  save();
}

// A tune's key today (0–23). Its unplayed warm-ups are made again in the new key.
export function setTodayKey(it: PlanItem, key: Key | null): void {
  const t = itemById(it.itemId);
  it.key = key;
  it.alt = key != null && !!t?.keys?.length && !t.keys.includes(key);
  it.shift = null;
  const e = planEntry(it);
  if (e) { e.key = key; e.alt = it.alt; e.shift = null; }
  const plan = store.state.plan!;
  const redo = plan.items.filter((i) => i.warmup === it.itemId && !isPlanItemPlayed(i)).length;
  if (t?.type === 'tune' && redo) { // (only tunes have warm-ups)
    plan.items = plan.items.filter((i) => i.warmup !== it.itemId || isPlanItemPlayed(i));
    addWarmups(t, redo); // as many as it had, in the new key
  }
  save();
}

// Swaps the warm-up at index i of today's set for another (see altWarmup). False if there's none.
export function swapWarmup(i: number, plan: Plan = store.state.plan!): boolean {
  const it = plan.items[i];
  const t = it?.warmup && itemById(it.warmup);
  if (!t || t.type !== 'tune') return false; // (a warm-up is always for a tune)
  const tuneItem = plan.items.find((x) => x.itemId === it.warmup && !x.warmup);
  const have = plan.items.filter((x) => x !== it && x.warmup === it.warmup);
  const alt = altWarmup(t, it, { key: tuneItem?.key ?? null, have });
  if (!alt) return false;
  plan.items[i] = alt;
  return true;
}

// Another focus tune or exercise (same type as t) for today's set, at random: one not in it or
// taken out today. Null if there's none.
export function pickFocus(t: Item): Item | null {
  const plan = store.state.plan!;
  const pool = store.state.items.filter((x) => x.type === t.type && x.focus && x.id !== t.id
    && !(plan.focusSkipped || []).includes(x.id) && !plan.items.some((i) => i.itemId === x.id && !i.warmup));
  return pool.length ? randomOf(pool) : null;
}

// Unplayed warm-ups for tunes no longer in today's set go (in any setting).
export function dropOrphanWarmups(plan: Plan = store.state.plan!): void {
  const tunes = new Set(plan.items.filter((it) => !it.warmup).map((it) => it.itemId));
  plan.items = plan.items.filter((it) => !it.warmup || tunes.has(it.warmup) || isPlanItemPlayed(it));
}

// The order of today's set: exercises, then tunes, focus ones first; the rest mixed up (each tune
// has a random `mix` for the day, so the order holds) or by group (hone, learn, new), as set.
// Each tune's warm-ups go just before it. Warm-ups for a tune that isn't in the set go with the
// exercises.
export function orderPlan(plan: Plan = store.state.plan!): void {
  const { tuneOrder } = store.state.settings;
  const isTune = (it: PlanItem) => itemById(it.itemId)?.type === 'tune';
  const ownTune = (it: PlanItem) => it.warmup && plan.items.some((x) => !x.warmup && x.itemId === it.warmup);
  for (const it of plan.items) if (typeof it.mix !== 'number') it.mix = Math.random();
  const mixed = (tuneOrder || 'mixed') === 'mixed';
  const rank = (it: PlanItem) => {
    if (!isTune(it)) return it.bucket === 'focus' ? -2 : -1; // exercises up top (focus ones first)
    if (mixed && isTune(it) && it.bucket !== 'focus') return 2 + it.mix!; // after focus and exercises
    return BUCKET_ORDER[it.bucket] ?? 9;
  };
  const main = plan.items.filter((it) => !ownTune(it));
  main.sort((a, b) => rank(a) - rank(b));
  plan.items = main.flatMap((it) => [...plan.items.filter((w) => ownTune(w) && w.warmup === it.itemId), it]);
}

// After the exercise setting changes: picks today's exercises again (keeping played ones,
// focus ones, and the tunes), then applies the setting.
export function refreshExercises(): void {
  const plan = store.state.plan;
  if (!plan || plan.date !== dateStr()) return buildPlan(); // made with the current setting
  syncFocus();
  repickExercises(plan);
}

function repickExercises(plan: Plan) {
  const drop = (it: PlanItem) => it.bucket === 'exercise' && !it.warmup && !isPlanItemPlayed(it); // warm-ups you added stay
  plan.items = plan.items.filter((it) => !drop(it));
  delete plan.dayKeys;
  fill(plan, 'exercise', excludedIds(), itemStats());
  applyExerciseFocus(plan);
  save();
}

// Adds `n` warm-ups for a tune to today's set, just before it (and the tune, if it isn't there):
// the next ones nextWarmups suggests. Returns how many were added.
export function addWarmups(t: Tune, n = 1): number {
  ensurePlan();
  const plan = store.state.plan!;
  if (!todayItem(t)) addToToday(t);
  const key = todayItem(t)?.key ?? null;
  const have = plan.items.filter((i) => i.warmup === t.id);
  const warm = nextWarmups(t, { key, have, avoid: new Set(plan.items.map((i) => i.itemId)), n });
  if (!warm.length) return 0;
  plan.items.push(...warm);
  plan.skipped = (plan.skipped || []).filter((id) => !warm.some((w) => w.itemId === id));
  orderPlan(plan);
  save();
  return warm.length;
}

// Try exercise x through a tune: adds the next tune to try it with to today's set (if it isn't
// there), with x as a warm-up just before it. Suggested: one of today's tunes, else one whose chords
// it fits, else one you know; not one it's already before today. Returns the tune, or null.
// tune: the one to try it with (picked), or null to have one suggested.
export function tryWithTune(x: Exercise, tune: Tune | null = null): Tune | null {
  ensurePlan();
  const plan = store.state.plan!;
  const stats = itemStats();
  const has = (t: Tune) => plan.items.some((i) => i.itemId === x.id && i.warmup === t.id);
  const tunes = store.state.items.filter((t): t is Tune => t.type === 'tune' && !t.off && !!chartFor(t) && !has(t));
  const today = tunes.filter((t) => todayItem(t) && !isPlanItemPlayed(todayItem(t)!));
  const fit = tunes.filter((t) => fitsTune(x, t));
  const known = tunes.filter((t) => t.level >= 1);
  const pool = fit.length ? fit : known.length ? known : tunes;
  const t = tune || today[0] || weightedPick(pool, (u) => weightFor(u, stats, bucketOf(u))) || randomOf(pool);
  if (!t) return null;
  if (!todayItem(t)) addToToday(t);
  const item = warmupOf(t, x, { key: todayItem(t)?.key ?? null });
  if (!item) return null;
  plan.items.push(item);
  orderPlan(plan);
  save();
  return t;
}

// Tunes to try exercise x with, best first: today's, then ones whose chords it fits, then ones you
// know, then the rest (each by name); none it's already before today.
export function tunesToTry(x: Exercise) {
  const plan = store.state.plan;
  const has = (t: Tune) => plan?.items.some((i) => i.itemId === x.id && i.warmup === t.id);
  const tunes = store.state.items.filter((t): t is Tune => t.type === 'tune' && !t.off && !!chartFor(t) && !has(t)).sort((a, b) => a.name.localeCompare(b.name));
  const today = tunes.filter((t) => todayItem(t));
  const fit = tunes.filter((t) => !todayItem(t) && fitsTune(x, t));
  const rest = tunes.filter((t) => !todayItem(t) && !fit.includes(t));
  return { today, fit, known: rest.filter((t) => t.level >= 1), other: rest.filter((t) => !(t.level >= 1)) };
}

// Puts warm-up `item` (from warmupChoices) before tune t in today's set (adding the tune if need be).
export function addWarmup(t: Tune, item: PlanItem): void {
  ensurePlan();
  const plan = store.state.plan!;
  if (!todayItem(t)) addToToday(t);
  plan.items.push({ ...item, pid: uid() });
  orderPlan(plan);
  save();
}

export function excludedIds(): Set<Id> {
  const plan = store.state.plan;
  const ex = new Set<Id>(plan?.skipped || []);
  for (const it of plan?.items || []) ex.add(it.itemId);
  return ex;
}

// keepPlayed: rebuild today's set but keep whatever has already been played.
export function buildPlan(keepPlayed = false): void {
  const state = store.state;
  const stats = itemStats();
  const today = dateStr();
  const prev = keepPlayed && state.plan?.date === today ? state.plan : null;
  const kept = prev ? prev.items.filter((it) => isPlanItemPlayed(it)) : [];
  const exclude = new Set(prev ? [...prev.skipped, ...prev.items.map((i) => i.itemId)] : []);
  const items = [...kept];
  state.plan = {
    date: today,
    withExercises: true,
    items,
    skipped: prev ? [...exclude].filter((id) => !items.some((i) => i.itemId === id)) : [],
    focusSkipped: prev?.focusSkipped || [],
    ...(prev?.dayKeys ? { dayKeys: prev.dayKeys } : {}),
  } as Plan; // (its mode is set by applyExerciseFocus, below)
  syncFocus(); // (the focus ones first, then the rest of the exercises and tunes)
  fill(state.plan, 'exercise', exclude, stats);
  fill(state.plan, 'tune', exclude, stats);
  applyExerciseFocus(state.plan);
  save();
}

// Focus on or off. Turned on, it's in today's set straight away (whatever the daily number).
export function setFocus(t: Item, on: boolean): void {
  t.focus = !!on;
  if (store.state.plan?.date !== dateStr()) return;
  if (t.focus) {
    store.state.plan!.focusSkipped = (store.state.plan!.focusSkipped || []).filter((x) => x !== t.id);
    addToToday(t);
  }
  syncFocus();
}

type ItemStatus = 'focus' | 'on' | 'off';

// A tune or exercise is 'focus' (comes up first, a few a day), 'on' (can be picked) or 'off' (left out:
// not picked, nor offered as a warm-up), for practicing from a smaller pool for a while.
export const itemStatus = (t: Item): ItemStatus => (t.focus ? 'focus' : t.off ? 'off' : 'on');
export function setItemStatus(t: Item, status: ItemStatus): void {
  if (status === 'off') t.off = true;
  else delete t.off;
  setFocus(t, status === 'focus');
}

// Focus items are in every day's set (among the day's number of each) unless skipped for today.
export function syncFocus(): void {
  const plan = store.state.plan!;
  plan.focusSkipped ||= [];
  const stats = itemStats();
  for (const it of plan.items) {
    const t = itemById(it.itemId);
    if (!t || it.warmup) continue;
    if (t.focus) it.bucket = 'focus';
    else if (it.bucket === 'focus') it.bucket = bucketOf(t);
  }
  // Up to half the day's tunes and exercises (rounded up), taking turns.
  const s = store.state.settings;
  for (const [type, max] of [['tune', Math.ceil((s.tunes ?? 4) / 2)], ['exercise', Math.ceil((s.exercises ?? 2) / 2)]] as const) {
    // (Ones taken out for today count: their place isn't filled by another.)
    const inSet = plan.items.filter((i) => i.bucket === 'focus' && !i.warmup && itemById(i.itemId)?.type === type).length
      + plan.focusSkipped.filter((id) => itemById(id)?.type === type && itemById(id)!.focus).length;
    addFocus(plan, type, max - inSet, stats);
  }
  orderPlan(plan);
}
// n more focus items of a type, least recently played first.
function addFocus(plan: Plan, type: Item['type'], n: number, stats: Stats): void {
  const next = store.state.items
    .filter((t) => t.type === type && t.focus && !onlyWithTunes(t) && !(plan.focusSkipped || []).includes(t.id) && !plan.items.some((i) => i.itemId === t.id && !i.warmup))
    .sort((a, b) => (stats.get(a.id)?.last || '').localeCompare(stats.get(b.id)?.last || ''));
  for (const t of next.slice(0, Math.max(0, n))) plan.items.push(makePlanItem(t, stats, 'focus'));
}

export function ensurePlan(): void {
  const plan = store.state.plan;
  if (!plan || plan.date !== dateStr()) {
    invalidateUndo(); // (a new day's set: an undo from before would put yesterday's back)
    return buildPlan();
  }
  // A set made before exercises existed (e.g. earlier today, before an update): add them once.
  if (!plan.withExercises) {
    fill(plan, 'exercise', excludedIds(), itemStats());
    plan.withExercises = true;
    save();
  }
  syncFocus();
  // Made with another exercise setting: picked again. One from before there were settings for this
  // (no mode) keeps the exercises already shown, and just gets what the setting adds.
  const mode = store.state.settings.exerciseFocus || 'own';
  if (plan.mode == null) { applyExerciseFocus(plan); save(); }
  else if (plan.mode !== mode) repickExercises(plan);
}

// Picks today's keys (and types) for an exercise again, after how it picks its keys changes (unless
// it's already been played today). With no key, there are none.
export function refreshKeys(t: Exercise): void {
  const item = todayItem(t);
  if (!item || isPlanItemPlayed(item)) return;
  const fresh = makePlanItem(t, itemStats(), item.bucket);
  item.keys = fresh.keys;
  if (fresh.types) item.types = fresh.types;
  else delete item.types;
  const plan = store.state.plan!; // (it's in today's set)
  if (plan.mode === 'day') useDayKeys(t, item, plan);
}

// Picks today's scale or chord types for an exercise again, after its settings change (unless
// it's already been played today). `types` asks for particular ones, in key order.
export function refreshTypes(t: Exercise, types: string[] | null = null): void {
  const item = todayItem(t);
  if (!item || isPlanItemPlayed(item)) return;
  if (!t.vary) { delete item.types; return; }
  const count = Math.max(1, item.keys?.length || 0);
  const wanted = (types || []).filter((id) => t.vary!.types.includes(id)).slice(0, count);
  const rest = chooseTypes(t.vary, count - wanted.length, itemStats().get(t.id)?.types || []);
  item.types = [...wanted, ...rest];
}
