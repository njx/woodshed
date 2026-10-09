import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { store, loadState, migrate, seedState, flush, SCHEMA_VERSION } from '../src/store.js';
import { kvGet, _resetDb } from '../src/db.js';

const v1 = () => ({
  version: 1,
  tunes: [{ id: 'a', name: 'Solar', style: 'Jazz Standard', priority: 1, level: 2, keys: [12], notes: '', ivl: 4, due: '2026-10-08' }],
  log: [{ id: 'e1', date: '2026-10-04', tuneId: 'a', key: 12, rating: 'solid', prev: {} }],
  plan: { date: '2026-10-06', items: [{ tuneId: 'a', bucket: 'hone', key: 12 }], skipped: [], focusSkipped: [] },
  settings: { instruments: ['bb', 'c'], view: 'bb', instrumentsChosen: true },
});

beforeEach(async () => {
  await _resetDb();
  await new Promise((resolve) => { indexedDB.deleteDatabase('woodshed').onsuccess = resolve; });
  const data = new Map();
  globalThis.localStorage = {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: (k) => data.delete(k),
  };
});

describe('migration', () => {
  it('turns version 1 tunes into practice items', () => {
    const s = migrate(v1());
    expect(s.version).toBe(SCHEMA_VERSION);
    expect(s.tunes).toBeUndefined();
    expect(s.items[0]).toMatchObject({ id: 'a', type: 'tune', name: 'Solar', seedName: 'Solar', level: 2 });
    expect(s.log[0]).toMatchObject({ itemId: 'a' });
    expect(s.log[0].tuneId).toBeUndefined();
    expect(s.plan.items[0]).toMatchObject({ itemId: 'a', bucket: 'hone' });
    expect(s.settings).toMatchObject({ view: 'bb', listen: 'apple', hone: 1 }); // v8: one hone tune
  });

  it('adds starter exercises to version 2 data once', () => {
    const s = migrate(migrate(v1()));
    expect(s.version).toBe(SCHEMA_VERSION);
    expect(s.items.filter((t) => t.type === 'exercise').length).toBe(15);
  });

  it('adds the exercises that vary scale or chord to version 3 data, once', () => {
    const v3 = migrate(v1());
    v3.version = 3;
    v3.items = v3.items.filter((t) => !t.vary); // as saved before version 4
    const s = migrate(migrate(v3));
    const varied = s.items.filter((t) => t.vary);
    expect(varied.map((t) => t.name)).toEqual(['Scales: major and minors', 'Scale patterns: 1-2-3-5', 'Seventh-chord arpeggios']);
    expect(varied[0].vary).toEqual({ kind: 'scale', types: ['major', 'dorian', 'aeolian', 'harmonic', 'melodic', 'dimHW'], shape: 'updown', pattern: '' });
    expect(s.items.filter((t) => t.type === 'exercise').length).toBe(15);
  });

  it('leaves current data alone', () => {
    const s = seedState();
    const before = JSON.stringify(s);
    expect(JSON.stringify(migrate(s))).toBe(before);
  });
});

describe('loading and saving', () => {
  it('seeds the tune list on first run', async () => {
    await loadState();
    const tunes = store.state.items.filter((t) => t.type === 'tune');
    const exercises = store.state.items.filter((t) => t.type === 'exercise');
    expect(tunes.length).toBe(301);
    expect(tunes.every((t) => t.seedName)).toBe(true);
    expect(exercises.map((x) => x.name)).toContain('Major scale');
  });

  it('picks up data saved by version 1 and moves it to IndexedDB', async () => {
    localStorage.setItem('woodshed.v1', JSON.stringify(v1()));
    await loadState();
    expect(store.state.items.filter((t) => t.type === 'tune').map((t) => t.name)).toEqual(['Solar']);
    expect(store.state.items.some((t) => t.type === 'exercise')).toBe(true); // starter exercises added
    expect((await kvGet('state')).items[0].name).toBe('Solar');
  });

  it('round-trips through IndexedDB', async () => {
    await loadState();
    store.state.items[0].notes = 'check the bridge';
    await flush();
    store.state = null;
    await loadState();
    expect(store.state.items[0].notes).toBe('check the bridge');
  });
});

describe('chord symbols for the starter exercises (v9)', () => {
  it('added to notation that hasn’t been changed, not to edited notation', () => {
    const s = migrate({
      version: 8,
      items: [
        { id: 'a', type: 'exercise', name: 'ii–V–I, 1-2-3-5', abc: 'D E F A G A B d | c8 |' },
        { id: 'b', type: 'exercise', name: 'Major scale', abc: 'C D E F G A B c | B A G F E D C4 |' }, // edited
      ],
      log: [],
    });
    expect(s.items.find((t) => t.id === 'a').abc).toBe('"Dm7"D E F A "G7"G A B d | "Cmaj7"c8 |');
    expect(s.items.find((t) => t.id === 'b').abc).toBe('C D E F G A B c | B A G F E D C4 |');
  });
});
