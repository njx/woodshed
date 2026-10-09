import { store } from './store.js';
import { chartFor } from './charts.js';
import { mainChords, scaleFor, progressions, chordKind, chordsInAbc, chordsFromText, chordChanges, chordName, roman, usesSharps } from './chords.js';
import { itemStats } from './practice.js';
import { CHORDS, SCALES } from './theory.js';
import { uid } from './util.js';

// Warm-ups for a tune, added by hand before it in today's set: exercises set to its chords, in
// the key it's played in today.
//   setup:   arpeggios (an exercise that varies the chord type) or scales on its main chords, or
//            a written exercise on one chord, over one of them;
//   changes: a written lick or pattern over part of one of its progressions (its chords from its
//            harmony or the chord symbols in its notation), or Through the changes.
// Each is a plan item: { pid, itemId, bucket: 'exercise', keys, types?, prog?, over?, warmup: tune id }.
const exercises = () => store.state.items.filter((x) => x.type === 'exercise');
const count = (x, fallback) => Math.max(2, Math.min(4, x.keysPerSession || fallback));

const warmItem = (x, t, keys, types = null, extra = {}) => ({
  pid: uid(), itemId: x.id, bucket: 'exercise', key: null, keys, ...(types ? { types } : {}), alt: false, shift: null, warmup: t.id, ...extra,
});
const progItem = (x, t, prog, up) => warmItem(x, t, [up(prog.target)], null, {
  prog: { name: prog.name, chords: prog.chords.map(({ d, family }) => ({ d, family })) },
});

// ---------- Written exercises over a tune's chords ----------

// The chords a written exercise goes with, as written (in C): its own list (`harmony`, typed in
// its details), else the chord symbols in its notation. A chord repeated in a row counts once.
export function harmonyOf(x) {
  if (!x || x.vary || x.fromTune) return [];
  return chordChanges(x.harmony ? chordsFromText(x.harmony) || [] : chordsInAbc(x.abc));
}

// Where a written exercise fits in a chart: a stretch of one of its progressions with the same
// kinds of chord and the same root movement (so a ii–V lick fits the end of a iii–VI–ii–V–I), or,
// for one chord, one of its main chords. Each fit: { keys: [the key to play it in], over, overKey? }.
function fitsIn(x, chart, up, sharps) {
  const h = harmonyOf(x);
  if (!h.length) return [];
  const out = [];
  const seen = new Set();
  const add = (fit) => {
    const id = `${fit.over}@${fit.keys.join(',')}`;
    if (!seen.has(id)) { seen.add(id); out.push(fit); }
  };
  if (h.length === 1) {
    for (const c of mainChords(chart, 6)) {
      if (chordKind(c.family) !== chordKind(h[0].family)) continue;
      add({ keys: [(up(c.root) - h[0].root + 12) % 12], over: chordName({ root: up(c.root), q: c.q }, { sharps }) });
    }
    return out;
  }
  const progs = progressions(chart);
  // Its first `len` chords against the progression's from chord w: the same kinds of chord, with
  // the roots moving the same way.
  const matches = (p, w, len) => w + len <= p.chords.length && h.slice(0, len).every((c, i) => {
    const pc = p.chords[w + i];
    return chordKind(c.family) === chordKind(pc.family) && (((c.root - h[0].root - (pc.d - p.chords[w].d)) % 12) + 12) % 12 === 0;
  });
  const keyAt = (p, w) => (((up(p.target) + p.chords[w].d - h[0].root) % 12) + 12) % 12;
  const overOf = (p, from, to) => ({ over: p.chords.slice(from, to).map((c) => roman(c.d, c.family)).join('–'), overKey: up(p.target) + (p.minor ? 12 : 0) });
  for (const p of progs) {
    // Through the progression as a sequence: the whole lick where it fits, else its first part
    // (two chords or more): a ii–V lick over iii–VI–ii–V goes up a step for iii–VI then on to
    // ii–V; a ii–V–I lick plays just its ii–V on iii–VI, then all of it on ii–V–I.
    // parts: how many of its chords to play in each key (null = all).
    const keys = [], parts = [];
    let start = -1, w = 0;
    while (w < p.chords.length) {
      let len = 0;
      for (let m = h.length; m >= 2; m--) if (matches(p, w, m)) { len = m; break; }
      if (!len) { if (keys.length) break; w++; continue; }
      if (start < 0) start = w;
      keys.push(keyAt(p, w));
      parts.push(len === h.length ? null : len);
      w += len;
    }
    if (keys.length >= 2) add({ keys, parts, ...overOf(p, start, w), covers: w - start });
    // And each place the whole lick fits on its own.
    for (let i = 0; i + h.length <= p.chords.length; i++) if (matches(p, i, h.length)) add({ keys: [keyAt(p, i)], ...overOf(p, i, i + h.length), covers: h.length });
  }
  out.sort((a, b) => (b.covers || 1) - (a.covers || 1));
  return out;
}

