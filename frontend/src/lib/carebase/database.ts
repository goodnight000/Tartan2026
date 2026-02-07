import type { CareBaseRecord } from './types';

const DB_NAME = 'carebase';
const DB_VERSION = 1;
const STORE_NAME = 'records';

function ensureIndexedDb(): IDBFactory {
  if (typeof indexedDB === 'undefined') {
    throw new Error('IndexedDB is not available in this environment.');
  }
  return indexedDB;
}

function wrapRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed.'));
  });
}

function openDatabase(): Promise<IDBDatabase> {
  const idb = ensureIndexedDb();
  return new Promise((resolve, reject) => {
    const request = idb.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'key' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Failed to open IndexedDB.'));
  });
}

async function withStore<T>(mode: IDBTransactionMode, handler: (store: IDBObjectStore) => Promise<T>): Promise<T> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, mode);
    const store = transaction.objectStore(STORE_NAME);

    handler(store)
      .then((result) => {
        transaction.oncomplete = () => {
          db.close();
          resolve(result);
        };
      })
      .catch((error) => {
        transaction.abort();
        db.close();
        reject(error);
      });

    transaction.onerror = () => {
      db.close();
      reject(transaction.error ?? new Error('IndexedDB transaction failed.'));
    };
  });
}

export async function getRecord(key: string): Promise<CareBaseRecord | undefined> {
  return withStore('readonly', async (store) => wrapRequest(store.get(key)));
}

export async function putRecord(record: CareBaseRecord): Promise<void> {
  await withStore('readwrite', async (store) => {
    await wrapRequest(store.put(record));
  });
}

export async function deleteRecord(key: string): Promise<void> {
  await withStore('readwrite', async (store) => {
    await wrapRequest(store.delete(key));
  });
}

export async function listRecords(): Promise<CareBaseRecord[]> {
  return withStore('readonly', async (store) => wrapRequest(store.getAll()));
}

export async function clearRecords(): Promise<void> {
  await withStore('readwrite', async (store) => {
    await wrapRequest(store.clear());
  });
}
