import { store } from './store.js';
import { homeKey } from './abc.js';
import { chartFor } from './charts.js';
import { mainChords, scaleFor, progressions, chordKind, chordsInAbc, chordsFromText, chordChanges, chordName, roman, usesSharps } from './chords.js';
import { itemStats } from './practice.js';
import { CHORDS, SCALES } from './theory.js';
import { uid } from './util.js';
import type { ChartProgression, FamilyChord } from './chords.js';
import type { Category, Chart, Exercise, Id, Key, PlanItem, ScaleType, Tune, Vary } from './types.js';

type Slot = 'setup' | 'changes';
// Where a written exercise fits in a chart (see fitsIn).
interface Fit { keys: Key[]; over: string; overKey?: Key; parts?: (number | null)[]; covers?: number }
// A warm-up on a tune's chords (see candidates).
interface SetupCandidate { kind: 'chord' | 'scale' | 'written'; item: PlanItem }

// Warm-ups for a tune, added by hand before it in today's set: exercises set to its chords, in
// the key it's played in today.
//   setup:   arpeggios (an exercise that varies the chord type) or scales on its main chords, or
//            a written exercise on one chord, over one of them;
//   changes: a written lick or pattern over part of one of its progressions (its chords from its
//            harmony or the chord symbols in its notation), or Through the changes.
// Each is a plan item: { pid, itemId, bucket: 'exercise', keys, types?, prog?, over?, warmup: tune id }.
// (Not ones turned off, or ones not for tunes: technical exercises like long tones.)
const exercises = (): Exercise[] => store.state.items.filter((x): x is Exercise => x.type === 'exercise' && !x.off && !x.solo);
const count = (x: Exercise, fallback: number) => Math.max(2, Math.min(4, x.keysPerSession || fallback));

const warmItem = (x: Exercise, t: Tune, keys: Key[], types: string[] | null = null, extra: Partial<PlanItem> = {}): PlanItem => ({
  pid: uid(), itemId: x.id, bucket: 'exercise', key: null, keys, ...(types ? { types } : {}), alt: false, shift: null, warmup: t.id, ...extra,
});
const progItem = (x: Exercise, t: Tune, prog: ChartProgression, up: (r: number) => number) => warmItem(x, t, [up(prog.target)], null, {
  prog: { name: prog.name, chords: prog.chords.map(({ d, family }) => ({ d, family })) },
});

// ---------- Written exercises over a tune's chords ----------

// The chords a written exercise goes with, as written (in C): its own list (`harmony`, typed in
// its details), else the chord symbols in its notation. A chord repeated in a row counts once.
export function harmonyOf(x: Exercise | null): FamilyChord[] {
  if (!x || x.vary || x.fromTune) return [];
  return chordChanges(x.harmony ? chordsFromText(x.harmony) || [] : chordsInAbc(x.abc));
}

