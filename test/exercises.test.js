import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { store } from '../src/store.js';
import { keyFamiliarity, keySessions, chooseExerciseKeys } from '../src/keystats.js';
import { buildPlan } from '../src/plan.js';
import { markPlayed, itemStats } from '../src/practice.js';
import { freezeToday, tune, setState, entry, TODAY } from './helpers.js';

beforeEach(() => freezeToday());
afterEach(() => vi.useRealTimers());

const exercise = (over = {}) => tune({ type: 'exercise', name: 'Scale', category: 'scale', keyMode: 'weak', keysPerSession: 3, keys: [], abc: '', ...over });

describe('key familiarity', () => {
  it('counts every key practiced, by root, with older and rougher sessions counting less', () => {
    const t = tune();
    const log = [
      entry(t.id, TODAY, { key: 3 }), // E♭
      entry(t.id, TODAY, { key: 15 }), // E♭m counts toward E♭ too
      entry(t.id, '2026-09-15', { key: 5 }), // F, 3 weeks ago: half weight
      entry(t.id, TODAY, { keys: [7, 2], rating: 'rough' }), // an exercise in G and D
    ];
    const f = keyFamiliarity(log, TODAY);
    expect(f[3]).toBeCloseTo(2);
    expect(f[5]).toBeCloseTo(0.5);
    expect(f[7]).toBeCloseTo(0.5);
    expect(f[0]).toBe(0);
    expect(keySessions(30, log, TODAY)[3]).toBe(2);
  });
});

describe('exercise keys', () => {
  it('continues around the cycle of 4ths from the last key played', () => {
    const first = chooseExerciseKeys(exercise({ keyMode: 'fourths' }), { played: [] });
    expect((first[1] - first[0] + 12) % 12).toBe(5); // starts anywhere, then goes up in 4ths
    expect(chooseExerciseKeys(exercise({ keyMode: 'fourths' }), { played: [0, 5, 10] })).toEqual([3, 8, 1]);
    expect(chooseExerciseKeys(exercise({ keyMode: 'fourths', keysPerSession: 2 }), { played: [7] })).toEqual([0, 5]); // G → C → F
  });

  it('goes chromatically, wrapping around', () => {
    expect(chooseExerciseKeys(exercise({ keyMode: 'chromatic', keysPerSession: 2 }), { played: [11] })).toEqual([0, 1]);
  });

  it('uses only chosen keys, least practiced first', () => {
    const x = exercise({ keyMode: 'fixed', keys: [0, 7, 5], keysPerSession: 2 });
    expect(chooseExerciseKeys(x, { played: [0, 0, 7] })).toEqual([5, 7]);
  });

  it('returns no keys for keyless exercises, and never repeats a key', () => {
    expect(chooseExerciseKeys(exercise({ keyMode: 'none' }))).toEqual([]);
    const keys = chooseExerciseKeys(exercise({ keyMode: 'random', keysPerSession: 12 }));
    expect([...keys].sort((a, b) => a - b)).toEqual([...Array(12).keys()]);
  });

  it('favours weak keys', () => {
    const familiarity = Array(12).fill(10);
    familiarity[6] = 0; // never play G♭
    const picks = Array.from({ length: 200 }, () => chooseExerciseKeys(exercise({ keysPerSession: 1 }), { familiarity })[0]);
    expect(picks.filter((k) => k === 6).length).toBeGreaterThan(150);
  });
});

describe('exercises in the daily set', () => {
  it('get their own slots, separate from tunes, with keys chosen', () => {
    const items = [
      ...Array.from({ length: 4 }, () => exercise()),
      ...Array.from({ length: 6 }, () => tune({ level: 2 })),
      ...Array.from({ length: 6 }, () => tune({ level: 1 })),
      ...Array.from({ length: 3 }, () => tune({ level: 0 })),
    ];
    setState(items, { settings: { tuneOrder: 'group' } });
    buildPlan();
    const plan = store.state.plan.items;
    expect(plan.map((i) => i.bucket)).toEqual(['exercise', 'exercise', 'hone', 'learn', 'learn', 'fresh']);
    for (const i of plan.slice(0, 2)) expect(i.keys).toHaveLength(3);
  });

  it('logs every key practiced', () => {
    const x = exercise();
    setState([x]);
    markPlayed(x.id, { keys: [3, 8, 1] });
    expect(store.state.log[0].keys).toEqual([3, 8, 1]);
    const s = itemStats().get(x.id);
    expect(s.keys).toEqual([3, 8, 1]);
    expect(s.keyLast[8]).toBe(TODAY);
  });
});

describe('upgrading mid-day', () => {
  it('adds exercises once to a set made before exercises existed', async () => {
    const { ensurePlan } = await import('../src/plan.js');
    const t = tune({ level: 1 });
    setState([t, exercise(), exercise(), exercise()], {
      plan: { date: TODAY, items: [{ itemId: t.id, bucket: 'learn', key: null }], skipped: [], focusSkipped: [] },
    });
    ensurePlan();
    expect(store.state.plan.items.map((i) => i.bucket)).toEqual(['exercise', 'exercise', 'learn']);
    store.state.plan.items.splice(0, 1); // e.g. you skip one
    ensurePlan();
    expect(store.state.plan.items).toHaveLength(2);
  });
});

describe('exercises that vary the scale or chord', () => {
  it('get a type for each key in the plan, and the log keeps them', async () => {
    const { store } = await import('../src/store.js');
    const { makePlanItem } = await import('../src/plan.js');
    const { itemStats, markPlayed } = await import('../src/practice.js');
    const { setState, freezeToday } = await import('./helpers.js');
    freezeToday();
    setState([{ id: 'sc', type: 'exercise', name: 'Scales', keyMode: 'random', keysPerSession: 3, vary: { kind: 'scale', types: ['major', 'dorian', 'harmonic'], shape: 'updown' } }]);
    const t = store.state.items[0];
    const item = makePlanItem(t, itemStats());
    expect(item.keys).toHaveLength(3);
    expect(item.types).toHaveLength(3);
    expect(new Set(item.types).size).toBe(3);
    markPlayed(t.id, item);
    expect(store.state.log[0].types).toEqual(item.types);
    expect(itemStats().get(t.id).types).toEqual(item.types);
  });

  it('with no keys, still get one type', async () => {
    const { store } = await import('../src/store.js');
    const { makePlanItem } = await import('../src/plan.js');
    const { itemStats } = await import('../src/practice.js');
    const { setState } = await import('./helpers.js');
    setState([{ id: 'c', type: 'exercise', name: 'Chords', keyMode: 'none', vary: { kind: 'chord', types: ['m7'] } }]);
    const item = makePlanItem(store.state.items[0], itemStats());
    expect(item.keys).toEqual([]);
    expect(item.types).toEqual(['m7']);
  });
});
