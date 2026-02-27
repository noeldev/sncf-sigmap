/**
 * storage.js
 * Persistent cache for large GeoJSON datasets using IndexedDB.
 * Falls back to in-memory only if IndexedDB is unavailable.
 * localStorage is not used: its 5 MB limit is too small for these datasets.
 */

const DB_NAME    = 'sncf-sigmap';
const DB_VERSION = 1;
const STORE      = 'datasets';

let _db = null;

function openDB() {
  return new Promise((resolve, reject) => {
    if (_db) { resolve(_db); return; }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'key' });
      }
    };
    req.onsuccess  = e => { _db = e.target.result; resolve(_db); };
    req.onerror    = e => reject(e.target.error);
  });
}

export async function saveDataset(key, data) {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put({ key, data, savedAt: Date.now() });
      tx.oncomplete = () => resolve(true);
      tx.onerror    = e => reject(e.target.error);
    });
  } catch (err) {
    console.warn('[Storage] IndexedDB write failed:', err);
    return false;
  }
}

export async function loadDataset(key) {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx  = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = e => resolve(e.target.result ? e.target.result.data : null);
      req.onerror   = e => reject(e.target.error);
    });
  } catch (err) {
    console.warn('[Storage] IndexedDB read failed:', err);
    return null;
  }
}

export async function deleteDataset(key) {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(key);
      tx.oncomplete = () => resolve(true);
      tx.onerror    = e => reject(e.target.error);
    });
  } catch (err) { return false; }
}