// Where a written exercise fits in a chart: a stretch of one of its progressions with the same
// kinds of chord and the same root movement (so a ii–V lick fits the end of a iii–VI–ii–V–I), or,
// for one chord, one of its main chords. Each fit: { keys: [the key to play it in], over, overKey? }.
function fitsIn(x: Exercise, chart: Chart, up: (r: number) => number, sharps: boolean): Fit[] {
  const h = harmonyOf(x);
  const home = homeKey(x) % 12; // keys are the keys it's played in, counted from the one it's written in
  if (!h.length) return [];
  const out: Fit[] = [];
  const seen = new Set<string>();
  const add = (fit: Fit) => {
    const id = `${fit.over}@${fit.keys.join(',')}`;
    if (!seen.has(id)) { seen.add(id); out.push(fit); }
  };
  if (h.length === 1) {
    for (const c of mainChords(chart, 6)) {
      if (chordKind(c.family) !== chordKind(h[0].family)) continue;
      add({ keys: [(up(c.root) - h[0].root + home + 12) % 12], over: chordName({ root: up(c.root), q: c.q }, { sharps }) });
    }
    return out;
  }
  const progs = progressions(chart);
  // Its first `len` chords against the progression's from chord w: the same kinds of chord, with
  // the roots moving the same way.
  const matches = (p: ChartProgression, w: number, len: number) => w + len <= p.chords.length && h.slice(0, len).every((c, i) => {
    const pc = p.chords[w + i];
    return chordKind(c.family) === chordKind(pc.family) && (((c.root - h[0].root - (pc.d - p.chords[w].d)) % 12) + 12) % 12 === 0;
  });
  const keyAt = (p: ChartProgression, w: number) => (((up(p.target) + p.chords[w].d - h[0].root + home) % 12) + 12) % 12;
  const overOf = (p: ChartProgression, from: number, to: number) => ({ over: p.chords.slice(from, to).map((c) => roman(c.d, c.family)).join('–'), overKey: up(p.target) + (p.minor ? 12 : 0) });
  for (const p of progs) {
    // Through the progression as a sequence: the whole lick where it fits, else its first part
    // (two chords or more): a ii–V lick over iii–VI–ii–V goes up a step for iii–VI then on to
    // ii–V; a ii–V–I lick plays just its ii–V on iii–VI, then all of it on ii–V–I.
    // parts: how many of its chords to play in each key (null = all).
    const keys: Key[] = [], parts: (number | null)[] = [];
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
function candidates(t: Tune, { key = null, avoid = new Set() }: { key?: Key | null; avoid?: Set<Id> } = {}):
  { setup: SetupCandidate[]; changes: PlanItem[] } {
  const chart = chartFor(t);
  if (!chart) return { setup: [], changes: [] };
  const playKey = key ?? t.keys?.[0] ?? chart.key ?? 0;
  const shift = (((playKey - (chart.key ?? playKey)) % 12) + 12) % 12;
  const up = (r: number) => (r + shift) % 12;
  const sharps = usesSharps(playKey);
  const stats = itemStats();
  const pick = (kind: Vary['kind'], category: Category) => {
    const all = exercises().filter((x) => x.vary?.kind === kind && !x.fromTune);
    return all.find((x) => x.category === category) || all[0] || null;
  };
  const main = mainChords(chart, 6).filter((c) => CHORDS[c.family]);
  const setup: SetupCandidate[] = [];
  const arps = pick('chord', 'arpeggio');
  if (arps && main.length) {
    const picks = main.slice(0, count(arps, 3));
    setup.push({ kind: 'chord', item: warmItem(arps, t, picks.map((c) => up(c.root)), picks.map((c) => c.family)) });
  }
  const scales = pick('scale', 'scale');
  if (scales && main.length) {
    const byRoot: typeof main = [];
    for (const c of main) if (!byRoot.some((y) => y.root === c.root)) byRoot.push(c);
    const picks = byRoot.slice(0, count(scales, 3)).map((c) => ({ root: up(c.root), scale: scaleFor(c) })).filter((y): y is { root: number; scale: ScaleType } => !!y.scale && !!SCALES[y.scale]);
    if (picks.length) setup.push({ kind: 'scale', item: warmItem(scales, t, picks.map((y) => y.root), picks.map((y) => y.scale)) });
  }
  // Written exercises: least recently played first; already in today's set last.
  const order = (x: Exercise): [number, string] => [avoid.has(x.id) ? 1 : 0, stats.get(x.id)?.last || ''];
  const written = exercises().filter((x) => harmonyOf(x).length)
    .sort((a, b) => { const [p, q] = [order(a), order(b)]; return p[0] - q[0] || p[1].localeCompare(q[1]); });
  const changes: PlanItem[] = [];
  const later: PlanItem[] = [];
  for (const x of written) {
    const fits = fitsIn(x, chart, up, sharps);
    const items = fits.map((f) => warmItem(x, t, f.keys, null, {
      over: f.over,
      ...(f.overKey != null ? { overKey: f.overKey } : {}),
      ...(f.parts?.some((n) => n) ? { parts: f.parts } : {}),
    }));
    if (harmonyOf(x).length === 1) setup.push(...items.map((item): SetupCandidate => ({ kind: 'written', item })));
    else (avoid.has(x.id) ? later : changes).push(...items);
  }
  const through = exercises().find((x) => x.fromTune);
  if (through) {
    for (const p of progressions(chart).filter((q) => q.chords.length >= 2 && q.chords.every((c) => CHORDS[c.family]))) changes.push(progItem(through, t, p, up));
  }
  // Then any exercise through the whole form, in the tune's key: not written out chord by chord,
  // but shown with the tune's chart and a walking bass, to bend to the changes or take off from.
  const form = exercises().filter((x) => !x.fromTune)
    .sort((a, b) => { const [p, q] = [order(a), order(b)]; return p[0] - q[0] || p[1].localeCompare(q[1]); })
    .map((x) => warmItem(x, t, [playKey % 12], null, { form: true, overKey: playKey }));
  return { setup, changes: [...changes, ...later, ...form] };
}

// The best way to take exercise x before tune t (played in `key`): over a stretch of its chords it
// fits, on one of its chords, through a progression (Through the changes), or else through the form.
export function warmupOf(t: Tune, x: Exercise, { key = null }: { key?: Key | null } = {}): PlanItem | null {
  const { setup, changes } = candidates(t, { key });
  const item = changes.find((c) => c.itemId === x.id) || setup.find((c) => c.item.itemId === x.id)?.item;
  if (!item) return null;
  return { ...item, slot: setup.some((c) => c.item === item) ? 'setup' : 'changes' };
}

// Whether written exercise x fits somewhere in tune t's chords (for suggesting tunes to try it with).
export function fitsTune(x: Exercise, t: Tune): boolean {
  const chart = chartFor(t);
  return !!chart && fitsIn(x, chart, (r) => r, false).length > 0;
}
const same = (a: PlanItem, b: PlanItem) => a.itemId === b.itemId && String(a.keys) === String(b.keys) && !!a.form === !!b.form && (a.over || a.prog?.name || '') === (b.over || b.prog?.name || '') && String(a.types) === String(b.types);

// The next warm-ups to add before a tune (`have`: its warm-ups already in the set): taking turns
// between a lick, pattern or progression and something on its chords, starting with whichever it
// has fewer of; none it already has.
export function nextWarmups(t: Tune, { key = null, have = [], avoid = new Set(), n = 1 }:
  { key?: Key | null; have?: PlanItem[]; avoid?: Set<Id>; n?: number } = {}): PlanItem[] {
  const { setup, changes } = candidates(t, { key, avoid });
  const lists = { setup: setup.map((c) => c.item), changes };
  const got = [...have];
  const out: PlanItem[] = [];
  for (let i = 0; i < n; i++) {
    const inSlot = (slot: Slot) => got.filter((x) => (x.slot || (x.prog || x.over || x.form ? 'changes' : 'setup')) === slot).length;
    const order: Slot[] = inSlot('changes') <= inSlot('setup') ? ['changes', 'setup'] : ['setup', 'changes'];
    let next: PlanItem | null = null;
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
export function altWarmup(t: Tune, it: PlanItem, { key = null, have = [] }: { key?: Key | null; have?: PlanItem[] } = {}): PlanItem | null {
  const { setup, changes } = candidates(t, { key });
  const list = it.slot === 'setup' || it.types || (!it.prog && !it.over && !it.form) ? setup.map((c) => c.item) : changes;
  const at = list.findIndex((x) => same(x, it));
  const free = (x: PlanItem) => !same(x, it) && !have.some((h) => same(h, x));
  const after = list.slice(at + 1).concat(list.slice(0, at + 1));
  // Another exercise first (not just Through the changes on its next progression), then any.
  const next = after.find((x) => free(x) && x.itemId !== it.itemId) || after.find(free);
  return next ? { ...next, slot: it.slot } : null;
}

// Every warm-up that could go before tune t, to pick from, best first in each group, none it
// already has: over its changes (licks and patterns that fit, Through the changes), on its chords
// (arpeggios, scales, one-chord ones), and through the form (any other exercise).
export function warmupChoices(t: Tune, { key = null, have = [] }: { key?: Key | null; have?: PlanItem[] } = {}):
  { changes: PlanItem[]; chords: PlanItem[]; form: PlanItem[] } {
  const { setup, changes } = candidates(t, { key });
  const keep = (slot: Slot) => (x: PlanItem): PlanItem | null => (have.some((h) => same(h, x)) ? null : { ...x, slot });
  return {
    changes: changes.filter((x) => !x.form).map(keep('changes')).filter((x): x is PlanItem => !!x),
    chords: setup.map((c) => c.item).map(keep('setup')).filter((x): x is PlanItem => !!x),
    form: changes.filter((x) => x.form).map(keep('changes')).filter((x): x is PlanItem => !!x),
  };
}
