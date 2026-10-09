import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { store, seedState, migrate, SCHEMA_VERSION } from '../src/store.js';
import { loadSeedCharts, chartFor, seedChart } from '../src/charts.js';
import { nextWarmups, altWarmup, harmonyOf } from '../src/warmups.js';
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

// Warm-ups added before a tune (by hand: addWarmups), and what it's added to the set with.
const name = (x) => store.state.items.find((i) => i.id === x.itemId).name;
const lick = (abc, harmony) => {
  const x = { id: `lick${store.state.items.length}`, type: 'exercise', name: 'A lick', category: 'lick', keyMode: 'fixed', keysPerSession: 1, keys: [], abc, meter: '4/4', ...(harmony ? { harmony } : {}) };
  store.state.items.push(x);
  return x;
};

describe('warm-ups for a tune', () => {
  it('take turns: a pattern over part of a progression, then something on its chords, …', () => {
    const t = byName('Autumn Leaves'); // G minor
    const w = nextWarmups(t, { key: 19, n: 4 });
    expect(w.map(name)).toEqual(['ii–V–I, 1-2-3-5', 'Seventh-chord arpeggios', 'Through the changes', 'Scales: major and minors']);
    const [pattern, arps, changes] = w;
    // The written ii–V–I (Dm7 G7 Cmaj7 in C) over Cm7 F7 B♭maj7: played in B♭.
    expect(pattern).toMatchObject({ keys: [10], over: 'ii–V7–I', overKey: 10, slot: 'changes' });
    expect(arps).toMatchObject({ slot: 'setup' });
    expect(arps.types[0]).toBe('m6'); // Gm6
    // The minor ii–V–i into G, keeping the colours.
    expect(changes.prog.name).toBe('iiø–V7–i');
    expect(changes.prog.chords.map((c) => c.family)).toEqual(['m7b5', 'dom7', 'm6']);
    expect(w.every((x) => x.warmup === t.id)).toBe(true);
  });
  it('follow the key the tune is played in', () => {
    const [pattern] = nextWarmups(byName('Autumn Leaves'), { key: 16 }); // E minor: down a minor 3rd
    expect(pattern.keys).toEqual([7]);
  });
  it('a lick runs through a longer progression: a ii–V–I one plays just its ii–V up a step, then all of it', () => {
    const [w] = nextWarmups(byName('There Will Never Be Another You'), { key: 3 }); // E♭
    expect(w).toMatchObject({ over: 'iii–VI7–ii–V7–I', overKey: 3, keys: [5, 3], parts: [2, null] }); // F (Gm7 C7), then E♭
  });
  it('a ii–V lick, from the chord symbols in its notation, goes over iii–VI then ii–V', () => {
    const x = lick('"Dm7"D F A c "G7"B G F D | C8 |');
    expect(harmonyOf(x).map((c) => c.family)).toEqual(['m7', 'dom7']);
    const fits = nextWarmups(byName('There Will Never Be Another You'), { key: 3, n: 12 }).filter((w) => w.itemId === x.id);
    expect(fits[0]).toMatchObject({ over: 'iii–VI7–ii–V7', keys: [5, 3] });
    expect(fits[0].parts).toBeUndefined();
  });
  it('its chords can be typed instead (in C), over a one-chord one fitting any chord of that kind', () => {
    const x = lick('C D E F G A B c |', 'C7'); // no chord symbols: typed
    expect(harmonyOf(x).map((c) => c.family)).toEqual(['dom7']);
    const fits = nextWarmups(byName('Autumn Leaves'), { key: 19, n: 60 }).filter((w) => w.itemId === x.id);
    expect(fits.length).toBeGreaterThan(0);
    expect(fits[0].over).toMatch(/^[DF]7/); // over a dominant: D7♭13 or F7
  });
  it('none it already has; and swapping gives the next one in its place', () => {
    const t = byName('There Will Never Be Another You');
    const [a] = nextWarmups(t, { key: 3 });
    const [b] = nextWarmups(t, { key: 3, have: [a] });
    expect(b.slot).toBe('setup'); // it had a lick: now something on its chords
    const c = altWarmup(t, a, { key: 3 });
    expect(c).toMatchObject({ slot: 'changes' });
    expect(`${c.over}${c.keys}`).not.toBe(`${a.over}${a.keys}`);
    expect(nextWarmups(byName('Killer Joe'))).toEqual([]); // no chart
  });
});

