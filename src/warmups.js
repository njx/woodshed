import { store } from './store.js';
import { chartFor } from './charts.js';
import { mainChords, twoFives, scaleFor } from './chords.js';
import { CHORDS, SCALES } from './theory.js';
import { isPlayedToday } from './practice.js';

// Warm-ups for a tune: exercises set to its chords, in the key it's played in today.
//   - arpeggios (an exercise that varies the chord type) on its main chords;
//   - ii–V–I patterns (a written ii–V–I exercise, whose keys are the I) into its major keys;
//   - scales (an exercise that varies the scale type) that go with its main chords.
// Each is a plan item: { itemId, bucket: 'exercise', keys, types?, warmup: tune id }.

const exercises = () => store.state.items.filter((x) => x.type === 'exercise');
const usable = (x, exclude) => !exclude.has(x.id) && !isPlayedToday(x.id);
// An exercise of a kind, preferring the expected category.
function findExercise(test, category, exclude) {
  const all = exercises().filter((x) => usable(x, exclude) && test(x));
  return all.find((x) => x.category === category) || all[0] || null;
}
const count = (x, fallback) => Math.max(2, Math.min(4, x.keysPerSession || fallback));

// `key`: the concert key the tune is played in today (defaults to its first usual key).
export function warmupsFor(t, { key = null, exclude = new Set() } = {}) {
  const chart = chartFor(t);
  if (!chart) return [];
  const playKey = key ?? t.keys?.[0] ?? chart.key ?? 0;
  const shift = (((playKey - (chart.key ?? playKey)) % 12) + 12) % 12;
  const up = (r) => (r + shift) % 12;
  const taken = new Set(exclude);
  const items = [];
  const add = (x, keys, types) => {
    taken.add(x.id);
    items.push({ itemId: x.id, bucket: 'exercise', key: null, keys, ...(types ? { types } : {}), alt: false, shift: null, warmup: t.id });
  };

  const main = mainChords(chart, 6).filter((c) => CHORDS[c.family]);

  const arps = findExercise((x) => x.vary?.kind === 'chord', 'arpeggio', taken);
  if (arps && main.length) {
    const picks = main.slice(0, count(arps, 3));
    add(arps, picks.map((c) => up(c.root)), picks.map((c) => c.family));
  }

  const majors = twoFives(chart).filter((x) => !x.minor);
  const iiV = findExercise((x) => !x.vary && x.abc && /ii\W*V/i.test(x.name), 'pattern', taken);
  if (iiV && majors.length) add(iiV, [...new Set(majors.map((x) => up(x.target)))].slice(0, count(iiV, 2)));

  const scales = findExercise((x) => x.vary?.kind === 'scale', 'scale', taken);
  if (scales && main.length) {
    // One scale per root (the chord that lasts longest there).
    const byRoot = [];
    for (const c of main) if (!byRoot.some((x) => x.root === c.root)) byRoot.push(c);
    const picks = byRoot.slice(0, count(scales, 3)).map((c) => ({ root: up(c.root), scale: scaleFor(c) })).filter((x) => SCALES[x.scale]);
    if (picks.length) add(scales, picks.map((x) => x.root), picks.map((x) => x.scale));
  }
  return items;
}

// The tune to warm up for in a set: a focus tune first, then one being learned, then the rest;
// one with a chart that hasn't been played yet.
export function warmupTune(planItems) {
  const order = { focus: 0, learn: 1, hone: 2, fresh: 3 };
  return planItems
    .filter((it) => order[it.bucket] != null && !isPlayedToday(it.itemId))
    .map((it) => ({ it, t: store.state.items.find((x) => x.id === it.itemId) }))
    .filter(({ t }) => t?.type === 'tune' && chartFor(t))
    .sort((a, b) => order[a.it.bucket] - order[b.it.bucket])[0] || null;
}
