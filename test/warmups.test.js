import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { store, seedState, migrate, SCHEMA_VERSION } from '../src/store.js';
import { loadSeedCharts, chartFor, seedChart } from '../src/charts.js';
import { warmupsFor, prepFor, altWarmup } from '../src/warmups.js';
import { buildPlan, addWarmups, ensurePlan, dropOrphanWarmups, addToToday, todayItem, setTodayKeys, setTodayKey } from '../src/plan.js';
import { markPlayed, unmarkPlayed, isPlanItemPlayed, isPlayedToday, deleteItem, rate, levelSuggestion } from '../src/practice.js';
import { tempoSuggestion } from '../src/tempo.js';
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
    expect(s.version).toBe(SCHEMA_VERSION);
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
  it('before a tune: arpeggios (or scales) on its chords, then its progression', () => {
    const t = byName('Autumn Leaves');
    const name = (x) => store.state.items.find((i) => i.id === x.itemId).name;
    expect(prepFor(t, { key: 19 }).map(name)).toEqual(['Seventh-chord arpeggios', 'Through the changes']);
    expect(prepFor(t, { key: 19, prefer: 'scale' }).map(name)).toEqual(['Scales: major and minors', 'Through the changes']);
    expect(prepFor(byName('Killer Joe'))).toEqual([]); // no chart
  });
  it('can be swapped: arpeggios for scales, or the tune’s next progression', () => {
    const t = byName('There Will Never Be Another You');
    const [setup, prog] = prepFor(t, { key: 3 });
    const name = (x) => store.state.items.find((i) => i.id === x.itemId).name;
    expect(name(altWarmup(t, setup, { key: 3 }))).toBe('Scales: major and minors');
    const next = altWarmup(t, prog, { key: 3 });
    expect(`${next.prog.name} in ${next.keys[0]}`).not.toBe(`${prog.prog.name} in ${prog.keys[0]}`);
    expect(next.warmup).toBe(t.id);
    expect(next.pid).not.toBe(prog.pid);
  });
});

