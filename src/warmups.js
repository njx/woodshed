import { store } from './store.js';
import { chartFor } from './charts.js';
import { mainChords, twoFives, scaleFor, progressions } from './chords.js';
import { CHORDS, SCALES } from './theory.js';
import { uid } from './util.js';

// Warm-ups for a tune: exercises set to its chords, in the key it's played in today.
//   - its main progression (iii–VI–ii–V, a minor ii–V–i…), arpeggiated through the changes;
//   - arpeggios (an exercise that varies the chord type) on its main chords;
//   - scales (an exercise that varies the scale type) that go with its main chords;
//   - ii–V–I patterns (a written ii–V–I exercise, whose keys are the I) into its major keys.
// Each is a plan item: { pid, itemId, bucket: 'exercise', keys, types?, prog?, warmup: tune id }.
// prepFor() is the short version that goes before each tune in the set: one of the first two
// (scales or arpeggios), then the progression.

const exercises = () => store.state.items.filter((x) => x.type === 'exercise');
const usable = (x, exclude) => !exclude.has(x.id);
// An exercise of a kind, preferring the expected category.
function findExercise(test, category, exclude) {
  const all = exercises().filter((x) => usable(x, exclude) && test(x));
  return all.find((x) => x.category === category) || all[0] || null;
}
const count = (x, fallback) => Math.max(2, Math.min(4, x.keysPerSession || fallback));

// `key`: the concert key the tune is played in today (defaults to its first usual key).
export function warmupsFor(t, { key = null } = {}) {
  const chart = chartFor(t);
  if (!chart) return [];
  const playKey = key ?? t.keys?.[0] ?? chart.key ?? 0;
  const shift = (((playKey - (chart.key ?? playKey)) % 12) + 12) % 12;
  const up = (r) => (r + shift) % 12;
  const taken = new Set();
  const items = [];
  const add = (x, keys, types) => {
    taken.add(x.id);
    items.push(warmItem(x, t, keys, types));
  };

  const main = mainChords(chart, 6).filter((c) => CHORDS[c.family]);

  // Its main progression, through the changes (keys: the key it leads to).
  const prog = progressions(chart).find((p) => p.chords.length >= 2 && p.chords.every((c) => CHORDS[c.family]));
  const changes = exercises().find((x) => x.fromTune && usable(x, taken));
  if (prog && changes) {
    taken.add(changes.id);
    items.push(progItem(changes, t, prog, up));
  }

  const arps = findExercise((x) => x.vary?.kind === 'chord', 'arpeggio', taken);
  if (arps && main.length) {
    const picks = main.slice(0, count(arps, 3));
    add(arps, picks.map((c) => up(c.root)), picks.map((c) => c.family));
  }

  const scales = findExercise((x) => x.vary?.kind === 'scale', 'scale', taken);
  if (scales && main.length) {
    // One scale per root (the chord that lasts longest there).
    const byRoot = [];
    for (const c of main) if (!byRoot.some((x) => x.root === c.root)) byRoot.push(c);
    const picks = byRoot.slice(0, count(scales, 3)).map((c) => ({ root: up(c.root), scale: scaleFor(c) })).filter((x) => SCALES[x.scale]);
    if (picks.length) add(scales, picks.map((x) => x.root), picks.map((x) => x.scale));
  }
  const majors = twoFives(chart).filter((x) => !x.minor);
  const iiV = findExercise((x) => !x.vary && x.abc && /ii\W*V/i.test(x.name), 'pattern', taken);
  if (iiV && majors.length) add(iiV, [...new Set(majors.map((x) => up(x.target)))].slice(0, count(iiV, 2)));

  return items;
}

const warmItem = (x, t, keys, types = null, extra = {}) => ({
  pid: uid(), itemId: x.id, bucket: 'exercise', key: null, keys, ...(types ? { types } : {}), alt: false, shift: null, warmup: t.id, ...extra,
});
const progItem = (x, t, prog, up) => warmItem(x, t, [up(prog.target)], null, {
  prog: { name: prog.name, chords: prog.chords.map(({ d, family }) => ({ d, family })) },
});

// Before a tune in today's set: scales or arpeggios on a few of its chords (`prefer`: 'chord' or
// 'scale', taking the other if there's none), then one of its progressions. The same exercises
// can come up before several tunes, each set to that tune.
export function prepFor(t, { key = null, prefer = 'chord' } = {}) {
  const chart = chartFor(t);
  if (!chart) return [];
  const playKey = key ?? t.keys?.[0] ?? chart.key ?? 0;
  const shift = (((playKey - (chart.key ?? playKey)) % 12) + 12) % 12;
  const up = (r) => (r + shift) % 12;
  const pick = (kind, category) => {
    const all = exercises().filter((x) => x.vary?.kind === kind && !x.fromTune);
    return all.find((x) => x.category === category) || all[0] || null;
  };
  const main = mainChords(chart, 6).filter((c) => CHORDS[c.family]);
  const items = [];
  const chordItem = () => {
    const x = pick('chord', 'arpeggio');
    if (!x || !main.length) return null;
    const picks = main.slice(0, count(x, 3));
    return warmItem(x, t, picks.map((c) => up(c.root)), picks.map((c) => c.family));
  };
  const scaleItem = () => {
    const x = pick('scale', 'scale');
    if (!x || !main.length) return null;
    const byRoot = [];
    for (const c of main) if (!byRoot.some((y) => y.root === c.root)) byRoot.push(c);
    const picks = byRoot.slice(0, count(x, 3)).map((c) => ({ root: up(c.root), scale: scaleFor(c) })).filter((y) => SCALES[y.scale]);
    return picks.length ? warmItem(x, t, picks.map((y) => y.root), picks.map((y) => y.scale)) : null;
  };
  const setup = prefer === 'scale' ? scaleItem() || chordItem() : chordItem() || scaleItem();
  if (setup) items.push(setup);
  const prog = progressions(chart).find((p) => p.chords.length >= 2 && p.chords.every((c) => CHORDS[c.family]));
  const changes = exercises().find((x) => x.fromTune);
  if (prog && changes) items.push(progItem(changes, t, prog, up));
  return items;
}

// Another warm-up in place of `it` before tune `t` (played in `key` today): the other kind of
// setup (scales for arpeggios or the other way round), or the tune's next progression. Null if
// there's nothing else.
export function altWarmup(t, it, { key = null } = {}) {
  const chart = chartFor(t);
  if (!chart) return null;
  if (it.prog) {
    const progs = progressions(chart).filter((p) => p.chords.length >= 2 && p.chords.every((c) => CHORDS[c.family]));
    if (progs.length < 2) return null;
    const playKey = key ?? t.keys?.[0] ?? chart.key ?? 0;
    const shift = (((playKey - (chart.key ?? playKey)) % 12) + 12) % 12;
    // The same progression can come up into different keys: match on both.
    const same = (p) => p.name === it.prog.name && (p.target + shift) % 12 === it.keys?.[0];
    const at = progs.findIndex(same);
    const next = at >= 0 ? progs[(at + 1) % progs.length] : progs.find((p) => p.name !== it.prog.name);
    if (!next) return null;
    const changes = exercises().find((x) => x.id === it.itemId);
    return changes ? progItem(changes, t, next, (r) => (r + shift) % 12) : null;
  }
  const kind = exercises().find((x) => x.id === it.itemId)?.vary?.kind;
  const other = prepFor(t, { key, prefer: kind === 'chord' ? 'scale' : 'chord' })[0];
  return other && !other.prog && other.itemId !== it.itemId ? other : null;
}
