import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { store, loadState, flush, migrate, save } from '../src/store.js';
import { kvGet, kvSet, _resetDb } from '../src/db.js';
import { findItemByName } from '../src/diary.js';
import { chooseKey } from '../src/plan.js';
import { itemStats } from '../src/practice.js';
import { runTool } from '../src/assistant/tools.js';
import { tune, setState, freezeToday, TODAY } from './helpers.js';

let ls;
beforeEach(async () => {
  await _resetDb();
  await new Promise((resolve) => { indexedDB.deleteDatabase('woodshed').onsuccess = resolve; });
  ls = new Map();
  globalThis.localStorage = {
    getItem: (k) => (ls.has(k) ? ls.get(k) : null),
    setItem: (k, v) => ls.set(k, String(v)),
    removeItem: (k) => ls.delete(k),
  };
  store.state = null;
});
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe('saving and loading safely', () => {
  it('never writes over saved data before it has loaded', async () => {
    await kvSet('state', { version: 3, items: [tune({ name: 'Solar' })], log: [] });
    store.state = null; // still loading
    await flush();
    expect((await kvGet('state')).items[0].name).toBe('Solar');
  });

  it('does not start over when saved data can’t be read', async () => {
    await kvSet('state', { version: 3, items: [tune({ name: 'Solar' })], log: [] });
    vi.spyOn(IDBObjectStore.prototype, 'get').mockImplementation(() => { throw new Error('read failed'); });
    await expect(loadState()).rejects.toThrow();
    expect(store.state).toBe(null);
  });

  it('keeps a copy when a save fails, and loads it next time', async () => {
    await loadState();
    const put = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => { throw new Error('QuotaExceededError'); });
    store.state.items[0].notes = 'saved while storage was full';
    await flush(); // fails in IndexedDB; error handler reports it
    put.mockRestore();
    expect(ls.has('woodshed.kv.state')).toBe(true);
    store.state = null;
    await loadState();
    expect(store.state.items[0].notes).toBe('saved while storage was full');
    expect(ls.has('woodshed.kv.state')).toBe(false); // moved back into IndexedDB
  });

  it('counts saves, so an undo can tell if anything changed since', () => {
    setState([tune()]);
    const rev = store.rev;
    save();
    expect(store.rev).toBe(rev + 1);
  });
});

describe('checking imported data', () => {
  it('replaces unsafe ids and values instead of trusting them', () => {
    const evil = '"><img src=x onerror=alert(1)>';
    const s = migrate({
      version: 3,
      items: [
        { id: evil, type: 'exercise', name: 'Bad', priority: '"><b>', keyMode: evil, category: evil, keys: [3, 'x', 99], tempo: '120"' },
        { id: 'ok1', type: 'tune', name: 'Solar', keys: [12, -1], level: 9 },
      ],
      log: [{ id: 'e1', itemId: 'ok1', rating: 'solid' }, { id: 'e2', date: '2026-10-01', itemId: 'ok1', rating: evil, bpm: '9"' }],
      diary: [{ id: evil, date: '2026-10-01', text: 'hi', flag: evil, itemId: 'nope', media: [{ id: evil }, { id: 'c1', kind: evil }] }],
      plan: { date: '2026-10-01', items: [{ itemId: 'ok1', bucket: evil }, { itemId: 'gone' }] },
      settings: { view: evil, instruments: [evil, 'bb'], exercises: 'lots' },
    });
    const [ex, t] = s.items;
    expect(ex.id).toMatch(/^[\w-]+$/);
    expect(ex).toMatchObject({ priority: 2, keyMode: 'weak', category: 'other', keys: [3], tempo: null });
    expect(t).toMatchObject({ keys: [12], level: null });
    expect(s.log).toHaveLength(1); // the entry without a date is dropped
    expect(s.log[0]).toMatchObject({ rating: null, bpm: null, prev: { ivl: null, due: null } });
    expect(s.diary[0].id).toMatch(/^[\w-]+$/);
    expect(s.diary[0]).toMatchObject({ flag: null, itemId: null, media: [{ id: 'c1', kind: 'audio' }] });
    expect(s.plan.items).toEqual([expect.objectContaining({ itemId: 'ok1', bucket: 'learn' })]);
    expect(s.settings).toMatchObject({ instruments: ['bb'], view: 'bb', exercises: 2 });
  });

  it('leaves good data as it is', () => {
    const s = migrate({ version: 3, items: [tune({ id: 'a', name: 'Solar', keys: [12], level: 2, priority: 1, tempo: 140 })], log: [] });
    expect(s.items[0]).toMatchObject({ id: 'a', name: 'Solar', keys: [12], level: 2, priority: 1, tempo: 140 });
  });
});

describe('linking notes', () => {
  it('finds exercises as well as tunes by name', () => {
    setState([tune({ id: 'a', name: 'Solar' }), { id: 'x', type: 'exercise', name: 'Major scales' }]);
    expect(findItemByName('  major SCALES ')?.id).toBe('x');
    expect(findItemByName('solar')?.id).toBe('a');
    expect(findItemByName('')).toBe(null);
  });
});

describe('key suggestions', () => {
  it('suggests a usual key when a mastered tune is already in every key', () => {
    freezeToday(TODAY);
    setState([tune({ id: 'a', level: 3, keys: [...Array(12).keys()] })]);
    const k = chooseKey(store.state.items[0], itemStats());
    expect(k.key).toBeTypeOf('number');
  });
});

describe('assistant input checks', () => {
  it('refuses key names it can’t read, without changing anything', () => {
    setState([tune({ id: 'a', name: 'Solar', keys: [12], level: 1 })]);
    const r = runTool('update_item', { item_id: 'a', level: 'proficient', priority: null, focus: null, tempo: null, goal_tempo: null, keys: ['B flat major'], notes_append: null });
    expect(r.error).toMatch(/B flat major/);
    expect(store.state.items[0]).toMatchObject({ keys: [12], level: 1 });
  });

  it('refuses an empty name', () => {
    setState([]);
    const r = runTool('create_tune', { name: '   ', style: null, keys: null, level: null, priority: null, add_to_today: false });
    expect(r.error).toBeTruthy();
    expect(store.state.items).toHaveLength(0);
  });
});