describe('exercises across a day', () => {
  it('"from tunes": general exercises up top, then each tune with its warm-ups just before it', () => {
    expect(store.state.settings.exerciseFocus).toBe('tunes'); // the default
    buildPlan(true);
    const items = store.state.plan.items;
    const item = (it) => byName(store.state.items.find((x) => x.id === it.itemId).name);
    const general = items.filter((i) => item(i).type === 'exercise' && !i.warmup);
    expect(general).toHaveLength(2);
    expect(items.slice(0, 2)).toEqual(general);
    // Every warm-up comes right before its tune (setup, then the progression), a pair per tune.
    for (const [i, it] of items.entries()) {
      if (!it.warmup) continue;
      const tuneAt = items.findIndex((x, j) => j > i && !x.warmup);
      expect(items[tuneAt].itemId).toBe(it.warmup);
    }
    const tunes = items.filter((i) => item(i).type === 'tune' && chartFor(item(i)));
    for (const t of tunes) expect(items.filter((i) => i.warmup === t.itemId).length).toBeGreaterThan(0);
    expect(items.filter((i) => i.warmup).length).toBeLessThanOrEqual(tunes.length * 2);
    // Arpeggios and scales take turns.
    const setups = items.filter((i) => i.warmup && i.types).map((i) => item(i).vary.kind);
    expect(setups.slice(0, 2)).toEqual(['chord', 'scale']);
    expect(new Set(items.map((i) => i.pid)).size).toBe(items.length);
  });
  it('the same exercise before two tunes is played (and unmarked) on its own each time', () => {
    buildPlan(true);
    const changes = byName('Through the changes');
    const [a, b] = store.state.plan.items.filter((i) => i.itemId === changes.id);
    markPlayed(changes.id, a);
    expect(isPlanItemPlayed(a)).toBe(true);
    expect(isPlanItemPlayed(b)).toBe(false);
    markPlayed(changes.id, b);
    expect(store.state.log.filter((e) => e.itemId === changes.id)).toHaveLength(2);
    unmarkPlayed(changes.id, a);
    expect(isPlanItemPlayed(a)).toBe(false);
    expect(isPlanItemPlayed(b)).toBe(true);
    expect(isPlayedToday(changes.id)).toBe(true);
  });
  it('a set made with another setting is redone for this one', () => {
    store.state.settings.exerciseFocus = 'own';
    buildPlan(true);
    expect(store.state.plan.items.some((i) => i.warmup)).toBe(false);
    store.state.settings.exerciseFocus = 'tunes';
    ensurePlan();
    expect(store.state.plan.items.some((i) => i.warmup)).toBe(true);
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
  it('adds warm-ups for a tune on request, just before it', () => {
    store.state.settings.exerciseFocus = 'own';
    buildPlan(true);
    const t = byName('Autumn Leaves');
    expect(addWarmups(t)).toBe(4);
    expect(addWarmups(t)).toBe(4); // again: in place of the first ones
    expect(store.state.plan.items.filter((i) => i.warmup === t.id)).toHaveLength(4);
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
    const changes = byName('Through the changes');
    for (const mode of ['own', 'tunes']) {
      store.state.settings.exerciseFocus = mode;
      buildPlan();
      expect(store.state.plan.items.filter((i) => i.itemId === changes.id).every((i) => i.warmup)).toBe(true);
    }
    store.state.settings.exerciseFocus = 'own';
    buildPlan();
    expect(store.state.plan.items.some((i) => i.itemId === changes.id)).toBe(false);
  });
});

describe('from the review', () => {
  it('deleting a tune keeps its played warm-ups (and their log entries stay theirs)', () => {
    buildPlan(true);
    const plan = store.state.plan;
    const changes = byName('Through the changes');
    const [a, b] = plan.items.filter((i) => i.itemId === changes.id);
    markPlayed(changes.id, a);
    deleteItem(a.warmup);
    expect(isPlanItemPlayed(a)).toBe(true);
    expect(a.warmup).toBeUndefined();
    expect(isPlanItemPlayed(b)).toBe(false); // not mistaken for played
  });
  it('several plays in a day are one session for level and tempo suggestions', () => {
    buildPlan(true);
    const changes = byName('Through the changes');
    changes.level = 0;
    changes.tempo = 100;
    for (const it of store.state.plan.items.filter((i) => i.itemId === changes.id)) {
      markPlayed(changes.id, it);
      rate(changes.id, 'solid', it);
    }
    expect(store.state.log.filter((e) => e.itemId === changes.id).length).toBeGreaterThan(2);
    expect(levelSuggestion(changes)).toBe(null);
    expect(tempoSuggestion(changes)).toBe(null);
  });
  it('a set from before the exercise settings keeps the exercises already shown', () => {
    store.state.settings.exerciseFocus = 'own';
    buildPlan(true);
    const plan = store.state.plan;
    const shown = plan.items.filter((i) => i.bucket === 'exercise').map((i) => i.pid);
    delete plan.mode;
    store.state.settings.exerciseFocus = 'tunes';
    ensurePlan();
    expect(plan.items.filter((i) => !i.warmup && i.bucket === 'exercise').map((i) => i.pid)).toEqual(shown);
    expect(plan.items.some((i) => i.warmup)).toBe(true);
  });
  it('warm-ups for a tune that left the set go, unless played', () => {
    store.state.settings.exerciseFocus = 'own';
    buildPlan(true);
    const t = byName('Autumn Leaves');
    addWarmups(t);
    const plan = store.state.plan;
    const [played] = plan.items.filter((i) => i.warmup === t.id);
    markPlayed(played.itemId, played);
    plan.items = plan.items.filter((i) => i.itemId !== t.id || i.warmup);
    dropOrphanWarmups(plan);
    expect(plan.items.filter((i) => i.warmup === t.id)).toEqual([played]);
  });
});

describe('changing today’s instance', () => {
  it('an exercise’s keys and types, before and after it’s played', () => {
    store.state.settings.exerciseFocus = 'own';
    buildPlan(true);
    const arps = byName('Seventh-chord arpeggios');
    addToToday(arps); // (if it isn't there already)
    const it = todayItem(arps);
    setTodayKeys(it, [0, 5], ['maj7', 'm7']);
    markPlayed(it.itemId, it);
    expect(store.state.log.at(-1)).toMatchObject({ keys: [0, 5], types: ['maj7', 'm7'] });
    setTodayKeys(it, [0, 5, 10], ['maj7', 'm7', 'dom7']); // played in one more key
    expect(store.state.log.at(-1)).toMatchObject({ keys: [0, 5, 10], types: ['maj7', 'm7', 'dom7'] });
    expect(it.keys).toEqual([0, 5, 10]);
  });
  it('a tune’s key: logged too, and its warm-ups move to the new key', () => {
    buildPlan(true);
    const t = byName('Autumn Leaves');
    addToToday(t);
    const it = todayItem(t);
    setTodayKey(it, 19); // G minor
    const before = store.state.plan.items.find((i) => i.warmup === t.id && i.prog);
    setTodayKey(it, 16); // E minor: down a minor 3rd
    const after = store.state.plan.items.find((i) => i.warmup === t.id && i.prog);
    expect(after.keys[0]).toBe((before.keys[0] + 9) % 12);
    markPlayed(t.id, it);
    setTodayKey(it, 21);
    expect(store.state.log.at(-1)).toMatchObject({ key: 21, alt: !t.keys.includes(21) });
  });
});

describe('warm-up tempo', () => {
  it('is the tune’s: logged with the session, and not counted for the exercise’s own tempo', () => {
    buildPlan(true);
    const plan = store.state.plan;
    const w = plan.items.find((i) => i.warmup);
    const tune = store.state.items.find((t) => t.id === w.warmup);
    const ex = store.state.items.find((t) => t.id === w.itemId);
    tune.tempo = 132;
    ex.tempo = 90;
    markPlayed(ex.id, w);
    rate(ex.id, 'rough', w);
    const e = store.state.log.at(-1);
    expect(e).toMatchObject({ bpm: 132, warmup: tune.id });
    expect(tempoSuggestion(ex)).toBe(null); // a rough warm-up at 132 says nothing about 90
  });
});