// What could go before a tune, in each of its two places, best first:
//   setup:   arpeggios or scales on its main chords, or a one-chord written exercise on one of them;
//   changes: a lick or pattern over part of one of its progressions, then Through the changes.
// Written ones played least recently come first, and ones already in today's set (`avoid`) last.
function candidates(t, { key = null, avoid = new Set() } = {}) {
  const chart = chartFor(t);
  if (!chart) return { setup: [], changes: [] };
  const playKey = key ?? t.keys?.[0] ?? chart.key ?? 0;
  const shift = (((playKey - (chart.key ?? playKey)) % 12) + 12) % 12;
  const up = (r) => (r + shift) % 12;
  const sharps = usesSharps(playKey);
  const stats = itemStats();
  const pick = (kind, category) => {
    const all = exercises().filter((x) => x.vary?.kind === kind && !x.fromTune);
    return all.find((x) => x.category === category) || all[0] || null;
  };
  const main = mainChords(chart, 6).filter((c) => CHORDS[c.family]);
  const setup = [];
  const arps = pick('chord', 'arpeggio');
  if (arps && main.length) {
    const picks = main.slice(0, count(arps, 3));
    setup.push({ kind: 'chord', item: warmItem(arps, t, picks.map((c) => up(c.root)), picks.map((c) => c.family)) });
  }
  const scales = pick('scale', 'scale');
  if (scales && main.length) {
    const byRoot = [];
    for (const c of main) if (!byRoot.some((y) => y.root === c.root)) byRoot.push(c);
    const picks = byRoot.slice(0, count(scales, 3)).map((c) => ({ root: up(c.root), scale: scaleFor(c) })).filter((y) => SCALES[y.scale]);
    if (picks.length) setup.push({ kind: 'scale', item: warmItem(scales, t, picks.map((y) => y.root), picks.map((y) => y.scale)) });
  }
  // Written exercises: least recently played first; already in today's set last.
  const order = (x) => [avoid.has(x.id) ? 1 : 0, stats.get(x.id)?.last || ''];
  const written = exercises().filter((x) => harmonyOf(x).length)
    .sort((a, b) => { const [p, q] = [order(a), order(b)]; return p[0] - q[0] || p[1].localeCompare(q[1]); });
  const changes = [];
  const later = [];
  for (const x of written) {
    const fits = fitsIn(x, chart, up, sharps);
    const items = fits.map((f) => warmItem(x, t, f.keys, null, {
      over: f.over,
      ...(f.overKey != null ? { overKey: f.overKey } : {}),
      ...(f.parts?.some((n) => n) ? { parts: f.parts } : {}),
    }));
    if (harmonyOf(x).length === 1) setup.push(...items.map((item) => ({ kind: 'written', item })));
    else (avoid.has(x.id) ? later : changes).push(...items);
  }
  const through = exercises().find((x) => x.fromTune);
  if (through) {
    for (const p of progressions(chart).filter((q) => q.chords.length >= 2 && q.chords.every((c) => CHORDS[c.family]))) changes.push(progItem(through, t, p, up));
  }
  return { setup, changes: [...changes, ...later] };
}
const same = (a, b) => a.itemId === b.itemId && String(a.keys) === String(b.keys) && (a.over || a.prog?.name || '') === (b.over || b.prog?.name || '') && String(a.types) === String(b.types);

// The next warm-ups to add before a tune (`have`: its warm-ups already in the set): taking turns
// between a lick, pattern or progression and something on its chords, starting with whichever it
// has fewer of; none it already has.
export function nextWarmups(t, { key = null, have = [], avoid = new Set(), n = 1 } = {}) {
  const { setup, changes } = candidates(t, { key, avoid });
  const lists = { setup: setup.map((c) => c.item), changes };
  const got = [...have];
  const out = [];
  for (let i = 0; i < n; i++) {
    const inSlot = (slot) => got.filter((x) => (x.slot || (x.prog || x.over ? 'changes' : 'setup')) === slot).length;
    const order = inSlot('changes') <= inSlot('setup') ? ['changes', 'setup'] : ['setup', 'changes'];
    let next = null;
    for (const slot of order) {
      const item = lists[slot].find((x) => !got.some((g) => same(g, x)));
      if (item) { next = { ...item, slot }; break; }
    }
    if (!next) break;
    got.push(next);
    out.push(next);
  }
  return out;
}

// Another warm-up in place of `it` before tune `t` (played in `key` today): the next candidate in
// its place (see candidates) that isn't one of its others (`have`). Null if there's nothing else.
export function altWarmup(t, it, { key = null, have = [] } = {}) {
  const { setup, changes } = candidates(t, { key });
  const list = it.slot === 'setup' || it.types || (!it.prog && !it.over) ? setup.map((c) => c.item) : changes;
  const at = list.findIndex((x) => same(x, it));
  for (let i = 1; i <= list.length; i++) {
    const next = list[(at + i) % list.length];
    if (!same(next, it) && !have.some((h) => same(h, next))) return { ...next, slot: it.slot };
  }
  return null;
}
