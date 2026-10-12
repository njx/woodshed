// Persistence on IndexedDB. Two object stores:
//   kv:    small key-value records (the app state), with localStorage as a fallback for
//          browsers (or private modes) where IndexedDB isn't available
//   media: recorded clips (Blobs), keyed by clip id. No fallback: recording needs IndexedDB.

const DB_NAME = 'woodshed';
const KV = 'kv';
const MEDIA = 'media';
let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('no IndexedDB'));
    const req = indexedDB.open(DB_NAME, 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(KV)) db.createObjectStore(KV);
      if (!db.objectStoreNames.contains(MEDIA)) db.createObjectStore(MEDIA);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(store, mode, fn) {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const t = db.transaction(store, mode);
        const req = fn(t.objectStore(store));
        t.oncomplete = () => resolve(req?.result);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      }),
  );
}

const hasIdb = () => typeof indexedDB !== 'undefined';
const lsKey = (key) => `woodshed.kv.${key}`;

// The localStorage copy of a value: the main store where IndexedDB doesn't exist, and otherwise a
// spill-over written when an IndexedDB write fails (e.g. storage full). loadState reconciles it.
export function kvFallback(key) {
  try {
    const raw = globalThis.localStorage?.getItem(lsKey(key));
    return raw ? JSON.parse(raw) : undefined;
  } catch {
    return undefined;
  }
}

// Throws if IndexedDB exists but can't be read, so a failure isn't mistaken for "no data yet".
export async function kvGet(key) {
  if (!hasIdb()) return kvFallback(key);
  return tx(KV, 'readonly', (s) => s.get(key));
}

// Throws if the IndexedDB write fails (after keeping a localStorage copy, where it fits).
export async function kvSet(key, value) {
  if (!hasIdb()) return globalThis.localStorage?.setItem(lsKey(key), JSON.stringify(value));
  try {
    await tx(KV, 'readwrite', (s) => s.put(value, key));
  } catch (err) {
    try { globalThis.localStorage?.setItem(lsKey(key), JSON.stringify(value)); } catch { /* full too */ }
    throw err;
  }
  try { globalThis.localStorage?.removeItem(lsKey(key)); } catch { /* ignore */ }
}

export const mediaPut = (id, blob) => tx(MEDIA, 'readwrite', (s) => s.put(blob, id));
export const mediaGet = (id) => tx(MEDIA, 'readonly', (s) => s.get(id));
export const mediaDelete = (id) => tx(MEDIA, 'readwrite', (s) => s.delete(id));
export const mediaKeys = () => tx(MEDIA, 'readonly', (s) => s.getAllKeys());

// For tests: close the connection so the database can be deleted.
export async function _resetDb() {
  if (dbPromise) (await dbPromise.catch(() => null))?.close();
  dbPromise = null;
}
