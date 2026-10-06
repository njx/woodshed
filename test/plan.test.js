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
  it('follows the hone / learn / new mix with no repeats', () => {
    setState(library());
    buildPlan();
    const plan = store.state.plan;
    expect(plan.date).toBe(TODAY);
    expect(buckets(plan)).toEqual(['hone', 'hone', 'learn', 'learn', 'fresh']);
    expect(new Set(plan.items.map((i) => i.itemId)).size).toBe(5);
  });

  it('fills from other groups when one runs out', () => {
    setState([tune({ level: 2 }), ...Array.from({ length: 5 }, () => tune({ level: 0 }))]);
    buildPlan();
    expect(store.state.plan.items).toHaveLength(5);
  });

  it('adds focus items on top of the mix, unless skipped today', () => {
    const items = library();
    items[15].focus = true;
    setState(items);
    buildPlan();
    expect(buckets(store.state.plan)[0]).toBe('focus');
    expect(store.state.plan.items).toHaveLength(6);

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
    expect(store.state.plan.items).toHaveLength(5);
  });

  it('starts a new set on a new day', () => {
    setState(library(), { plan: { date: '2026-10-05', items: [], skipped: [], focusSkipped: [] } });
    ensurePlan();
    expect(store.state.plan.date).toBe(TODAY);
    expect(store.state.plan.items).toHaveLength(5);
  });

  it('prefers overdue tunes over ones just reviewed', () => {
    const fresh = tune({ level: 2, ivl: 10 });
    const stale = tune({ level: 2, ivl: 2 });
    setState([fresh, stale], {
      log: [entry(fresh.id, '2026-10-05'), entry(stale.id, '2026-09-20')],
      settings: { hone: 1, learn: 0, fresh: 0 },
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
