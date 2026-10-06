import { store } from './store.js';
import { CYCLE_OF_FOURTHS } from './constants.js';
import { dateStr, daysBetween } from './dates.js';
import { randomOf } from './util.js';

// How familiar each key is, from everything in the practice log (tunes and exercises).
// Keys are compared by root (C, D♭, … B), so Cm and C count toward the same key.
// Each session counts for less as it gets older (half as much after about 3 weeks), and rough
// sessions count for less than solid ones.
const HALF_LIFE_DAYS = 21;
const RATING_WEIGHT = { rough: 0.5, ok: 1, solid: 1.5 };

export const entryKeys = (e) => (e.keys?.length ? e.keys : e.key != null ? [e.key] : []);

export function keyFamiliarity(log = store.state.log, today = dateStr()) {
  const score = Array(12).fill(0);
  for (const e of log) {
    const decay = Math.pow(0.5, Math.max(0, daysBetween(e.date, today)) / HALF_LIFE_DAYS);
    for (const k of entryKeys(e)) score[k % 12] += decay * (RATING_WEIGHT[e.rating] ?? 1);
  }
  return score;
}

// Sessions per key in the last n days, for display.
export function keySessions(days = 30, log = store.state.log, today = dateStr()) {
  const n = Array(12).fill(0);
  for (const e of log) {
    if (daysBetween(e.date, today) >= days) continue;
    for (const k of entryKeys(e)) n[k % 12]++;
  }
  return n;
}

// Pick count items from candidates without repeats, weighted.
function sample(candidates, count, weight) {
  const pool = [...candidates];
  const out = [];
  while (out.length < count && pool.length) {
    const ws = pool.map(weight);
    const total = ws.reduce((a, b) => a + b, 0);
    let r = Math.random() * total;
    let i = 0;
    while (i < pool.length - 1 && (r -= ws[i]) > 0) i++;
    out.push(pool.splice(i, 1)[0]);
  }
  return out;
}

// The keys (roots 0–11) to practice an exercise in this session.
// played: this exercise's past keys, oldest first; lastPlayed: { root: 'YYYY-MM-DD' }.
export function chooseExerciseKeys(t, { played = [], lastPlayed = {}, familiarity, today = dateStr() } = {}) {
  const mode = t.keyMode || 'weak';
  const n = Math.max(1, Math.min(12, t.keysPerSession || 1));
  if (mode === 'none') return [];
  const all = [...Array(12).keys()];

  if (mode === 'fourths' || mode === 'chromatic') {
    const order = mode === 'fourths' ? CYCLE_OF_FOURTHS : all;
    // Pick up after the last key played; the first time, start anywhere.
    const last = played.length ? played[played.length - 1] % 12 : null;
    const start = last == null ? Math.floor(Math.random() * 12) : (order.indexOf(last) + 1) % 12;
    return Array.from({ length: n }, (_, i) => order[(start + i) % 12]);
  }
  if (mode === 'random') return sample(all, n, () => 1);
  if (mode === 'fixed') {
    const chosen = (t.keys || []).map((k) => k % 12);
    if (!chosen.length) return [randomOf(all)];
    const count = (k) => played.filter((p) => p % 12 === k).length;
    return [...chosen].sort((a, b) => count(a) - count(b)).slice(0, n);
  }
  // Weak keys: favour keys you know least overall, and ones this exercise hasn't been played in
  // for a while. (A key with half the practice of another comes up roughly 2–3 times as often.)
  const fam = familiarity || keyFamiliarity();
  return sample(all, n, (k) => {
    const days = lastPlayed[k] ? daysBetween(lastPlayed[k], today) : 30;
    const recency = 0.25 + Math.min(days, 14) / 14;
    return recency / Math.pow(0.5 + fam[k], 1.5);
  });
}
