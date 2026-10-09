import { store } from './store.js';
import { BASE_INTERVAL, MAX_INTERVAL, LEVELS, SOLID_TO_LEVEL_UP, ROUGH_TO_LEVEL_DOWN } from './constants.js';
import { dateStr, daysBetween, addDays } from './dates.js';
import { uid } from './util.js';
import { entryKeys } from './keystats.js';

export const itemById = (id) => store.state.items.find((t) => t.id === id);

// Per-item totals from the practice log:
//   { count, last, keys: [keys played, oldest first], keyLast: { root: last date in that key } }
export function itemStats() {
  const stats = new Map();
  const log = [...store.state.log].sort((a, b) => a.date.localeCompare(b.date) || (a.at || 0) - (b.at || 0));
  for (const e of log) {
    let s = stats.get(e.itemId);
    if (!s) stats.set(e.itemId, (s = { count: 0, last: null, keys: [], keyLast: {}, types: [] }));
    s.count++;
    if (!s.last || e.date > s.last) s.last = e.date;
    if (e.types) s.types.push(...e.types);
    for (const k of entryKeys(e)) {
      s.keys.push(k);
      s.keyLast[k % 12] = e.date;
    }
  }
  return stats;
}

// ---------- Spaced repetition ----------

// How overdue an item is: 1 = due today, 2 = twice its interval since last played.
export function overdue(t, stats) {
  const last = stats.get(t.id)?.last;
  if (!last) return 2;
  const since = daysBetween(last, dateStr());
  if (since <= 0) return 0;
  return since / (t.ivl || BASE_INTERVAL[t.level]);
}

export function isDue(t, stats) {
  return t.level >= 1 && (!t.due || t.due <= dateStr()) && stats.get(t.id)?.last !== dateStr();
}

// Set the next review from a rating, starting from the interval before today's session.
export function schedule(t, rating, prev) {
  const base = BASE_INTERVAL[t.level];
  const p = prev.ivl || base;
  let ivl;
  if (rating === 'rough') ivl = 1;
  else if (rating === 'solid') ivl = Math.max(Math.round(base * 1.5), Math.round(p * 2.5));
  else ivl = Math.max(base, Math.round(p * 1.6));
  // The very first time through, don't jump ahead too far.
  if (!prev.ivl && rating !== 'rough') ivl = rating === 'solid' ? Math.round(base * 1.5) : base;
  t.ivl = Math.min(ivl, MAX_INTERVAL[t.level]);
  t.due = addDays(dateStr(), t.ivl);
}

// ---------- Logging ----------

export function todaysEntry(itemId) {
  const today = dateStr();
  return store.state.log.find((e) => e.itemId === itemId && e.date === today);
}
export function isPlayedToday(itemId) {
  return !!todaysEntry(itemId);
}

// An exercise can be in today's set more than once (a warm-up before two tunes), so each plan
// item has an id (pid) and its log entry records it. A plan item's entry: the one logged from it,
// else one logged for the same item outside the set (from its details, or before pids).
export function planEntry(it) {
  const today = dateStr();
  const mine = store.state.log.filter((e) => e.itemId === it.itemId && e.date === today);
  const inPlan = (pid) => store.state.plan?.items.some((i) => i.pid === pid);
  return mine.find((e) => it.pid && e.pid === it.pid) || mine.find((e) => !e.pid || !inPlan(e.pid)) || null;
}
const entryFor = (itemId, planItem) => (planItem?.pid ? planEntry({ ...planItem, itemId }) : todaysEntry(itemId));
export const isPlanItemPlayed = (it) => !!planEntry(it);

// Where a played item's tempo comes from: a warm-up is played at its tune's tempo.
export const tempoSource = (t, planItem) => (planItem?.warmup && itemById(planItem.warmup)) || t;

