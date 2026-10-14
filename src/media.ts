import { holdAudio } from './audiosession.js';
import { store } from './store.js';
import { uid } from './util.js';
import { mediaPut, mediaGet, mediaDelete, mediaKeys, kvGet, kvSet } from './db.js';
import { dateStr, daysBetween } from './dates.js';
import type { Clip, DateStr, State } from './types.js';

// Recorded clips. The Blob lives in IndexedDB's media store; diary entries carry the metadata:
//   entry.media = [{ id, kind: 'audio' | 'video', mime, ms, size }]
// Clips aren't part of the JSON backup (too large); each can be saved or shared on its own.

// The first format this browser can record: Safari records MP4/AAC, Chrome and Firefox WebM/Opus.
const FORMATS = {
  audio: ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'],
  video: ['video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'],
};
export function pickMime(kind: Clip['kind'], isSupported: (type: string) => boolean | undefined = (t) => globalThis.MediaRecorder?.isTypeSupported?.(t)): string {
  return FORMATS[kind].find((t) => isSupported(t)) || '';
}

export function canRecord(): boolean {
  // (mediaDevices is missing outside a secure context, whatever the DOM types say)
  return !!((globalThis.navigator?.mediaDevices as Partial<MediaDevices> | undefined)?.getUserMedia && globalThis.MediaRecorder && globalThis.indexedDB);
}

// Instrument-friendly capture: the phone's voice processing (echo cancellation, noise
// suppression, automatic gain) smears sustained notes and pumps the volume, so turn it off.
// mic: a microphone's deviceId, or null for the phone's default.
export function constraints(kind: Clip['kind'], facingMode = 'user', mic: string | null = null): MediaStreamConstraints {
  // The channels as the mic gives them. (Asking for one, to keep an iPhone from giving two with the
  // sound only in the left, stopped a USB mic's own headphone monitoring — a Blue Yeti's; the
  // recorder makes takes mono itself, from the first channel: see recorder.ts.)
  const audio = { echoCancellation: false, noiseSuppression: false, autoGainControl: false, ...(mic ? { deviceId: { exact: mic } } : {}) };
  if (kind === 'audio') return { audio };
  return { audio, video: { facingMode, width: { ideal: 1280 }, height: { ideal: 720 } } };
}

// Recordings being saved (the file, then the note): an update mustn't reload the app meanwhile.
let saving = 0;
export const savingMedia = (): boolean => saving > 0;
export async function whileSaving<T>(fn: () => T | Promise<T>): Promise<T> {
  saving++;
  try { return await fn(); } finally { saving--; }
}

export async function saveClip(blob: Blob, kind: Clip['kind'], ms: number): Promise<Clip> {
  const clip: Clip = { id: uid(), kind, mime: blob.type, ms: Math.round(ms), size: blob.size };
  await mediaPut(clip.id, blob);
  return clip;
}

export async function clipUrl(clip: Clip): Promise<string | null> {
  const blob = await mediaGet(clip.id).catch(() => null);
  return blob ? URL.createObjectURL(blob) : null;
}

export async function clipFile(clip: Clip, name: string): Promise<File | null> {
  const blob = await mediaGet(clip.id);
  if (!blob) return null;
  const ext = (clip.mime || blob.type).includes('mp4') ? (clip.kind === 'audio' ? 'm4a' : 'mp4') : 'webm';
  return new File([blob], `${name}.${ext}`, { type: blob.type });
}

// Clip ids no diary entry refers to (e.g. after deleting a note). Deleting notes doesn't
// remove the clip right away, so Undo can bring it back; this clears them out later.
export function orphanIds(state: State, keys: string[]): string[] {
  const used = new Set(state.diary.flatMap((e) => (e.media || []).map((m) => m.id)));
  return keys.filter((k) => !used.has(k));
}

// Recordings no note refers to (a note deleted, or — rarely — a note that didn't get saved) are
// kept for a while before they're deleted, and can be restored from Settings until then.
const ORPHANS = 'orphans'; // { clip id: date first seen without a note }
const KEEP_DAYS = 30;
export async function cleanupMedia(): Promise<void> {
  try {
    const orphans = orphanIds(store.state, await mediaKeys());
    const seen: Record<string, DateStr> = (await kvGet(ORPHANS).catch(() => null)) || {};
    const today = dateStr();
    const next: Record<string, DateStr> = {};
    for (const id of orphans) {
      const first = seen[id] || today;
      if (daysBetween(first, today) >= KEEP_DAYS) await mediaDelete(id);
      else next[id] = first;
    }
    await kvSet(ORPHANS, next);
  } catch {
    // No media store (e.g. IndexedDB unavailable): nothing to clean up.
  }
}

// Recordings not in any note, still kept: ids.
export async function strayClips(): Promise<string[]> {
  try { return orphanIds(store.state, await mediaKeys()); } catch { return []; }
}

// Puts stray recordings back, each in a note of its own ("Recovered recording"). Returns how many.
export async function restoreStrayClips(addEntry: (entry: { text: string; media: Clip[]; take: boolean }) => unknown): Promise<number> {
  let n = 0;
  const seen: Record<string, DateStr> = (await kvGet(ORPHANS).catch(() => null)) || {};
  for (const id of await strayClips()) {
    if (!orphanIds(store.state, [id]).length) continue; // (in a note by now)
    const blob = await mediaGet(id).catch(() => null);
    if (!blob) continue;
    const kind = (blob.type || '').startsWith('video') ? 'video' : 'audio';
    const ms = await new Promise<number>((resolve) => {
      const el = document.createElement(kind);
      const url = URL.createObjectURL(blob);
      const done = (v: number) => { URL.revokeObjectURL(url); resolve(v); };
      el.onloadedmetadata = () => done(Number.isFinite(el.duration) ? el.duration * 1000 : 0);
      el.onerror = () => done(0);
      setTimeout(() => done(0), 3000);
      el.preload = 'metadata';
      el.src = url;
    });
    if (!orphanIds(store.state, [id]).length) continue;
    addEntry({ text: 'Recovered recording', media: [{ id, kind, mime: blob.type || '', ms: Math.round(ms), size: blob.size }], take: true });
    delete seen[id]; // in a note again: if it's ever let go, its 30 days start afresh
    n++;
  }
  await kvSet(ORPHANS, seen).catch(() => {});
  return n;
}

export function mediaStats(state: State): { count: number; bytes: number } {
  const clips = state.diary.flatMap((e) => e.media || []);
  return { count: clips.length, bytes: clips.reduce((n, c) => n + (c.size || 0), 0) };
}

export function fmtDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function fmtSize(bytes: number): string {
  if (bytes < 1e6) return `${Math.max(1, Math.round(bytes / 1e3))} KB`;
  return `${(bytes / 1e6).toFixed(bytes < 1e7 ? 1 : 0)} MB`;
}

// While a recording plays (an <audio> or <video> element), the audio session is for playback, so
// the iPhone uses the loudspeaker rather than the earpiece. (The mic in use — tuner or recorder —
// still wins.) Returns the element.
export function playOnSpeaker<T extends HTMLMediaElement>(el: T): T {
  let release: (() => void) | null = null;
  const done = () => { release?.(); release = null; };
  el.addEventListener('play', () => { if (!release) release = holdAudio('playback'); });
  el.addEventListener('pause', done);
  el.addEventListener('ended', done);
  el.addEventListener('emptied', done);
  return el;
}
