import { store, save } from './store.js';
import { BUCKETS, BUCKET_ORDER, PRIORITY_WEIGHTS, SHIFTS } from './constants.js';
import { dateStr } from './dates.js';
import { isMinor } from './keys.js';
import { weightedPick, randomOf, uid } from './util.js';
import { itemStats, overdue, itemById, isPlayedToday, isPlanItemPlayed } from './practice.js';
import { chooseExerciseKeys, keyFamiliarity } from './keystats.js';
import { chooseTypes } from './theory.js';
import { warmupsFor, prepFor } from './warmups.js';

export function bucketOf(t) {
  if (t.type === 'exercise') return 'exercise';
  if (t.level >= 2) return 'hone';
  if (t.level === 1) return 'learn';
  return 'fresh';
}

export function weightFor(t, stats, bucket) {
  const pw = PRIORITY_WEIGHTS[store.state.settings.priority] || PRIORITY_WEIGHTS.some;
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

export function wantsNewKey(t) {
  const mode = store.state.settings.newKeys;
  if (mode === 'never') return false;
  return mode === 'proficient' ? t.level >= 2 : t.level === 3;
}

// The candidates practiced least often (ties keep their order).
export function leastPracticed(candidates, played) {
  let best = [], min = Infinity;
  for (const k of candidates) {
    const n = played.filter((p) => p === k).length;
    if (n < min) { min = n; best = [k]; } else if (n === min) best.push(k);
  }
  return best;
}

// Which key to suggest: one of the usual keys, least practiced first; or for tunes you know
// well, a key outside the usual ones (same major/minor quality), least practiced first.
export function chooseKey(t, stats) {
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

export function pickItem(bucket, exclude, stats) {
  for (const b of [bucket, ...BUCKETS[bucket].fallback]) {
    // (Exercises that take their chords from a tune only come up as warm-ups.)
    const pool = store.state.items.filter((t) => !t.focus && !t.fromTune && bucketOf(t) === b && !exclude.has(t.id));
    const t = weightedPick(pool, (t) => weightFor(t, stats, b));
    if (t) return t;
  }
  return null;
}

export function makePlanItem(t, stats, bucket = bucketOf(t)) {
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
export function typeCounts(log = store.state.log) {
  const counts = {};
  for (const e of log) for (const id of e.types || []) counts[id] = (counts[id] || 0) + 1;
  return counts;
}

// ---------- How exercises relate to each other on a day (Settings → Exercises) ----------
//   own:   each exercise picks its own keys (and types);
//   day:   one or two keys of the day for all exercises that choose by weak keys or at random;
//   tunes: the exercise slots are warm-ups for one of today's tunes, in its chords.

export function applyExerciseFocus(plan = store.state.plan) {
  const mode = store.state.settings.exerciseFocus || 'own';
  if (mode === 'day') {
    if (!plan.dayKeys?.length) plan.dayKeys = chooseExerciseKeys({ keyMode: 'weak', keysPerSession: 2 }, { familiarity: keyFamiliarity() });
    for (const it of plan.items) {
      const t = itemById(it.itemId);
      if (t?.type !== 'exercise' || it.warmup || isPlayedToday(t.id) || !['weak', 'random'].includes(t.keyMode || 'weak')) continue;
      it.keys = plan.dayKeys.slice(0, Math.max(1, Math.min(t.keysPerSession || 1, plan.dayKeys.length)));
      if (t.vary) it.types = chooseTypes(t.vary, it.keys.length, itemStats().get(t.id)?.types || [], Math.random, typeCounts());
    }
  } else if (mode === 'tunes') {
    // Before each tune with a chord chart: scales or arpeggios on its chords, then one of its
    // progressions; the regular exercises stay up top. Tunes already given warm-ups today
    // (plan.prepped) keep theirs, or don't get them back if they were swapped out.
    plan.prepped ||= [];
    const tunes = plan.items.filter((it) => !it.warmup && itemById(it.itemId)?.type === 'tune');
    // Unplayed warm-ups for tunes no longer in the set go.
    plan.items = plan.items.filter((it) => !it.warmup || isPlanItemPlayed(it) || tunes.some((x) => x.itemId === it.warmup));
    let n = plan.items.filter((it) => it.warmup && it.types).length;
    for (const it of tunes) {
      if (plan.prepped.includes(it.itemId) || isPlanItemPlayed(it)) continue;
      plan.prepped.push(it.itemId);
      // Alternate between arpeggios and scales from tune to tune.
      plan.items.push(...prepFor(itemById(it.itemId), { key: it.key, prefer: n++ % 2 ? 'scale' : 'chord' }));
    }
  }
  plan.mode = mode;
  orderPlan(plan);
}

// The order of today's set: exercises, then tunes (focus first); in "From tunes", each tune's
// warm-ups go just before it. Warm-ups for a tune that isn't in the set go with the exercises.
export function orderPlan(plan = store.state.plan) {
  const tunesMode = (store.state.settings.exerciseFocus || 'own') === 'tunes';
  const isTune = (it) => itemById(it.itemId)?.type === 'tune';
  const ownTune = (it) => it.warmup && plan.items.some((x) => !x.warmup && x.itemId === it.warmup);
  const rank = (it) => (tunesMode && !isTune(it) ? -1 : BUCKET_ORDER[it.bucket] ?? 9);
  const main = plan.items.filter((it) => !ownTune(it));
  main.sort((a, b) => rank(a) - rank(b));
  plan.items = main.flatMap((it) => [...plan.items.filter((w) => ownTune(w) && w.warmup === it.itemId), it]);
}

// After the exercise setting changes: picks today's exercises again (keeping played ones,
// focus exercises, and the tunes), then applies the setting.
export function refreshExercises() {
  ensurePlan();
  repickExercises(store.state.plan);
}

function repickExercises(plan) {
  const stats = itemStats();
  const drop = (it) => it.bucket === 'exercise' && !isPlanItemPlayed(it);
  plan.items = plan.items.filter((it) => !drop(it));
  delete plan.dayKeys;
  delete plan.warmupFor;
  plan.prepped = [...new Set(plan.items.map((it) => it.warmup).filter(Boolean))]; // played ones stay
  const exclude = excludedIds();
  const have = plan.items.filter((it) => it.bucket === 'exercise' && !it.warmup).length;
  for (let i = have; i < (store.state.settings.exercises ?? 0); i++) {
    const t = pickItem('exercise', exclude, stats);
    if (!t) break;
    exclude.add(t.id);
    plan.items.push(makePlanItem(t, stats));
  }
  applyExerciseFocus(plan);
  save();
}

// Adds warm-ups for a tune to today's set (from its details), in place of any it has that haven't
// been played. Returns how many were added.
export function addWarmups(t) {
  ensurePlan();
  const plan = store.state.plan;
  const key = plan.items.find((i) => i.itemId === t.id)?.key ?? null;
  const warm = warmupsFor(t, { key });
  if (!warm.length) return 0;
  // Replaces this tune's earlier warm-ups that haven't been played.
  plan.items = [...plan.items.filter((i) => i.warmup !== t.id || isPlanItemPlayed(i)), ...warm];
  plan.prepped = [...new Set([...(plan.prepped || []), t.id])];
  plan.skipped = (plan.skipped || []).filter((id) => !warm.some((w) => w.itemId === id));
  orderPlan(plan);
  save();
  return warm.length;
}

export function excludedIds() {
  const plan = store.state.plan;
  const ex = new Set(plan?.skipped || []);
  for (const it of plan?.items || []) ex.add(it.itemId);
  return ex;
}

// keepPlayed: rebuild today's set but keep whatever has already been played.
export function buildPlan(keepPlayed = false) {
  const state = store.state;
  const stats = itemStats();
  const today = dateStr();
  const prev = keepPlayed && state.plan?.date === today ? state.plan : null;
  const kept = prev ? prev.items.filter((it) => isPlanItemPlayed(it)) : [];
  const exclude = new Set(prev ? [...prev.skipped, ...prev.items.map((i) => i.itemId)] : []);
  const items = [...kept];
  const counts = { focus: 0, exercise: 0, hone: 0, learn: 0, fresh: 0 };
  kept.filter((it) => !it.warmup).forEach((it) => counts[it.bucket]++);
  // How many of each group the daily set has (from Settings → Daily mix).
  const slots = { exercise: 'exercises', hone: 'hone', learn: 'learn', fresh: 'fresh' };
  for (const b of Object.keys(slots)) {
    for (let i = counts[b]; i < (state.settings[slots[b]] ?? 0); i++) {
      const t = pickItem(b, exclude, stats);
      if (!t) break;
      exclude.add(t.id);
      items.push(makePlanItem(t, stats));
    }
  }
  state.plan = {
    date: today,
    withExercises: true,
    items,
    skipped: prev ? [...exclude].filter((id) => !items.some((i) => i.itemId === id)) : [],
    focusSkipped: prev?.focusSkipped || [],
    prepped: prev ? [...new Set(kept.map((it) => it.warmup).filter(Boolean))] : [],
    ...(prev?.dayKeys ? { dayKeys: prev.dayKeys } : {}),
  };
  syncFocus();
  applyExerciseFocus(state.plan);
  save();
}

// Focus items are in every day's set (on top of the regular mix) unless skipped for today.
export function syncFocus() {
  const plan = store.state.plan;
  plan.focusSkipped ||= [];
  const stats = itemStats();
  for (const it of plan.items) {
    const t = itemById(it.itemId);
    if (!t || it.warmup) continue;
    if (t.focus) it.bucket = 'focus';
    else if (it.bucket === 'focus') it.bucket = bucketOf(t);
  }
  let added = false;
  for (const t of store.state.items) {
    if (t.focus && !plan.focusSkipped.includes(t.id) && !plan.items.some((i) => i.itemId === t.id && !i.warmup)) {
      plan.items.push(makePlanItem(t, stats, 'focus'));
      added = true;
    }
  }
  // A tune that just became a focus tune gets its warm-ups (once the set has been made).
  if (added && plan.mode === 'tunes') applyExerciseFocus(plan);
  else orderPlan(plan);
}

export function ensurePlan() {
  const plan = store.state.plan;
  if (!plan || plan.date !== dateStr()) return buildPlan();
  // A set made before exercises existed (e.g. earlier today, before an update): add them once.
  if (!plan.withExercises) {
    const stats = itemStats();
    const exclude = excludedIds();
    for (let i = 0; i < (store.state.settings.exercises ?? 0); i++) {
      const t = pickItem('exercise', exclude, stats);
      if (!t) break;
      exclude.add(t.id);
      plan.items.push(makePlanItem(t, stats));
    }
    plan.withExercises = true;
    save();
  }
  syncFocus();
  // Made with another exercise setting (or before this one existed): picked again.
  if (plan.mode !== (store.state.settings.exerciseFocus || 'own')) repickExercises(plan);
}

// Picks today's scale or chord types for an exercise again, after its settings change (unless
// it's already been played today). `types` asks for particular ones, in key order.
export function refreshTypes(t, types = null) {
  const plan = store.state.plan;
  const item = plan?.date === dateStr() && plan.items.find((i) => i.itemId === t.id && !i.warmup);
  if (!item || isPlanItemPlayed(item)) return;
  if (!t.vary) { delete item.types; return; }
  const count = Math.max(1, item.keys?.length || 0);
  const wanted = (types || []).filter((id) => t.vary.types.includes(id)).slice(0, count);
  const rest = chooseTypes(t.vary, count - wanted.length, itemStats().get(t.id)?.types || []);
  item.types = [...wanted, ...rest];
}
