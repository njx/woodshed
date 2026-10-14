// Persistence on IndexedDB. Three object stores:
//   kv:    small key-value records (the app state), with localStorage as a fallback for
//          browsers (or private modes) where IndexedDB isn't available
//   media: recorded clips (Blobs), keyed by clip id. No fallback: recording needs IndexedDB.
//   parts: a take's pieces as it's recorded ({ type, blob }), keyed "take id:piece number", until
//          it's stored as a clip.

const DB_NAME = 'woodshed';
const KV = 'kv';
const MEDIA = 'media';
const PARTS = 'parts';
let dbPromise: Promise<IDBDatabase> | null = null;

// A value read back from storage: whatever was saved (store.ts and validate.ts check the state).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Raw = any;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  const mine: Promise<IDBDatabase> = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('no IndexedDB'));
    const req = indexedDB.open(DB_NAME, 3);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(KV)) db.createObjectStore(KV);
      if (!db.objectStoreNames.contains(MEDIA)) db.createObjectStore(MEDIA);
      if (!db.objectStoreNames.contains(PARTS)) db.createObjectStore(PARTS);
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
// spill: false for what mustn't take the room the state's own copy needs there (the earlier copies).
export async function kvSet(key: string, value: unknown, { spill = true }: { spill?: boolean } = {}): Promise<void> {
  if (!hasIdb()) {
    if (!spill) throw new Error('no IndexedDB');
    return globalThis.localStorage?.setItem(lsKey(key), JSON.stringify(value));
  }
  try {
    await tx<IDBValidKey>(KV, 'readwrite', (s) => s.put(value, key));
  } catch (err) {
    if (spill) try { globalThis.localStorage?.setItem(lsKey(key), JSON.stringify(value)); } catch { /* full too */ }
    throw err;
  }
  try { globalThis.localStorage?.removeItem(lsKey(key)); } catch { /* ignore */ }
}

// (Clips are stored under their ids, so the keys are strings.)
export const mediaPut = (id: string, blob: Blob) => tx<IDBValidKey>(MEDIA, 'readwrite', (s) => s.put(blob, id));
export const mediaGet = (id: string) => tx<Blob | undefined>(MEDIA, 'readonly', (s) => s.get(id));
export const mediaDelete = (id: string) => tx<undefined>(MEDIA, 'readwrite', (s) => s.delete(id));
export const mediaKeys = () => tx<string[]>(MEDIA, 'readonly', (s) => s.getAllKeys());

// A take's pieces. (Numbered with leading zeros, so they sort in order.)
const partKey = (take: string, i: number) => `${take}:${String(i).padStart(6, '0')}`;
const partsOf = (take: string) => IDBKeyRange.bound(`${take}:`, `${take}:\uffff`);
export interface Part { type: string; blob: Blob }
export const partPut = (take: string, i: number, part: Part) => tx<IDBValidKey>(PARTS, 'readwrite', (s) => s.put(part, partKey(take, i)));
/** A take's pieces, by number. */
export const takeParts = (take: string) => tx<Map<number, Part>>(PARTS, 'readonly', (s) => {
  const keys = s.getAllKeys(partsOf(take));
  const values = s.getAll(partsOf(take)); // (in the same order)
  return { get result() { return new Map((keys.result as string[]).map((k, i) => [Number(k.slice(k.lastIndexOf(':') + 1)), values.result[i] as Part])); } } as IDBRequest;
});
export const partsDelete = (take: string) => tx<undefined>(PARTS, 'readwrite', (s) => s.delete(partsOf(take)));
/** Takes with pieces stored. */
export const partTakes = () => tx<string[]>(PARTS, 'readonly', (s) => s.getAllKeys()).then((keys) => [...new Set(keys.map((k) => k.slice(0, k.lastIndexOf(':'))))]);

// For tests: close the connection so the database can be deleted.
export async function _resetDb(): Promise<void> {
  if (dbPromise) (await dbPromise.catch(() => null))?.close();
  dbPromise = null;
}
