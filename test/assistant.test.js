import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { store } from '../src/store.js';
import { runTool, validate, TOOLS, apiTools, appSnapshot, takeChanges, concertKey } from '../src/assistant/tools.js';
import { buildPlan } from '../src/plan.js';
import { markPlayed } from '../src/practice.js';
import { freezeToday, tune, setState, entry } from './helpers.js';

let solar, stella, scale;
beforeEach(() => {
  freezeToday();
  solar = tune({ name: 'Solar', style: 'Jazz Standard', level: 1, keys: [12], priority: 1 }); // Cm
  stella = tune({ name: 'Stella by Starlight', style: 'Standard', level: 2, keys: [10] }); // B♭
  scale = tune({ type: 'exercise', name: 'Major scale', category: 'scale', keyMode: 'weak', keysPerSession: 2, keys: [], abc: 'C D E F |' });
  setState([solar, stella, scale, tune({ name: 'Naima', style: 'Ballad', level: 0 })], {
    settings: { instruments: ['bb', 'c'], view: 'bb', hone: 1, learn: 1, fresh: 0, exercises: 0 },
    log: [entry(stella.id, '2026-09-01', { key: 10, rating: 'solid', bpm: 120 })],
  });
  takeChanges();
});
afterEach(() => vi.useRealTimers());

describe('tool definitions', () => {
  it('are schemas the API accepts: optional fields are the nullable ones, no extras', () => {
    for (const t of apiTools()) {
      // Strict mode would cap the tools at 16 nullable fields in total (the API answers 400).
      expect(t.strict).toBeUndefined();
      const check = (s) => {
        if (s.type === 'object' || (Array.isArray(s.type) && s.type.includes('object'))) {
          expect(s.additionalProperties).toBe(false);
          const required = Object.keys(s.properties).filter((k) => ![].concat(s.properties[k].type).includes('null'));
          expect([...s.required].sort()).toEqual(required.sort());
          Object.values(s.properties).forEach(check);
        }
        if (s.items) check(s.items);
        if (s.enum && [].concat(s.type).includes('null')) expect(s.enum).toContain(null);
      };
      check(t.input_schema);
    }
  });

  it('validates inputs', () => {
    const schema = TOOLS.find((t) => t.name === 'update_item').input_schema;
    const ok = { item_id: 'x', level: null, priority: 'high', focus: null, tempo: 100, goal_tempo: null, keys: null, notes_append: null };
    expect(validate(schema, ok)).toBe(null);
    expect(validate(schema, { ...ok, priority: 'urgent' })).toMatch(/priority/);
    expect(validate(schema, { ...ok, tempo: '100' })).toMatch(/tempo/);
    expect(validate(schema, { item_id: 'x', priority: 'high' })).toBe(null); // optional fields left out
    expect(validate(schema, { priority: 'high' })).toMatch(/item_id is missing/);
    expect(runTool('update_item', { priority: 'high' }).error).toMatch(/Invalid input/);
  });
});

