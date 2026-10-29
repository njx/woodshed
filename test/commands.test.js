import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { store } from '../src/store.js';
import { exec, undo, canUndo, invalidateUndo, dataChanged, beginGroup, endGroup, CommandError, command, f, readInput } from '../src/commands/core.js';
import { updateItem, removeFromToday, deleteItem, changeSettings, markPlayed, rateToday, addRecording, removeRecording, startPractice, addNote, updateNote, addToToday, COMMANDS } from '../src/commands/index.js';
import { running, startPractice as startTimer } from '../src/practicetime.js';
import { buildPlan, ensurePlan } from '../src/plan.js';
import { freezeToday, tune, setState } from './helpers.js';
import { normalize } from '../src/store.js';

beforeEach(() => {
  freezeToday();
  setState([tune({ id: 'a', name: 'Solar', keys: [12], level: 1 }), tune({ id: 'b', name: 'Stella', keys: [10], level: 2 })], {
    settings: { instruments: ['bb', 'c'], view: 'bb', tunes: 2, exercises: 0 },
  });
  buildPlan();
  invalidateUndo();
});
afterEach(() => vi.useRealTimers());

describe('commands', () => {
  it('run all or nothing: one that fails partway leaves everything as it was', () => {
    const bad = command({
      name: 'bad', fields: {},
      run() { store.state.items[0].name = 'Changed'; throw new CommandError('No'); },
    });
    const before = store.state;
    expect(() => exec(bad, {})).toThrow('No');
    expect(store.state.items[0].name).toBe('Solar');
    expect(store.state).not.toBe(before); // (put back: a new object, which the app's sheets let go of)
  });

  it('that fail before changing anything leave the state as the same object', () => {
    const before = store.state;
    expect(() => exec(updateItem, { item: 'a', name: '   ' })).toThrow(/empty/);
    expect(store.state).toBe(before);
  });

  it('go on the undo stack; undo puts back the latest, and then the one before', () => {
    const a = exec(updateItem, { item: 'a', level: 3 });
    const b = exec(updateItem, { item: 'b', priority: 1 });
    expect(canUndo(a.undo)).toBe(false); // (not the latest)
    expect(undo(b.undo)).toBe(true);
    expect(store.state.items[1].priority).not.toBe(1);
    expect(canUndo(a.undo)).toBe(true);
    expect(undo(a.undo)).toBe(true);
    expect(store.state.items[0].level).toBe(1);
  });

  it('make typing into a field one undo', () => {
    let last;
    for (const text of ['W', 'Wa', 'Wat', 'Watch']) last = exec(updateItem, { item: 'a', notes: text });
    expect(undo(last.undo)).toBe(true);
    expect(store.state.items[0].notes).toBe('');
  });

  it('can’t be undone once something else has changed the data (but can after a save that didn’t)', () => {
    const a = exec(updateItem, { item: 'a', level: 3 });
    store.state.hintsSeen.push('x'); // a hint seen
    expect(canUndo(a.undo)).toBe(true);
    invalidateUndo(); // e.g. a new day's set
    expect(canUndo(a.undo)).toBe(false);
  });

  it('after the data changes on its own (an import, a copy put back), an older undo doesn’t come back', () => {
    const a = exec(updateItem, { item: 'a', level: 3 });
    invalidateUndo();
    const b = exec(updateItem, { item: 'b', priority: 1 });
    expect(undo(b.undo)).toBe(true);
    expect(canUndo(a.undo)).toBe(false);
  });

  it('a new day’s set makes earlier undos stale', () => {
    const a = exec(updateItem, { item: 'a', level: 3 });
    store.state.plan.date = '2026-10-05'; // (yesterday's)
    ensurePlan();
    expect(canUndo(a.undo)).toBe(false);
  });

  it('after one is undone, the one before it can be undone next', () => {
    const a = exec(updateItem, { item: 'a', level: 3 });
    const b = exec(updateItem, { item: 'b', priority: 1 });
    undo(b.undo);
    expect(undo(a.undo)).toBe(true);
    expect(store.state.items[0].level).toBe(1);
  });

  it('a change made outside the commands (time away counted, clips put back) makes undo stale', () => {
    const a = exec(updateItem, { item: 'a', level: 3 });
    dataChanged();
    expect(canUndo(a.undo)).toBe(false);
  });

  it('undo leaves the practice timer, and settings remembered as they’re used, as they are now', () => {
    const a = exec(updateItem, { item: 'a', level: 3 });
    startTimer();
    store.state.settings.metroBpm = 180;
    expect(undo(a.undo)).toBe(true);
    expect(running()).toBeTruthy();
    expect(store.state.settings.metroBpm).toBe(180);
  });

  it('undoing starting the timer stops it again', () => {
    const a = exec(startPractice, {});
    expect(running()).toBeTruthy();
    expect(undo(a.undo)).toBe(true);
    expect(running()).toBe(null);
  });

  it('a group (the assistant’s turn) is one undo, offered once it’s over; none if nothing ran', () => {
    beginGroup();
    const a = exec(updateItem, { item: 'a', level: 3 });
    exec(updateItem, { item: 'b', priority: 1 });
    expect(canUndo(a.undo)).toBe(false);
    const { undo: g, notes } = endGroup();
    expect(notes).toHaveLength(2);
    expect(undo(g)).toBe(true);
    expect(store.state.items[0].level).toBe(1);
    expect(store.state.items[1].priority).not.toBe(1);
    beginGroup();
    expect(endGroup().undo).toBe(null);
  });

  it('refuse an entry in today’s set that isn’t the item’s', () => {
    const b = store.state.plan.items.find((i) => i.itemId === 'b');
    expect(() => exec(markPlayed, { item: 'a', entry: b.pid })).toThrow(/isn’t Solar/);
    const a = store.state.plan.items.find((i) => i.itemId === 'a');
    exec(markPlayed, { item: 'a', entry: a.pid });
    expect(() => exec(rateToday, { item: 'b', entry: a.pid, rating: 'good' })).toThrow(/isn’t Stella/);
  });

  it('take away a recording by artist and album (one without: \'\'; left out: any)', () => {
    exec(addRecording, { tune: 'a', artist: 'Miles', album: 'Walkin' });
    exec(addRecording, { tune: 'a', artist: 'Miles' });
    exec(removeRecording, { tune: 'a', artist: 'Miles', album: '' });
    expect(store.state.items[0].recordings).toEqual([{ artist: 'Miles', album: 'Walkin' }]);
    exec(removeRecording, { tune: 'a', artist: 'Miles' });
    expect(store.state.items[0].recordings).toEqual([]);
  });

  it('log a lesson as a diary note: on a day (not one to come), with its time, and with no text needed', () => {
    const { added } = exec(addNote, { text: '', lesson: true, lesson_minutes: 45, date: '2026-10-04' }).result;
    expect(store.state.diary.find((e) => e.id === added)).toMatchObject({ date: '2026-10-04', lesson: true, lessonMs: 45 * 60000 });
    expect(() => exec(addNote, { text: 'x', lesson: true, date: '2026-10-07' })).toThrow(/hasn’t happened/);
    expect(() => exec(addNote, { text: '' })).toThrow(/needs some text/);
    exec(updateNote, { note: added, lesson_minutes: 60 });
    expect(store.state.diary.find((e) => e.id === added).lessonMs).toBe(60 * 60000);
    exec(updateNote, { note: added, lesson: false });
    expect(store.state.diary.find((e) => e.id === added)).not.toHaveProperty('lesson');
    expect(store.state.diary.find((e) => e.id === added)).not.toHaveProperty('lessonMs');
  });

  it('set how an exercise is used: either, on its own, or only with a tune (not added to today on its own)', () => {
    store.state.items.push(normalize({ version: 2, items: [{ ...tune({ id: 'x', name: 'Guide tones' }), type: 'exercise', category: 'pattern', keyMode: 'weak', keysPerSession: 2, keys: [], abc: '' }], log: [], settings: {} }).items[0]);
    const x = store.state.items.find((t) => t.id === 'x');
    exec(updateItem, { item: 'x', use: 'own' });
    expect(x).toMatchObject({ solo: true });
    exec(updateItem, { item: 'x', use: 'tunes' });
    expect(x).toMatchObject({ tunesOnly: true });
    expect(x).not.toHaveProperty('solo');
    expect(() => exec(addToToday, { item: 'x' })).toThrow(/only goes over a tune/);
    exec(updateItem, { item: 'x', use: 'either' });
    expect(x).not.toHaveProperty('tunesOnly');
    expect(x).not.toHaveProperty('solo');
  });

  it('say what they did', () => {
    const it = store.state.plan.items.find((i) => i.itemId === 'b');
    expect(exec(removeFromToday, { entry: it.pid }).notes).toEqual(['Took Stella out of today’s set']);
    expect(exec(changeSettings, { tunes: 3, tune_order: 'group' }).notes).toEqual(['Settings: tunes, tune order']);
  });

  it('log practice the way the card’s ✓ does, once', () => {
    const it = store.state.plan.items.find((i) => i.itemId === 'a');
    exec(markPlayed, { item: 'a', entry: it.pid, rating: 'rough' });
    expect(store.state.log.at(-1)).toMatchObject({ itemId: 'a', pid: it.pid, rating: 'rough' });
    expect(() => exec(markPlayed, { item: 'a', entry: it.pid })).toThrow(/already logged/);
  });
});