export function markPlayed(itemId, planItem) {
  if (entryFor(itemId, planItem)) return;
  const t = itemById(itemId);
  // Played again today (before another tune): scheduled from where it was this morning.
  const earlier = todaysEntry(itemId);
  const entry = {
    id: uid(), date: dateStr(), itemId, at: Date.now(),
    ...(planItem?.pid ? { pid: planItem.pid } : {}),
    key: planItem?.key ?? null, alt: !!planItem?.alt, shift: planItem?.shift ?? null,
    ...(planItem?.keys?.length ? { keys: [...planItem.keys] } : {}),
    ...(planItem?.types?.length ? { types: [...planItem.types] } : {}),
    ...(planItem?.prog ? { progName: planItem.prog.name } : {}),
    rating: 'ok', prev: earlier ? { ...earlier.prev } : { ivl: t.ivl, due: t.due },
    ...(tempoSource(t, planItem).tempo ? { bpm: tempoSource(t, planItem).tempo } : {}),
    ...(planItem?.warmup ? { warmup: planItem.warmup } : {}), // played as a warm-up for that tune
  };
  store.state.log.push(entry);
  schedule(t, entry.rating, entry.prev);
}
export function rate(itemId, rating, planItem = null) {
  const e = entryFor(itemId, planItem);
  const t = itemById(itemId);
  if (!e || !t) return;
  e.rating = rating;
  schedule(t, rating, e.prev);
}
// Deletes a tune or exercise with its practice history and takes it out of today's set.
// Diary notes about it are kept, no longer linked to it. Returns how many sessions went.
export function deleteItem(id) {
  const s = store.state;
  const sessions = s.log.filter((e) => e.itemId === id).length;
  s.items = s.items.filter((x) => x.id !== id);
  s.log = s.log.filter((e) => e.itemId !== id);
  if (s.plan) {
    // Its warm-ups go too, unless played (they stay, as plain exercises, so their entries still
    // belong to them).
    s.plan.items = s.plan.items.filter((i) => i.itemId !== id && (i.warmup !== id || planEntry(i)));
    for (const i of s.plan.items) if (i.warmup === id) delete i.warmup;
    s.plan.skipped = (s.plan.skipped || []).filter((x) => x !== id);
    s.plan.focusSkipped = (s.plan.focusSkipped || []).filter((x) => x !== id);
  }
  for (const e of s.diary) if (e.itemId === id) e.itemId = null;
  return { sessions };
}

export function unmarkPlayed(itemId, planItem = null) {
  const e = entryFor(itemId, planItem);
  if (!e) return;
  store.state.log = store.state.log.filter((x) => x !== e);
  const t = itemById(itemId);
  if (!t || !e.prev) return;
  // Still played earlier today: scheduled by that; otherwise back to how it was.
  const other = todaysEntry(itemId);
  if (other) schedule(t, other.rating, other.prev);
  else { t.ivl = e.prev.ivl; t.due = e.prev.due; }
}

// ---------- Familiarity ----------

// Ratings logged before a level change no longer count toward level suggestions, and an
// item played today is rescheduled for its new level.
export function setLevel(t, level) {
  if (t.level === level) return;
  t.level = level;
  t.levelSetAt = Date.now();
  const e = todaysEntry(t.id);
  if (e) schedule(t, e.rating, e.prev);
}

// Newest-first entries, one per day (the latest): an exercise played as warm-ups before several
// tunes is still one day's session for suggestions.
export function latestPerDay(entries) {
  const seen = new Set();
  return entries.filter((e) => !seen.has(e.date) && seen.add(e.date));
}

// Suggest moving up after a run of solid sessions, or down after a run of rough ones.
export function levelSuggestion(t) {
  const recent = latestPerDay(store.state.log
    .filter((e) => e.itemId === t.id && (e.at || 0) > (t.levelSetAt || 0))
    .sort((a, b) => b.date.localeCompare(a.date) || (b.at || 0) - (a.at || 0)));
  const streak = (rating, n) => recent.length >= n && recent.slice(0, n).every((e) => e.rating === rating);
  if (t.level !== 3 && streak('solid', SOLID_TO_LEVEL_UP)) {
    const to = t.level == null ? 1 : t.level + 1;
    return { to, up: true, text: `${SOLID_TO_LEVEL_UP} solid sessions in a row — ready for ${LEVELS[to].label}?` };
  }
  if (t.level > 0 && streak('rough', ROUGH_TO_LEVEL_DOWN)) {
    const to = t.level - 1;
    return { to, up: false, text: `${ROUGH_TO_LEVEL_DOWN} rough sessions in a row — mark it ${LEVELS[to].label} for now?` };
  }
  return null;
}