describe('reading', () => {
  it('names keys as written for the instrument being viewed', () => {
    expect(concertKey('Dm')).toBe(12); // written Dm on tenor = concert Cm
    const res = runTool('search_library', { query: 'solar', type: null, levels: null, style: null, key: null, due_only: null, focus_only: null, not_played_in_days: null, sort: null, limit: null });
    expect(res.items[0]).toMatchObject({ name: 'Solar', keys: ['Dm'], level: 'familiar', priority: 'critical' });
  });

  it('filters by key, level and how long ago', () => {
    const base = { query: null, type: 'tune', levels: null, style: null, key: null, due_only: null, focus_only: null, not_played_in_days: null, sort: null, limit: null };
    expect(runTool('search_library', { ...base, key: 'C' }).items.map((i) => i.name)).toEqual(['Stella by Starlight']); // concert B♭
    expect(runTool('search_library', { ...base, levels: ["don't know"] }).items.map((i) => i.name)).toEqual(['Naima']);
    expect(runTool('search_library', { ...base, not_played_in_days: 14 }).total).toBe(3); // never played, or Stella a month ago
  });

  it('describes an item with its history', () => {
    const res = runTool('get_item', { item_id: stella.id });
    expect(res.history[0]).toMatchObject({ date: '2026-09-01', keys: ['C'], rating: 'solid', tempo: 120 });
    expect(runTool('get_item', { item_id: 'nope' }).error).toMatch(/No item/);
  });

  it('summarizes the app for each message', () => {
    buildPlan();
    expect(appSnapshot()).toMatch(/Keys are shown for B♭ instruments/);
    expect(appSnapshot()).toMatch(/Today's set: /);
  });
});

describe('changing things', () => {
  it('adds to today with a chosen key, and reports what changed', () => {
    buildPlan();
    const res = runTool('add_to_today', { items: [{ item_id: scale.id, keys: ['F', 'G'] }, { item_id: 'nope', keys: null }] });
    expect(res.added).toEqual(['Major scale']);
    expect(res.notes[0]).toMatch(/No item with id nope/);
    const item = store.state.plan.items.find((i) => i.itemId === scale.id);
    expect(item.keys).toEqual([3, 5]); // concert E♭ and F
    expect(takeChanges()).toEqual(['Added to today: Major scale']);
  });

  it('removes unplayed items and keeps played ones', () => {
    buildPlan();
    const [a, b] = store.state.plan.items.map((i) => i.itemId);
    markPlayed(a);
    const res = runTool('remove_from_today', { item_ids: [a, b] });
    expect(res.removed).toHaveLength(1);
    expect(res.already_played_so_kept).toHaveLength(1);
    expect(store.state.plan.items.map((i) => i.itemId)).toEqual([a]);
    expect(store.state.plan.skipped).toContain(b);
  });

  it('updates items', () => {
    runTool('update_item', { item_id: solar.id, level: 'proficient', priority: 'low', focus: true, tempo: 132, goal_tempo: 180, keys: ['Dm', 'Em'], notes_append: 'Watch the bridge' });
    expect(solar).toMatchObject({ level: 2, priority: 4, focus: true, tempo: 132, goalTempo: 180, keys: [12, 14] });
    expect(solar.notes).toBe('Watch the bridge');
  });

  it('creates exercises and tunes, optionally adding them to today', () => {
    buildPlan();
    const res = runTool('create_exercise', { name: 'Enclosures', category: 'pattern', key_mode: 'fourths', keys_per_session: 3, keys: null, abc: 'B c ^c d |', meter: null, tempo: 90, notes: null, add_to_today: true });
    const x = store.state.items.find((t) => t.id === res.created);
    expect(x).toMatchObject({ type: 'exercise', keyMode: 'fourths', keysPerSession: 3, abc: 'B c ^c d |', tempo: 90 });
    expect(store.state.plan.items.some((i) => i.itemId === x.id)).toBe(true);
    runTool('create_tune', { name: 'Moanin’', style: 'Jazz Standard', keys: ['G'], level: null, priority: 'high', add_to_today: false });
    expect(store.state.items.find((t) => t.name === 'Moanin’')).toMatchObject({ keys: [5], priority: 2, mine: true });
  });

  it('writes diary notes and remembers unsupported requests', () => {
    runTool('add_diary_note', { text: 'Ask about altissimo', flag: 'teacher', item_id: null });
    expect(store.state.diary[0]).toMatchObject({ text: 'Ask about altissimo', flag: 'teacher' });
    runTool('report_unsupported', { request: 'Email my teacher' });
    expect(store.state.assistantWishes[0].request).toBe('Email my teacher');
  });
});

describe('deleting', () => {
  it('deletes an item with its history, keeps notes about it, and lists the change', () => {
    setState([tune({ id: 'a', name: 'Solar' }), { id: 'x', type: 'exercise', name: 'Oops exercise' }], {
      log: [entry('x', '2026-10-05'), entry('a', '2026-10-05')],
    });
    store.state.diary.push({ id: 'n1', date: '2026-10-05', text: 'about it', itemId: 'x', media: [] });
    buildPlan(true);
    takeChanges();
    const r = runTool('delete_item', { item_id: 'x' });
    expect(r).toEqual({ deleted: 'Oops exercise', practice_sessions_removed: 1 });
    expect(store.state.items.map((t) => t.id)).toEqual(['a']);
    expect(store.state.log.map((e) => e.itemId)).toEqual(['a']);
    expect(store.state.plan.items.some((i) => i.itemId === 'x')).toBe(false);
    expect(store.state.diary[0]).toMatchObject({ text: 'about it', itemId: null });
    expect(takeChanges()).toEqual(['Deleted exercise: Oops exercise (and 1 practice session)']);
  });

  it('reports an unknown item instead of failing', () => {
    setState([tune({ id: 'a' })]);
    expect(runTool('delete_item', { item_id: 'nope' }).error).toMatch(/No item/);
    expect(store.state.items).toHaveLength(1);
  });
});

describe('exercises that vary the scale or chord', () => {
  const blank = { category: 'scale', key_mode: 'weak', keys_per_session: 3, keys: null, abc: null, meter: null, tempo: null, notes: null, add_to_today: false };
  const noChange = { level: null, priority: null, focus: null, tempo: null, goal_tempo: null, keys: null, notes_append: null };

  it('creates one, with chosen types in catalogue order', () => {
    setState([]);
    const r = runTool('create_exercise', { ...blank, name: 'Minor scales', vary: 'scale', types: ['melodic', 'dorian', 'harmonic'], shape: 'thirds', pattern: null });
    expect(r.created).toBeTruthy();
    expect(store.state.items[0].vary).toEqual({ kind: 'scale', types: ['dorian', 'harmonic', 'melodic'], shape: 'thirds', pattern: '' });
  });

  it('refuses unknown types, shapes that don’t fit, and bad patterns', () => {
    setState([]);
    expect(runTool('create_exercise', { ...blank, name: 'X', vary: 'chord', types: ['dorian'] }).error).toMatch(/Not chord types: dorian/);
    expect(runTool('create_exercise', { ...blank, name: 'X', vary: 'chord', shape: 'thirds' }).error).toMatch(/isn't available/);
    expect(runTool('create_exercise', { ...blank, name: 'X', vary: 'chord', shape: 'custom', pattern: '1 2' }).error).toMatch(/chord tones/);
    expect(runTool('create_exercise', { ...blank, name: 'X', types: ['major'] }).error).toMatch(/Set vary/);
    expect(store.state.items).toHaveLength(0);
  });

  it('turns variation on, changes it, and turns it off; today’s types follow', () => {
    setState([{ id: 'x', type: 'exercise', name: 'Arps', keyMode: 'random', keysPerSession: 2, abc: 'C E G c' }]);
    buildPlan(true);
    takeChanges();
    runTool('update_item', { ...noChange, item_id: 'x', vary: 'chord', types: ['m7', 'dom7'] });
    expect(store.state.items[0].vary).toMatchObject({ kind: 'chord', types: ['m7', 'dom7'], shape: 'updown' });
    const item = store.state.plan.items.find((i) => i.itemId === 'x');
    expect(item.types).toHaveLength(2);
    expect(item.types.every((id) => ['m7', 'dom7'].includes(id))).toBe(true);
    expect(takeChanges()[0]).toMatch(/varies chord: Minor 7, Dominant 7/);
    // Only the types change; the kind stays.
    runTool('update_item', { ...noChange, item_id: 'x', types: ['dim7'] });
    expect(store.state.items[0].vary.types).toEqual(['dim7']);
    expect(item.types).toEqual(['dim7', 'dim7']);
    runTool('update_item', { ...noChange, item_id: 'x', vary: 'none' });
    expect(store.state.items[0].vary).toBe(null);
    expect(item.types).toBeUndefined();
    expect(store.state.items[0].abc).toBe('C E G c'); // its own notation is kept
  });

  it('adds one to today with chosen keys and types, and reports them', () => {
    setState([{ id: 'x', type: 'exercise', name: 'Scales', keyMode: 'weak', keysPerSession: 2, vary: { kind: 'scale', types: ['major', 'dorian', 'harmonic'], shape: 'updown' } }]);
    store.state.settings.view = 'c';
    buildPlan(true);
    store.state.plan.items = [];
    const r = runTool('add_to_today', { items: [{ item_id: 'x', keys: ['F', 'Bb'], types: ['harmonic', 'lydian'] }] });
    expect(r.notes[0]).toMatch(/lydian isn't turned on/);
    const item = store.state.plan.items[0];
    expect(item.keys).toEqual([5, 10]);
    expect(item.types[0]).toBe('harmonic');
    expect(item.types).toHaveLength(2);
    const today = runTool('get_today', {});
    const listed = today.items ? today.items.find((i) => i.item_id === 'x') : today.find?.((i) => i.item_id === 'x');
    expect(listed.types[0]).toBe('Harmonic minor');
  });
});
