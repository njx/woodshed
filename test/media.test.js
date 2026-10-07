import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { store } from '../src/store.js';
import { mediaPut, mediaKeys, _resetDb } from '../src/db.js';
import { pickMime, constraints, orphanIds, cleanupMedia, mediaStats, fmtDuration, fmtSize } from '../src/media.js';
import { addEntry, todoText } from '../src/diary.js';
import { tune, setState } from './helpers.js';

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

  it('cleans orphaned clips out of storage', async () => {
    addEntry({ text: 'take 1', media: [clip('keep')] });
    await mediaPut('keep', 'audio-bytes');
    await mediaPut('gone', 'audio-bytes');
    await cleanupMedia();
    expect(await mediaKeys()).toEqual(['keep']);
  });

  it('totals recordings for settings', () => {
    addEntry({ text: 'a', media: [clip('a', 'audio', 900_000), clip('b', 'video', 12_500_000)] });
    expect(mediaStats(store.state)).toEqual({ count: 2, bytes: 13_400_000 });
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
