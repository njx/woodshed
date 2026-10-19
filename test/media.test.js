import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { store } from '../src/store.js';
import { mediaPut, mediaGet, mediaKeys, partPut, partTakes, _resetDb } from '../src/db.js';
import { pickMime, constraints, orphanIds, cleanupMedia, strayClips, mediaStats, fmtDuration, fmtSize, TakeWriter, recoverTakes, saveClip, openMic } from '../src/media.js';
import { addEntry, todoText } from '../src/diary.js';
import { tune, setState, freezeToday } from './helpers.js';

beforeEach(async () => {
  await _resetDb();
  await new Promise((resolve) => { indexedDB.deleteDatabase('woodshed').onsuccess = resolve; });
  setState([tune({ name: 'Solar' })]);
});

const clip = (id, kind = 'audio', size = 1000) => ({ id, kind, mime: `${kind}/mp4`, ms: 42000, size });

describe('recording formats', () => {
  it('prefers MP4 (Safari) and falls back to WebM', () => {
    expect(pickMime('audio', () => true)).toBe('audio/mp4');
    expect(pickMime('audio', (t) => t.startsWith('audio/webm'))).toBe('audio/webm;codecs=opus');
    expect(pickMime('video', (t) => t === 'video/webm')).toBe('video/webm');
    expect(pickMime('audio', () => false)).toBe('');
  });

  it('turns off voice processing so instruments sound natural', () => {
    expect(constraints('audio')).toEqual({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: { ideal: 1 } } });
    expect(constraints('video', 'environment').video).toMatchObject({ facingMode: 'environment' });
  });
});

describe('clips in the diary', () => {
  it('a note can be just a recording', () => {
    const e = addEntry({ media: [clip('c1')], flag: 'teacher' });
    expect(e).toMatchObject({ text: '', media: [{ id: 'c1' }] });
    expect(todoText('teacher')).toMatch(/• \(recording\)$/);
  });

  it('finds clips no note refers to any more', () => {
    addEntry({ text: 'take 1', media: [clip('keep')] });
    expect(orphanIds(store.state, ['keep', 'gone'])).toEqual(['gone']);
  });

  it('cleans clips no note refers to out of storage — 30 days after they were first seen so', async () => {
    addEntry({ text: 'take 1', media: [clip('keep')] });
    await mediaPut('keep', 'audio-bytes');
    await mediaPut('gone', 'audio-bytes');
    freezeToday('2026-10-06');
    await cleanupMedia();
    expect(await mediaKeys()).toEqual(['gone', 'keep']); // kept a while (it can be restored)
    expect(await strayClips()).toEqual(['gone']);
    freezeToday('2026-10-20');
    await cleanupMedia();
    expect(await mediaKeys()).toEqual(['gone', 'keep']);
    freezeToday('2026-11-06');
    await cleanupMedia();
    expect(await mediaKeys()).toEqual(['keep']);
    vi.useRealTimers();
  });

  it('keeps a clip an earlier copy of the data refers to (to put that copy back)', async () => {
    const { kvSet } = await import('../src/db.js');
    await kvSet('copies', [{ at: 1, reason: 'Before reset', state: { diary: [{ media: [clip('old')] }] } }]);
    await mediaPut('old', 'audio-bytes');
    freezeToday('2026-10-06');
    await cleanupMedia();
    freezeToday('2026-12-06');
    await cleanupMedia();
    expect(await mediaKeys()).toContain('old');
    vi.useRealTimers();
  });

  it('totals recordings for settings', () => {
    addEntry({ text: 'a', media: [clip('a', 'audio', 900_000), clip('b', 'video', 12_500_000)] });
    expect(mediaStats(store.state)).toEqual({ count: 2, bytes: 13_400_000 });
  });
});

describe('takes stored as they’re recorded', () => {
  const text = async (blob) => (blob ? new TextDecoder().decode(await blob.arrayBuffer()) : null);

  it('are put together from their pieces, in order', async () => {
    const w = new TakeWriter('audio/mp4');
    for (const p of ['one ', 'two ', 'three']) w.add(new Blob([p]));
    w.add(new Blob([])); // (an empty piece: none)
    const blob = await w.blob();
    expect(blob.type).toBe('audio/mp4');
    expect(await text(blob)).toBe('one two three');
    expect(await partTakes()).toEqual([w.id]);
    w.done();
    await new Promise((r) => setTimeout(r, 20));
    expect(await partTakes()).toEqual([]);
  });

  it('one cut off is stored and put in a note next time', async () => {
    await partPut('t1', 1, { type: 'video/mp4', blob: new Blob(['B']) });
    await partPut('t1', 0, { type: 'video/mp4', blob: new Blob(['A']) });
    const added = [];
    expect(await recoverTakes((e) => added.push(addEntry(e)))).toEqual(['t1']);
    expect(await text(await mediaGet('t1'))).toBe('AB');
    expect(added[0]).toMatchObject({ text: 'Recovered recording', take: true, media: [{ id: 't1', kind: 'video', mime: 'video/mp4', size: 2 }] });
    expect(await partTakes()).toEqual([]);
  });

  it('one stored as a clip and kept just has its pieces let go', async () => {
    const w = new TakeWriter('audio/mp4');
    w.add(new Blob(['x']));
    const clip = await saveClip(await w.blob(), 'audio', 1000, w.id);
    addEntry({ text: 'take', media: [clip] });
    expect(await recoverTakes(() => { throw new Error('not again'); })).toEqual([]);
    expect(await partTakes()).toEqual([]);
  });
});

describe('the mic for listening (the tuner)', () => {
  // A phone with earbuds in: before the mic's allowed, no names; the default is the earbuds'.
  function phone({ allowed = false } = {}) {
    const opened = [];
    const mic = (id) => ({ getTracks: () => [{ stop() {} }], getAudioTracks: () => [{ getSettings: () => ({ deviceId: id }) }] });
    vi.stubGlobal('navigator', { mediaDevices: {
      enumerateDevices: async () => [
        { kind: 'audioinput', deviceId: 'buds', label: allowed || opened.length ? 'AirPods Pro' : '' },
        { kind: 'audioinput', deviceId: 'phone', label: allowed || opened.length ? 'iPhone Microphone' : '' },
      ],
      getUserMedia: async (c) => { const id = c.audio.deviceId?.exact ?? null; opened.push(id); return mic(id ?? 'buds'); },
    } });
    return opened;
  }
  afterEach(() => vi.unstubAllGlobals());
  it('is the phone’s own, not the earbuds’ (which would take the metronome off them)', async () => {
    const opened = phone({ allowed: true });
    await openMic();
    expect(opened).toEqual(['phone']);
  });
  it('the first time (no names until it’s allowed): the default, then the phone’s own', async () => {
    const opened = phone();
    await openMic();
    expect(opened).toEqual([null, 'phone']);
  });
  it('or the one picked in the recorder', async () => {
    store.state.settings.recordMicLabel = 'AirPods Pro';
    const opened = phone({ allowed: true });
    await openMic();
    expect(opened).toEqual(['buds']);
  });
});

describe('formatting', () => {
  it('formats durations and sizes', () => {
    expect(fmtDuration(42000)).toBe('0:42');
    expect(fmtDuration(125400)).toBe('2:05');
    expect(fmtSize(900_000)).toBe('900 KB');
    expect(fmtSize(2_400_000)).toBe('2.4 MB');
    expect(fmtSize(34_000_000)).toBe('34 MB');
  });
});
