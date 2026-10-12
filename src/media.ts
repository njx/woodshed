import { holdAudio } from './audiosession.js';
import { store } from './store.js';
import { uid } from './util.js';
import { mediaPut, mediaGet, mediaDelete, mediaKeys, kvGet, kvSet } from './db.js';
import { dateStr, daysBetween } from './dates.js';

// Recorded clips. The Blob lives in IndexedDB's media store; diary entries carry the metadata:
//   entry.media = [{ id, kind: 'audio' | 'video', mime, ms, size }]
// Clips aren't part of the JSON backup (too large); each can be saved or shared on its own.

// The first format this browser can record: Safari records MP4/AAC, Chrome and Firefox WebM/Opus.
const FORMATS = {
  audio: ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'],
  video: ['video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'],
};
export function pickMime(kind, isSupported = (t) => globalThis.MediaRecorder?.isTypeSupported?.(t)) {
  return FORMATS[kind].find((t) => isSupported(t)) || '';
}

export function canRecord() {
  return !!(globalThis.navigator?.mediaDevices?.getUserMedia && globalThis.MediaRecorder && globalThis.indexedDB);
}

// Instrument-friendly capture: the phone's voice processing (echo cancellation, noise
// suppression, automatic gain) smears sustained notes and pumps the volume, so turn it off.
// mic: a microphone's deviceId, or null for the phone's default.
export function constraints(kind, facingMode = 'user', mic = null) {
  // One channel: an iPhone with voice processing off can otherwise give two, with the sound only in
  // the left, so takes played back in one ear. (The recorder also makes them mono; see recorder.js.)
  const audio = { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: { ideal: 1 }, ...(mic ? { deviceId: { exact: mic } } : {}) };
  if (kind === 'audio') return { audio };
  return { audio, video: { facingMode, width: { ideal: 1280 }, height: { ideal: 720 } } };
}

// Recordings being saved (the file, then the note): an update mustn't reload the app meanwhile.
let saving = 0;
export const savingMedia = () => saving > 0;
export async function whileSaving(fn) {
  saving++;
  try { return await fn(); } finally { saving--; }
}

export async function saveClip(blob, kind, ms) {
  const clip = { id: uid(), kind, mime: blob.type, ms: Math.round(ms), size: blob.size };
  await mediaPut(clip.id, blob);
  return clip;
}

export async function clipUrl(clip) {
  const blob = await mediaGet(clip.id).catch(() => null);
  return blob ? URL.createObjectURL(blob) : null;
}

export async function clipFile(clip, name) {
  const blob = await mediaGet(clip.id);
  if (!blob) return null;
  const ext = (clip.mime || blob.type).includes('mp4') ? (clip.kind === 'audio' ? 'm4a' : 'mp4') : 'webm';
  return new File([blob], `${name}.${ext}`, { type: blob.type });
}

// Clip ids no diary entry refers to (e.g. after deleting a note). Deleting notes doesn't
// remove the clip right away, so Undo can bring it back; this clears them out later.
export function orphanIds(state, keys) {
  const used = new Set(state.diary.flatMap((e) => (e.media || []).map((m) => m.id)));
  return keys.filter((k) => !used.has(k));
}

// Recordings no note refers to (a note deleted, or — rarely — a note that didn't get saved) are
// kept for a while before they're deleted, and can be restored from Settings until then.
const ORPHANS = 'orphans'; // { clip id: date first seen without a note }
const KEEP_DAYS = 30;
export async function cleanupMedia() {
  try {
    const orphans = orphanIds(store.state, await mediaKeys());
    const seen = (await kvGet(ORPHANS).catch(() => null)) || {};
    const today = dateStr();
    const next = {};
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
export async function strayClips() {
  try { return orphanIds(store.state, await mediaKeys()); } catch { return []; }
}

// Puts stray recordings back, each in a note of its own ("Recovered recording"). Returns how many.
export async function restoreStrayClips(addEntry) {
  let n = 0;
  const seen = (await kvGet(ORPHANS).catch(() => null)) || {};
  for (const id of await strayClips()) {
    if (!orphanIds(store.state, [id]).length) continue; // (in a note by now)
    const blob = await mediaGet(id).catch(() => null);
    if (!blob) continue;
    const kind = (blob.type || '').startsWith('video') ? 'video' : 'audio';
    const ms = await new Promise((resolve) => {
      const el = document.createElement(kind);
      const url = URL.createObjectURL(blob);
      const done = (v) => { URL.revokeObjectURL(url); resolve(v); };
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

export function mediaStats(state) {
  const clips = state.diary.flatMap((e) => e.media || []);
  return { count: clips.length, bytes: clips.reduce((n, c) => n + (c.size || 0), 0) };
}

export function fmtDuration(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function fmtSize(bytes) {
  if (bytes < 1e6) return `${Math.max(1, Math.round(bytes / 1e3))} KB`;
  return `${(bytes / 1e6).toFixed(bytes < 1e7 ? 1 : 0)} MB`;
}

// While a recording plays (an <audio> or <video> element), the audio session is for playback, so
// the iPhone uses the loudspeaker rather than the earpiece. (The mic in use — tuner or recorder —
// still wins.) Returns the element.
export function playOnSpeaker(el) {
  let release = null;
  const done = () => { release?.(); release = null; };
  el.addEventListener('play', () => { if (!release) release = holdAudio('playback'); });
  el.addEventListener('pause', done);
  el.addEventListener('ended', done);
  el.addEventListener('emptied', done);
  return el;
}
