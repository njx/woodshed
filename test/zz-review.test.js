import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { store } from '../src/store.js';
import { exec, undo, canUndo, invalidateUndo, beginGroup, endGroup } from '../src/commands/core.js';
import { updateItem, startPractice, removeRecording, addRecording, deleteItem, addToToday } from '../src/commands/index.js';
import { buildPlan } from '../src/plan.js';
import { heartbeat, running, practicedMs } from '../src/practicetime.js';
import { freezeToday, tune, setState } from './helpers.js';

beforeEach(() => {
  freezeToday();
  setState([tune({ id: 'a', name: 'Solar', keys: [12], level: 1 }), tune({ id: 'b', name: 'Stella', keys: [10], level: 2 })], {
    settings: { instruments: ['bb', 'c'], view: 'bb', hone: 1, learn: 1, fresh: 0, exercises: 0 },
  });
  buildPlan();
  invalidateUndo();
});
afterEach(() => vi.useRealTimers());

describe('review', () => {
  it('an entry from before invalidateUndo (import / new day) comes back to life after a later undo', () => {
    const t1 = exec(updateItem, { item: 'a', level: 3 }); // e.g. the assistant's turn, Undo button kept in chat
    // import a backup: whole state replaced
    store.state = structuredClone(store.state);
    store.state.items[1].name = 'IMPORTED';
    invalidateUndo();
    expect(canUndo(t1.undo)).toBe(false);
    const e2 = exec(updateItem, { item: 'b', priority: 1 });
    expect(undo(e2.undo)).toBe(true);
    // BUG: t1 is undoable again, and restores pre-import data
    expect(canUndo(t1.undo)).toBe(true);
    expect(undo(t1.undo)).toBe(true);
    expect(store.state.items[1].name).toBe('Stella'); // import silently reverted
  });

  it('undo while an assistant group is open: later turn undo resurrects the undone turn', () => {
    beginGroup();
    exec(updateItem, { item: 'a', level: 3 });
    const t1 = endGroup();
    beginGroup(); // turn 2 starts, streaming
    expect(canUndo(t1.undo)).toBe(true); // Undo button still shown on turn 1
    expect(undo(t1.undo)).toBe(true); // user taps it mid-turn
    expect(store.state.items[0].level).toBe(1);
    exec(updateItem, { item: 'b', priority: 1 }); // turn 2's tool
    const t2 = endGroup();
    expect(undo(t2.undo)).toBe(true);
    // BUG: undoing turn 2 brings turn 1's change back
    expect(store.state.items[0].level).toBe(3);
  });

  it('a UI command during an open group gets no undo of its own and is folded into the turn', () => {
    beginGroup();
    const d = exec(deleteItem, { item: 'b' }); // e.g. confirm "Yes" on an older turn, mid-turn
    expect(d.undo).toBe(null);
    const t = endGroup();
    expect(t.notes.join()).toMatch(/Deleted Stella/);
  });

  it('a group with no changes still makes an undo entry if an undo happened mid-turn', () => {
    const e0 = exec(updateItem, { item: 'a', level: 2 });
    const e1 = exec(updateItem, { item: 'b', level: 3 });
    beginGroup();
    undo(e1.undo);
    const g = endGroup();
    expect(g.undo).not.toBe(null); // phantom entry with label ''
    expect(canUndo(e0.undo)).toBe(false);
  });

  it('undo rolls back the running practice timer; the next heartbeat then stops it as away', () => {
    const t0 = Date.now();
    exec(startPractice, {});
    vi.setSystemTime(t0 + 60_000);
    const t1 = exec(updateItem, { item: 'a', level: 3 });
    for (let m = 1; m <= 20; m++) { vi.setSystemTime(t0 + 60_000 + m * 60_000); heartbeat(); }
    expect(canUndo(t1.undo)).toBe(true);
    const before = practicedMs();
    undo(t1.undo);
    vi.setSystemTime(t0 + 22 * 60_000);
    expect(heartbeat()).toBe('stopped');
    expect(running()).toBe(null);
    console.log('practiced before undo', before / 60000, 'after', practicedMs() / 60000);
    expect(practicedMs()).toBeLessThan(before);
  });

  it('removing an album-less recording removes another one by the same artist', () => {
    exec(addRecording, { tune: 'a', artist: 'Miles Davis', album: 'Walkin' });
    exec(addRecording, { tune: 'a', artist: 'Miles Davis' });
    exec(removeRecording, { tune: 'a', artist: 'Miles Davis', album: undefined }); // UI: album: r.album ?? undefined
    expect(store.state.items[0].recordings).toEqual([{ artist: 'Miles Davis', album: 'Walkin' }]);
  });
});
