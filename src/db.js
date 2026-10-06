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

export async function kvGet(key) {
  try {
    return await tx(KV, 'readonly', (s) => s.get(key));
  } catch {
    const raw = globalThis.localStorage?.getItem(`woodshed.kv.${key}`);
    return raw ? JSON.parse(raw) : undefined;
  }
}

export async function kvSet(key, value) {
  try {
    await tx(KV, 'readwrite', (s) => s.put(value, key));
  } catch {
    globalThis.localStorage?.setItem(`woodshed.kv.${key}`, JSON.stringify(value));
  }
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
