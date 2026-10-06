import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { store } from '../src/store.js';
import { schedule, overdue, isDue, itemStats, markPlayed, unmarkPlayed, rate, setLevel, levelSuggestion } from '../src/practice.js';
import { freezeToday, tune, setState, entry, TODAY } from './helpers.js';

beforeEach(() => freezeToday());
afterEach(() => vi.useRealTimers());

describe('spaced repetition', () => {
  it('starts at the base interval for the level, longer when solid, tomorrow when rough', () => {
    const t = tune({ level: 2 }); // proficient: base 4 days
    schedule(t, 'ok', {});
    expect(t.ivl).toBe(4);
    expect(t.due).toBe('2026-10-10');
    schedule(t, 'solid', {});
    expect(t.ivl).toBe(6);
    schedule(t, 'rough', { ivl: 20 });
    expect(t.ivl).toBe(1);
  });

  it('grows the interval on later sessions and caps it per level', () => {
    const t = tune({ level: 1 }); // familiar: base 2, max 30
    schedule(t, 'ok', { ivl: 10 });
    expect(t.ivl).toBe(16);
    schedule(t, 'solid', { ivl: 10 });
    expect(t.ivl).toBe(25);
    schedule(t, 'solid', { ivl: 20 });
    expect(t.ivl).toBe(30);
  });

  it('measures how overdue an item is', () => {
    const a = tune({ level: 2, ivl: 4 });
    const b = tune({ level: 2 });
    setState([a, b], { log: [entry(a.id, '2026-09-28')] });
    const stats = itemStats();
    expect(overdue(a, stats)).toBe(2); // 8 days on a 4-day interval
    expect(overdue(b, stats)).toBe(2); // never played counts as overdue
  });

  it('counts rated items whose review date has come as due', () => {
    const due = tune({ level: 1, due: '2026-10-05' });
    const later = tune({ level: 1, due: '2026-10-09' });
    const fresh = tune({ level: 1 });
    const unrated = tune({ level: null });
    setState([due, later, fresh, unrated]);
    const stats = itemStats();
    expect([due, later, fresh, unrated].map((t) => isDue(t, stats))).toEqual([true, false, true, false]);
  });
});

describe('logging', () => {
  it('marking played schedules the next review; unmarking restores it', () => {
    const t = tune({ level: 2, ivl: 8, due: '2026-10-06' });
    setState([t]);
    markPlayed(t.id, { key: 3 });
    expect(store.state.log).toHaveLength(1);
    expect(store.state.log[0]).toMatchObject({ itemId: t.id, date: TODAY, key: 3, rating: 'ok' });
    expect(t.ivl).toBe(13);
    rate(t.id, 'rough');
    expect(t.ivl).toBe(1);
    unmarkPlayed(t.id);
    expect(store.state.log).toHaveLength(0);
    expect(t).toMatchObject({ ivl: 8, due: '2026-10-06' });
  });

  it('only logs an item once per day', () => {
    const t = tune({ level: 1 });
    setState([t]);
    markPlayed(t.id);
    markPlayed(t.id);
    expect(store.state.log).toHaveLength(1);
  });
});

describe('level suggestions', () => {
  it('suggests moving up after three solid sessions in a row', () => {
    const t = tune({ level: 1 });
    setState([t], { log: ['2026-10-01', '2026-10-03', '2026-10-05'].map((d) => entry(t.id, d, { rating: 'solid' })) });
    expect(levelSuggestion(t)).toMatchObject({ to: 2, up: true });
  });

  it('suggests moving down after two rough sessions in a row', () => {
    const t = tune({ level: 2 });
    setState([t], { log: [entry(t.id, '2026-10-04', { rating: 'rough' }), entry(t.id, '2026-10-05', { rating: 'rough' })] });
    expect(levelSuggestion(t)).toMatchObject({ to: 1, up: false });
  });

  it('ignores sessions from before the level last changed', () => {
    const t = tune({ level: 1 });
    setState([t], { log: ['2026-10-01', '2026-10-03', '2026-10-05'].map((d) => entry(t.id, d, { rating: 'solid' })) });
    setLevel(t, 2);
    expect(levelSuggestion(t)).toBe(null);
  });

  it('does not suggest going past mastered or below don’t know', () => {
    const top = tune({ level: 3 });
    const bottom = tune({ level: 0 });
    setState([top, bottom], {
      log: [
        ...['2026-10-01', '2026-10-03', '2026-10-05'].map((d) => entry(top.id, d, { rating: 'solid' })),
        ...['2026-10-04', '2026-10-05'].map((d) => entry(bottom.id, d, { rating: 'rough' })),
      ],
    });
    expect(levelSuggestion(top)).toBe(null);
    expect(levelSuggestion(bottom)).toBe(null);
  });
});
