import { store } from './store.js';
import { BASE_INTERVAL, MAX_INTERVAL, LEVELS, SOLID_TO_LEVEL_UP, ROUGH_TO_LEVEL_DOWN } from './constants.js';
import { dateStr, daysBetween, addDays } from './dates.js';
import { uid } from './util.js';

export const itemById = (id) => store.state.items.find((t) => t.id === id);

// Per-item totals from the practice log: { count, last, keys: [keys played] }.
export function itemStats() {
  const stats = new Map();
  for (const e of store.state.log) {
    let s = stats.get(e.itemId);
    if (!s) stats.set(e.itemId, (s = { count: 0, last: null, keys: [] }));
    s.count++;
    if (!s.last || e.date > s.last) s.last = e.date;
    if (e.key != null) s.keys.push(e.key);
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
export function markPlayed(itemId, planItem) {
  if (isPlayedToday(itemId)) return;
  const t = itemById(itemId);
  const entry = {
    id: uid(), date: dateStr(), itemId, at: Date.now(),
    key: planItem?.key ?? null, alt: !!planItem?.alt, shift: planItem?.shift ?? null,
    rating: 'ok', prev: { ivl: t.ivl, due: t.due },
  };
  store.state.log.push(entry);
  schedule(t, entry.rating, entry.prev);
}
export function rate(itemId, rating) {
  const e = todaysEntry(itemId);
  const t = itemById(itemId);
  if (!e || !t) return;
  e.rating = rating;
  schedule(t, rating, e.prev);
}
export function unmarkPlayed(itemId) {
  const e = todaysEntry(itemId);
  if (!e) return;
  const t = itemById(itemId);
  if (t && e.prev) { t.ivl = e.prev.ivl; t.due = e.prev.due; }
  store.state.log = store.state.log.filter((x) => x !== e);
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

// Suggest moving up after a run of solid sessions, or down after a run of rough ones.
export function levelSuggestion(t) {
  const recent = store.state.log
    .filter((e) => e.itemId === t.id && (e.at || 0) > (t.levelSetAt || 0))
    .sort((a, b) => b.date.localeCompare(a.date) || (b.at || 0) - (a.at || 0));
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
