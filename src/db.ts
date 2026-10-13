// Persistence on IndexedDB. Two object stores:
//   kv:    small key-value records (the app state), with localStorage as a fallback for
//          browsers (or private modes) where IndexedDB isn't available
//   media: recorded clips (Blobs), keyed by clip id. No fallback: recording needs IndexedDB.

const DB_NAME = 'woodshed';
const KV = 'kv';
const MEDIA = 'media';
let dbPromise: Promise<IDBDatabase> | null = null;

// A value read back from storage: whatever was saved (store.ts and validate.ts check the state).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Raw = any;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  const mine: Promise<IDBDatabase> = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('no IndexedDB'));
    const req = indexedDB.open(DB_NAME, 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(KV)) db.createObjectStore(KV);
      if (!db.objectStoreNames.contains(MEDIA)) db.createObjectStore(MEDIA);
    };
    req.onsuccess = () => {
      const db = req.result;
      // iOS can drop the connection (e.g. in the background), and another copy of the app opening
      // a newer version asks for it: open again next time rather than failing from then on.
      db.onclose = () => { if (dbPromise === mine) dbPromise = null; };
      db.onversionchange = () => { db.close(); if (dbPromise === mine) dbPromise = null; };
      resolve(db);
    };
    req.onerror = () => { if (dbPromise === mine) dbPromise = null; reject(req.error); };
  });
  return (dbPromise = mine);
}

// T: what the request's result holds (IndexedDB doesn't check what was stored).
function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest, retry = true): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        let t: IDBTransaction;
        try {
          t = db.transaction(store, mode);
        } catch (err) {
          // The connection was closed under us: open it again, once.
          if (retry && (err as DOMException)?.name === 'InvalidStateError') {
            if (dbPromise) dbPromise = null;
            return resolve(tx<T>(store, mode, fn, false));
          }
          return reject(err);
        }
        const req = fn(t.objectStore(store));
        t.oncomplete = () => resolve(req?.result);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      }),
  );
}

const hasIdb = () => typeof indexedDB !== 'undefined';
const lsKey = (key: string) => `woodshed.kv.${key}`;

// The localStorage copy of a value: the main store where IndexedDB doesn't exist, and otherwise a
// spill-over written when an IndexedDB write fails (e.g. storage full). loadState reconciles it.
export function kvFallback(key: string): Raw {
  try {
    const raw = globalThis.localStorage?.getItem(lsKey(key));
    return raw ? JSON.parse(raw) : undefined;
  } catch {
    return undefined;
  }
}

// Throws if IndexedDB exists but can't be read, so a failure isn't mistaken for "no data yet".
export async function kvGet(key: string): Promise<Raw> {
  if (!hasIdb()) return kvFallback(key);
  return tx<Raw>(KV, 'readonly', (s) => s.get(key));
}

// Throws if the IndexedDB write fails (after keeping a localStorage copy, where it fits).
export async function kvSet(key: string, value: unknown): Promise<void> {
  if (!hasIdb()) return globalThis.localStorage?.setItem(lsKey(key), JSON.stringify(value));
  try {
    await tx<IDBValidKey>(KV, 'readwrite', (s) => s.put(value, key));
  } catch (err) {
    try { globalThis.localStorage?.setItem(lsKey(key), JSON.stringify(value)); } catch { /* full too */ }
    throw err;
  }
  try { globalThis.localStorage?.removeItem(lsKey(key)); } catch { /* ignore */ }
}

// (Clips are stored under their ids, so the keys are strings.)
export const mediaPut = (id: string, blob: Blob) => tx<IDBValidKey>(MEDIA, 'readwrite', (s) => s.put(blob, id));
export const mediaGet = (id: string) => tx<Blob | undefined>(MEDIA, 'readonly', (s) => s.get(id));
export const mediaDelete = (id: string) => tx<undefined>(MEDIA, 'readwrite', (s) => s.delete(id));
export const mediaKeys = () => tx<string[]>(MEDIA, 'readonly', (s) => s.getAllKeys());

// For tests: close the connection so the database can be deleted.
export async function _resetDb(): Promise<void> {
  if (dbPromise) (await dbPromise.catch(() => null))?.close();
  dbPromise = null;
}
