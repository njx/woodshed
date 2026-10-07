import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { store, seedState, migrate } from '../src/store.js';
import { loadSeedCharts, chartFor, seedChart } from '../src/charts.js';
import { warmupsFor, warmupTune } from '../src/warmups.js';
import { buildPlan, addWarmups } from '../src/plan.js';
import { markPlayed } from '../src/practice.js';
import { chooseTypes } from '../src/theory.js';
import { freezeToday } from './helpers.js';
import { progressions } from '../src/chords.js';

const byName = (n) => store.state.items.find((t) => t.name === n);

beforeAll(() => loadSeedCharts());
beforeEach(() => {
  freezeToday();
  store.state = seedState();
});
afterEach(() => vi.useRealTimers());

describe('charts for tunes', () => {
  it('come with almost all of the starting tunes, matched by title (including "X, The" and aliases)', () => {
    const tunes = store.state.items.filter((t) => t.type === 'tune');
    expect(tunes.filter((t) => chartFor(t)).length).toBeGreaterThanOrEqual(290);
    expect(chartFor(byName('The Girl From Ipanema'))).toBeTruthy();
    expect(chartFor(byName('Black Orpheus'))).toBeTruthy();
    expect(chartFor(byName('Solar')).key).toBeTypeOf('number');
    expect(chartFor(byName('Killer Joe'))).toBe(null); // not in JazzStandards
  });
  it('are added once to data from before charts, without touching edited ones', () => {
    const old = seedState();
    old.version = 4;
    const solar = old.items.find((t) => t.name === 'Solar');
    solar.chart = { key: 0, meter: '4/4', sections: [{ label: 'A', repeats: 0, bars: [{ chords: [{ root: 0, q: 'maj7' }], alts: [] }], endings: [] }] };
    for (const t of old.items) if (t.name !== 'Solar') delete t.chart;
    const s = migrate(old);
    expect(s.version).toBe(6);
    expect(s.items.find((t) => t.name === 'Autumn Leaves').chart.sections.length).toBeGreaterThan(0);
    expect(s.items.find((t) => t.name === 'Solar').chart.sections[0].bars).toHaveLength(1);
  });
  it('a tune’s chart is its own copy', () => {
    const t = byName('Solar');
    t.chart.sections[0].label = 'X';
    expect(seedChart(t).sections[0].label).not.toBe('X');
  });
});

describe('warm-ups for a tune', () => {
  it('its main progression, arpeggios on its main chords, scales for its chords, and ii–Vs into its major keys', () => {
    const t = byName('Autumn Leaves'); // G minor
    const w = warmupsFor(t, { key: 19 });
    const names = w.map((x) => store.state.items.find((i) => i.id === x.itemId).name);
    expect(names).toEqual(['Through the changes', 'Seventh-chord arpeggios', 'Scales: major and minors', 'ii–V–I, 1-2-3-5']);
    const [changes, arps, scales, iiV] = w;
    // The minor ii–V–i into G, keeping the colours (iiø, and the dominant's ♭13 → 7).
    expect(changes.prog.name).toBe('iiø–V7–i');
    expect(changes.keys).toEqual([7]);
    expect(changes.prog.chords.map((c) => c.family)).toEqual(['m7b5', 'dom7', 'm6']);
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
    expect(n).toBe(4);
    const warm = store.state.plan.items.filter((i) => i.warmup);
    expect(warm).toHaveLength(4);
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

describe('progression warm-ups', () => {
  it('keep a tune’s colours, like a ♭9 on the V', () => {
    const t = byName('Alone Together'); // D minor: Em7b5 A7b9 Dm6
    const [changes] = warmupsFor(t, { key: 14 });
    expect(changes.prog.name).toBe('iiø–V7–i');
    expect(changes.prog.chords.map((c) => c.family)).toEqual(['m7b5', 'dom7b9', 'm6']);
  });
  it('find longer progressions', () => {
    const t = byName('There Will Never Be Another You');
    expect(progressions(chartFor(t)).some((p) => p.name === 'iii–VI7–ii–V7–I')).toBe(true);
  });
  it('“Through the changes” only comes up as a warm-up', () => {
    store.state.settings.exercises = 8;
    buildPlan(true);
    const changes = byName('Through the changes');
    expect(store.state.plan.items.some((i) => i.itemId === changes.id)).toBe(false);
  });
});
