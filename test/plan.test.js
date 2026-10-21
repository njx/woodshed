import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { store } from '../src/store.js';
import { buildPlan, chooseKey, ensurePlan, syncFocus } from '../src/plan.js';
import { itemStats, markPlayed } from '../src/practice.js';
import { isMinor } from '../src/keys.js';
import { freezeToday, tune, setState, entry, TODAY } from './helpers.js';

beforeEach(() => freezeToday());
afterEach(() => vi.useRealTimers());

const library = () => [
  ...Array.from({ length: 6 }, () => tune({ level: 2 })),
  ...Array.from({ length: 6 }, () => tune({ level: 1 })),
  ...Array.from({ length: 6 }, () => tune({ level: 0 })),
];
const buckets = (plan) => plan.items.map((i) => i.bucket);

describe('daily set', () => {
  it('has the number of tunes set (four by default), no repeats', () => {
    setState(library());
    buildPlan();
    const plan = store.state.plan;
    expect(plan.date).toBe(TODAY);
    expect(plan.items).toHaveLength(4);
    expect(new Set(plan.items.map((i) => i.itemId)).size).toBe(4);
  });

  it('mixes the groups: rarely two from one while another has tunes, and each comes up across days', () => {
    let doubled = 0;
    const seen = { hone: 0, learn: 0, fresh: 0 };
    for (let n = 0; n < 60; n++) {
      setState(library(), { settings: { tunes: 2 } });
      buildPlan();
      const b = buckets(store.state.plan);
      if (b[0] === b[1]) doubled++;
      for (const x of b) seen[x]++;
    }
    expect(doubled).toBeLessThan(15);
    for (const n of Object.values(seen)) expect(n).toBeGreaterThan(15);
  });

  it('a group that’s come up the last few days pulls less', () => {
    const items = library();
    const log = ['2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05'].flatMap((d) => items.filter((t) => t.level >= 2).slice(0, 2).map((t) => entry(t.id, d)));
    let hone = 0;
    for (let n = 0; n < 120; n++) {
      setState(items, { log, settings: { tunes: 1, priority: 'off' } });
      buildPlan();
      if (buckets(store.state.plan)[0] === 'hone') hone++;
    }
    expect(hone).toBeLessThan(25); // (40 if all pulled the same)
  });

  it('goes by priority: a group with a critical tune pulls harder', () => {
    const items = library();
    items[17].priority = 1; // a new tune, critical
    let fresh = 0;
    for (let n = 0; n < 120; n++) {
      setState(items, { settings: { tunes: 1, priority: 'strong' } });
      buildPlan();
      if (buckets(store.state.plan)[0] === 'fresh') fresh++;
    }
    expect(fresh).toBeGreaterThan(60); // (40 if all pulled the same)
  });

  it('counts focus tunes in the number, up to the focus maximum', () => {
    const items = library();
    for (const i of [0, 7, 13]) items[i].focus = true;
    setState(items, { settings: { tunes: 4, focusTunes: 2 } });
    buildPlan();
    expect(buckets(store.state.plan).filter((b) => b === 'focus')).toHaveLength(2);
    expect(store.state.plan.items).toHaveLength(4);
    // More focus tunes allowed than the number: just the number.
    setState(items, { settings: { tunes: 2, focusTunes: 3 } });
    buildPlan();
    expect(buckets(store.state.plan)).toEqual(['focus', 'focus']);
  });

  it('mixes the tunes up by default, in an order that holds for the day', () => {
    const seen = new Set();
    for (let n = 0; n < 12; n++) {
      setState(library(), { settings: { tunes: 4 } });
      buildPlan();
      seen.add(buckets(store.state.plan).join());
    }
    expect(seen.size).toBeGreaterThan(1); // not always hone first
    const order = store.state.plan.items.map((i) => i.itemId);
    ensurePlan();
    syncFocus();
    expect(store.state.plan.items.map((i) => i.itemId)).toEqual(order);
  });

  it('fills from other groups when one runs out', () => {
    setState([tune({ level: 2 }), ...Array.from({ length: 5 }, () => tune({ level: 0 }))]);
    buildPlan();
    expect(store.state.plan.items).toHaveLength(4);
  });

  it('puts focus items first, unless skipped today', () => {
    const items = library();
    items[15].focus = true;
    setState(items);
    buildPlan();
    expect(buckets(store.state.plan)[0]).toBe('focus'); // focus first, even mixed
    expect(store.state.plan.items).toHaveLength(4);

    store.state.plan.focusSkipped.push(items[15].id);
    store.state.plan.items.shift();
    syncFocus();
    expect(store.state.plan.items.some((i) => i.itemId === items[15].id)).toBe(false);
  });

  it('keeps what you have played when rebuilding', () => {
    setState(library());
    buildPlan();
    const played = store.state.plan.items[2].itemId;
    markPlayed(played);
    buildPlan(true);
    expect(store.state.plan.items.map((i) => i.itemId)).toContain(played);
    expect(store.state.plan.items).toHaveLength(4);
  });

  it('starts a new set on a new day', () => {
    setState(library(), { plan: { date: '2026-10-05', items: [], skipped: [], focusSkipped: [] } });
    ensurePlan();
    expect(store.state.plan.date).toBe(TODAY);
    expect(store.state.plan.items).toHaveLength(4);
  });

  it('prefers overdue tunes over ones just reviewed', () => {
    const fresh = tune({ level: 2, ivl: 10 });
    const stale = tune({ level: 2, ivl: 2 });
    setState([fresh, stale], {
      log: [entry(fresh.id, '2026-10-05'), entry(stale.id, '2026-09-20')],
      settings: { tunes: 1 },
    });
    const picks = Array.from({ length: 50 }, () => { buildPlan(); return store.state.plan.items[0].itemId; });
    expect(picks.filter((id) => id === stale.id).length).toBeGreaterThan(45);
  });
});

describe('key choice', () => {
  it('rotates through the usual keys, least practiced first', () => {
    const t = tune({ level: 1, keys: [19, 16] }); // Gm, Em
    setState([t], { log: [entry(t.id, '2026-10-01', { key: 19 })] });
    expect(chooseKey(t, itemStats())).toEqual({ key: 16, alt: false, shift: null });
  });

  it('suggests a different key of the same quality for mastered tunes', () => {
    const t = tune({ level: 3, keys: [19, 16] });
    setState([t]);
    for (let i = 0; i < 20; i++) {
      const c = chooseKey(t, itemStats());
      expect(c.alt).toBe(true);
      expect(t.keys).not.toContain(c.key);
      expect(isMinor(c.key)).toBe(true);
    }
  });

  it('falls back to an interval when a mastered tune has no keys set', () => {
    const t = tune({ level: 3 });
    setState([t]);
    const c = chooseKey(t, itemStats());
    expect(c.key).toBe(null);
    expect(c.shift).toBeGreaterThanOrEqual(1);
  });
});
