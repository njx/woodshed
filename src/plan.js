import { store, save } from './store.js';
import { BUCKETS, BUCKET_ORDER, PRIORITY_WEIGHTS, SHIFTS } from './constants.js';
import { dateStr } from './dates.js';
import { isMinor } from './keys.js';
import { weightedPick, randomOf } from './util.js';
import { itemStats, overdue, itemById, isPlayedToday } from './practice.js';

export function bucketOf(t) {
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
    return { key: randomOf(leastPracticed(others, played)), alt: true, shift: null };
  }
  if (!t.keys.length) return { key: null, alt: false, shift: null };
  return { key: leastPracticed(t.keys, played)[0], alt: false, shift: null };
}

export function pickItem(bucket, exclude, stats) {
  for (const b of [bucket, ...BUCKETS[bucket].fallback]) {
    const pool = store.state.items.filter((t) => !t.focus && bucketOf(t) === b && !exclude.has(t.id));
    const t = weightedPick(pool, (t) => weightFor(t, stats, b));
    if (t) return t;
  }
  return null;
}

export function makePlanItem(t, stats, bucket = bucketOf(t)) {
  return { itemId: t.id, bucket, ...chooseKey(t, stats) };
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
  const kept = prev ? prev.items.filter((it) => isPlayedToday(it.itemId)) : [];
  const exclude = new Set(prev ? [...prev.skipped, ...prev.items.map((i) => i.itemId)] : []);
  const items = [...kept];
  const counts = { focus: 0, hone: 0, learn: 0, fresh: 0 };
  kept.forEach((it) => counts[it.bucket]++);
  for (const b of ['hone', 'learn', 'fresh']) {
    for (let i = counts[b]; i < state.settings[b]; i++) {
      const t = pickItem(b, exclude, stats);
      if (!t) break;
      exclude.add(t.id);
      items.push(makePlanItem(t, stats));
    }
  }
  state.plan = {
    date: today,
    items,
    skipped: prev ? [...exclude].filter((id) => !items.some((i) => i.itemId === id)) : [],
    focusSkipped: prev?.focusSkipped || [],
  };
  syncFocus();
  save();
}

// Focus items are in every day's set (on top of the regular mix) unless skipped for today.
export function syncFocus() {
  const plan = store.state.plan;
  plan.focusSkipped ||= [];
  const stats = itemStats();
  for (const it of plan.items) {
    const t = itemById(it.itemId);
    if (!t) continue;
    if (t.focus) it.bucket = 'focus';
    else if (it.bucket === 'focus') it.bucket = bucketOf(t);
  }
  for (const t of store.state.items) {
    if (t.focus && !plan.focusSkipped.includes(t.id) && !plan.items.some((i) => i.itemId === t.id)) {
      plan.items.push(makePlanItem(t, stats, 'focus'));
    }
  }
  plan.items.sort((a, b) => BUCKET_ORDER[a.bucket] - BUCKET_ORDER[b.bucket]);
}

export function ensurePlan() {
  if (!store.state.plan || store.state.plan.date !== dateStr()) buildPlan();
  else syncFocus();
}