describe('exercises across a day', () => {
  it('nothing is added before tunes by itself; general exercises up top', () => {
    buildPlan(true);
    const items = store.state.plan.items;
    expect(items.some((i) => i.warmup)).toBe(false);
    const first = store.state.items.find((x) => x.id === items[0].itemId);
    expect(first.type).toBe('exercise');
  });
  it('+ Warm-up adds one at a time, just before its tune (putting the tune in the set if need be)', () => {
    buildPlan(true);
    const t = byName('Autumn Leaves');
    expect(addWarmups(t)).toBe(1);
    expect(addWarmups(t)).toBe(1);
    const items = store.state.plan.items;
    const at = items.findIndex((i) => i.itemId === t.id && !i.warmup);
    expect(items.slice(at - 2, at).map((i) => i.warmup)).toEqual([t.id, t.id]);
    expect(items.slice(at - 2, at).map((i) => i.slot)).toEqual(['changes', 'setup']);
  });
  it('the same exercise before two tunes is played (and unmarked) on its own each time', () => {
    buildPlan(true);
    const plan = store.state.plan;
    for (const n of ['Autumn Leaves', 'There Will Never Be Another You']) {
      addToToday(byName(n));
      plan.items.push(...nextWarmups(byName(n), { key: todayItem(byName(n)).key }));
    }
    const pattern = byName('ii–V–I, 1-2-3-5');
    const [a, b] = plan.items.filter((i) => i.itemId === pattern.id);
    markPlayed(pattern.id, a);
    expect(isPlanItemPlayed(a)).toBe(true);
    expect(isPlanItemPlayed(b)).toBe(false);
    markPlayed(pattern.id, b);
    expect(store.state.log.filter((e) => e.itemId === pattern.id)).toHaveLength(2);
    unmarkPlayed(pattern.id, a);
    expect(isPlanItemPlayed(a)).toBe(false);
    expect(isPlanItemPlayed(b)).toBe(true);
    expect(isPlayedToday(pattern.id)).toBe(true);
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
    const changes = nextWarmups(t, { key: 14, n: 6 }).find((w) => w.prog?.name === 'iiø–V7–i');
    expect(changes.prog.chords.map((c) => c.family)).toEqual(['m7b5', 'dom7b9', 'm6']);
  });
  it('find longer progressions', () => {
    const t = byName('There Will Never Be Another You');
    expect(progressions(chartFor(t)).some((p) => p.name === 'iii–VI7–ii–V7–I')).toBe(true);
  });
  it('“Through the changes” only comes up as a warm-up', () => {
    store.state.settings.exercises = 8;
    buildPlan();
    expect(store.state.plan.items.some((i) => i.itemId === byName('Through the changes').id)).toBe(false);
  });
});

describe('from the review', () => {
  it('deleting a tune keeps its played warm-ups (and their log entries stay theirs)', () => {
    buildPlan(true);
    const t = byName('Autumn Leaves');
    addWarmups(t);
    addWarmups(t);
    addWarmups(t);
    const plan = store.state.plan;
    const changes = byName('Through the changes');
    const [a] = plan.items.filter((i) => i.itemId === changes.id);
    const [b] = plan.items.filter((i) => i.warmup === t.id && i.itemId !== changes.id);
    markPlayed(changes.id, a);
    deleteItem(t.id);
    expect(isPlanItemPlayed(a)).toBe(true);
    expect(a.warmup).toBeUndefined();
    expect(plan.items).not.toContain(b); // unplayed ones go with it
  });
  it('several plays in a day are one session for level and tempo suggestions', () => {
    buildPlan(true);
    const changes = byName('Through the changes');
    changes.level = 0;
    changes.tempo = 100;
    for (const n of ['Autumn Leaves', 'Alone Together', 'There Will Never Be Another You']) {
      const t = byName(n);
      addToToday(t);
      const w = nextWarmups(t, { key: todayItem(t).key, n: 6 }).find((x) => x.itemId === changes.id);
      store.state.plan.items.push(w);
      markPlayed(changes.id, w);
      rate(changes.id, 'solid', w);
    }
    expect(store.state.log.filter((e) => e.itemId === changes.id).length).toBeGreaterThan(1);
    expect(levelSuggestion(changes)).toBe(null);
    expect(tempoSuggestion(changes)).toBe(null);
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
    addWarmups(t);
    addWarmups(t);
    addWarmups(t);
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
    addWarmups(byName('Autumn Leaves'));
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
