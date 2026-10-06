import { vi } from 'vitest';
import { store, normalize } from '../src/store.js';

export const TODAY = '2026-10-06';

export function freezeToday(day = TODAY) {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(`${day}T12:00:00`));
}

let n = 0;
export function tune(over = {}) {
  n++;
  return { id: `t${n}`, type: 'tune', name: `Tune ${n}`, style: 'Standard', priority: 3, level: null, keys: [], notes: '', ivl: null, due: null, ...over };
}

export function setState(items, { log = [], plan = null, settings = {} } = {}) {
  store.state = normalize({ version: 2, items, log, plan, settings });
  return store.state;
}

export function entry(itemId, date, over = {}) {
  return { id: `${itemId}-${date}-${Math.random()}`, itemId, date, at: Date.parse(`${date}T12:00:00`), key: null, rating: 'ok', prev: {}, ...over };
}