describe('the assistant’s side of a command', () => {
  it('reads key names as written for the instrument shown, and level names', () => {
    const input = readInput(updateItem, { item: 'a', keys: ['Dm', 'C'], level: 'mastered' });
    expect(input).toEqual({ item: 'a', keys: [12, 10], level: 3 }); // written on a B♭ instrument
  });

  it('refuses ids that aren’t there, and values outside the schema', () => {
    expect(() => readInput(updateItem, { item: 'nope' })).toThrow(/No item with id nope/);
    expect(() => readInput(updateItem, { item: 'a', level: 'expert' })).toThrow(/Invalid input/);
    expect(() => readInput(updateItem, { item: 'a', pattern_unfinished: true })).toThrow(/not a known field/);
  });

  it('asks before deleting something with practice history', () => {
    expect(deleteItem.ask({ item: 'a' })).toBe(null);
    exec(markPlayed, { item: 'a' });
    expect(deleteItem.ask({ item: 'a' })).toMatch(/Delete Solar and its 1 practice session/);
  });

  it('every command has a unique name', () => {
    const names = COMMANDS.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('a field can be the app’s own', () => {
    const c = command({ name: 'x', description: 'X', fields: { a: f.int(), b: f.opt(f.app()) }, run: () => ({}) });
    expect(readInput(c, { a: 1 })).toEqual({ a: 1 });
  });
});
