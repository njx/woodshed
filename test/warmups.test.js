import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import standards from './fixtures/standards.json';
import { store, seedState } from '../src/store.js';
import { _resetCharts, chartFor } from '../src/charts.js';
import { warmupsFor, warmupTune } from '../src/warmups.js';
import { buildPlan, ensurePlan, addWarmups } from '../src/plan.js';
import { markPlayed } from '../src/practice.js';
import { chooseTypes } from '../src/theory.js';
import { freezeToday } from './helpers.js';

const byName = (n) => store.state.items.find((t) => t.name === n);

beforeEach(() => {
  freezeToday();
  store.state = seedState();
  _resetCharts(standards);
});
afterEach(() => vi.useRealTimers());

describe('charts for tunes', () => {
  it('match titles, including "X, The" and aliases', () => {
    expect(chartFor(byName('Autumn Leaves'))).toBeTruthy();
    expect(chartFor(byName('The Girl From Ipanema'))).toBeTruthy();
    expect(chartFor(byName('Solar')).key).toBeTypeOf('number');
  });
  it('prefer a tune’s own chart', () => {
    const t = byName('Solar');
    t.chart = { key: 0, meter: '4/4', sections: [{ label: 'A', repeats: 0, bars: [{ chords: [{ root: 0, q: 'maj7' }], alts: [] }], endings: [] }] };
    expect(chartFor(t)).toBe(t.chart);
  });
  it('are none until downloaded', () => {
    _resetCharts();
    expect(chartFor(byName('Autumn Leaves'))).toBe(null);
  });
});

describe('warm-ups for a tune', () => {
  it('arpeggios on its main chords, ii–Vs into its major keys, and scales for its chords', () => {
    const t = byName('Autumn Leaves'); // G minor
    const w = warmupsFor(t, { key: 19 });
    const names = w.map((x) => store.state.items.find((i) => i.id === x.itemId).name);
    expect(names).toEqual(['Seventh-chord arpeggios', 'ii–V–I, 1-2-3-5', 'Scales: major and minors']);
    const [arps, iiV, scales] = w;
    expect(arps.keys[0]).toBe(7); // G
    expect(arps.types[0]).toBe('m6'); // Gm6
    expect(iiV.keys).toContain(10); // Cm7 F7 → B♭
    expect(scales.types.length).toBe(scales.keys.length);
    expect(w.every((x) => x.warmup === t.id)).toBe(true);
  });
  it('follow the key the tune is played in', () => {
    const t = byName('Autumn Leaves');
    const inE = warmupsFor(t, { key: 16 }); // E minor: down a minor 3rd
    expect(inE[0].keys[0]).toBe(4); // Em6
  });
  it('pick the tune to warm up for: focus first, then one being learned', () => {
    const items = [
      { itemId: byName('Solar').id, bucket: 'hone' },
      { itemId: byName('Autumn Leaves').id, bucket: 'learn' },
    ];
    expect(warmupTune(items).t.name).toBe('Autumn Leaves');
    items.push({ itemId: byName('Blue Bossa').id, bucket: 'focus' });
    expect(warmupTune(items).t.name).toBe('Blue Bossa');
  });
});

describe('exercises across a day', () => {
  it('"from today’s tunes" fills the exercise slots with warm-ups', () => {
    store.state.settings.exerciseFocus = 'tunes';
    byName('Autumn Leaves').focus = true;
    buildPlan(true);
    const ex = store.state.plan.items.filter((i) => i.bucket === 'exercise');
    expect(ex).toHaveLength(2);
    expect(ex.every((i) => i.warmup === byName('Autumn Leaves').id)).toBe(true);
    expect(store.state.plan.warmupFor).toBe(byName('Autumn Leaves').id);
  });
  it('switches in warm-ups when charts arrive, unless an exercise was played', () => {
    store.state.settings.exerciseFocus = 'tunes';
    byName('Autumn Leaves').focus = true;
    _resetCharts();
    buildPlan(true);
    expect(store.state.plan.warmupsPending).toBe(true);
    expect(store.state.plan.items.some((i) => i.warmup)).toBe(false);
    _resetCharts(standards);
    ensurePlan();
    expect(store.state.plan.items.some((i) => i.warmup)).toBe(true);
    expect(store.state.plan.warmupsPending).toBeUndefined();
  });
  it('"key of the day" gives weak-key exercises the same keys', () => {
    store.state.settings.exerciseFocus = 'day';
    buildPlan(true);
    const { dayKeys, items } = store.state.plan;
    expect(dayKeys).toHaveLength(2);
    for (const it of items.filter((i) => i.bucket === 'exercise')) {
      const t = store.state.items.find((x) => x.id === it.itemId);
      if (['weak', 'random'].includes(t.keyMode)) expect(dayKeys).toEqual(expect.arrayContaining(it.keys));
    }
  });
  it('adds warm-ups for a tune on request, replacing exercises not played yet', () => {
    buildPlan(true);
    const n = addWarmups(byName('Autumn Leaves'));
    expect(n).toBe(3);
    const warm = store.state.plan.items.filter((i) => i.warmup);
    expect(warm).toHaveLength(3);
    expect(new Set(store.state.plan.items.map((i) => i.itemId)).size).toBe(store.state.plan.items.length);
  });
  it('doesn’t replace an exercise already played today', () => {
    buildPlan(true);
    const arps = byName('Seventh-chord arpeggios');
    markPlayed(arps.id, { keys: [0] });
    const w = warmupsFor(byName('Autumn Leaves'), { key: 19 });
    expect(w.some((x) => x.itemId === arps.id)).toBe(false);
  });
});

describe('types by overall weakness', () => {
  it('favour types played least across all exercises', () => {
    const vary = { kind: 'scale', types: ['major', 'dorian'] };
    let dorian = 0;
    for (let i = 0; i < 400; i++) if (chooseTypes(vary, 1, [], Math.random, { major: 30, dorian: 2 })[0] === 'dorian') dorian++;
    expect(dorian).toBeGreaterThan(280);
  });
});
