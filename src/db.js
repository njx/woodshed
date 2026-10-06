// Minimal key-value persistence on IndexedDB, with localStorage as a fallback for browsers
// (or private modes) where IndexedDB isn't available.

const DB_NAME = 'woodshed';
const STORE = 'kv';
let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('no IndexedDB'));
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(mode, fn) {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const req = fn(t.objectStore(STORE));
        t.oncomplete = () => resolve(req?.result);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      }),
  );
}

export async function kvGet(key) {
  try {
    return await tx('readonly', (s) => s.get(key));
  } catch {
    const raw = globalThis.localStorage?.getItem(`woodshed.kv.${key}`);
    return raw ? JSON.parse(raw) : undefined;
  }
}

export async function kvSet(key, value) {
  try {
    await tx('readwrite', (s) => s.put(value, key));
  } catch {
    globalThis.localStorage?.setItem(`woodshed.kv.${key}`, JSON.stringify(value));
  }
}

// For tests: close the connection so the database can be deleted.
export async function _resetDb() {
  if (dbPromise) (await dbPromise.catch(() => null))?.close();
  dbPromise = null;
}
