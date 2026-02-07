import type { ActionLog, MedicalProfile, SymptomLog } from "@/lib/types";

const DB_NAME = "carepilot";
const DB_VERSION = 1;
const PROFILE_STORE = "medical_profiles";
const SYMPTOM_STORE = "symptom_logs";
const ACTION_STORE = "action_logs";

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function openDb(): Promise<IDBDatabase> {
  if (typeof window === "undefined" || !("indexedDB" in window)) {
    return Promise.reject(new Error("IndexedDB is not available in this environment."));
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(PROFILE_STORE)) {
        db.createObjectStore(PROFILE_STORE, { keyPath: "user_id" });
      }
      if (!db.objectStoreNames.contains(SYMPTOM_STORE)) {
        const store = db.createObjectStore(SYMPTOM_STORE, {
          keyPath: "id",
          autoIncrement: true,
        });
        store.createIndex("user_id", "user_id", { unique: false });
      }
      if (!db.objectStoreNames.contains(ACTION_STORE)) {
        const store = db.createObjectStore(ACTION_STORE, {
          keyPath: "id",
          autoIncrement: true,
        });
        store.createIndex("user_id", "user_id", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
  });
}

async function withStore<T>(
  storeName: string,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  const db = await openDb();
  const tx = db.transaction(storeName, mode);
  const store = tx.objectStore(storeName);
  const request = fn(store);
  const result = await requestToPromise(request);
  return result;
}

async function withIndexAll<T>(
  storeName: string,
  indexName: string,
  key: IDBValidKey
): Promise<T[]> {
  const db = await openDb();
  const tx = db.transaction(storeName, "readonly");
  const store = tx.objectStore(storeName);
  const index = store.index(indexName);
  const request = index.getAll(key);
  const result = await requestToPromise(request);
  return result as T[];
}

export async function getProfile(userId: string): Promise<MedicalProfile | null> {
  const profile = await withStore<MedicalProfile | undefined>(
    PROFILE_STORE,
    "readonly",
    (store) => store.get(userId)
  );
  return profile ?? null;
}

export async function upsertProfile(
  userId: string,
  payload: Omit<MedicalProfile, "user_id" | "updated_at">
): Promise<void> {
  const record: MedicalProfile = {
    ...payload,
    user_id: userId,
    updated_at: new Date().toISOString(),
  };
  await withStore(PROFILE_STORE, "readwrite", (store) => store.put(record));
}

export async function addSymptomLog(
  userId: string,
  payload: Omit<SymptomLog, "created_at">
): Promise<void> {
  const record: SymptomLog & { user_id: string } = {
    ...payload,
    user_id: userId,
    created_at: new Date().toISOString(),
  };
  await withStore(SYMPTOM_STORE, "readwrite", (store) => store.add(record));
}

export async function getSymptomLogs(userId: string, max = 20): Promise<SymptomLog[]> {
  const items = await withIndexAll<SymptomLog & { user_id: string }>(
    SYMPTOM_STORE,
    "user_id",
    userId
  );
  return items
    .sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""))
    .slice(0, max)
    .map(({ user_id: _userId, ...rest }) => rest as SymptomLog);
}

export async function addActionLog(
  userId: string,
  payload: Omit<ActionLog, "created_at">
): Promise<void> {
  const record: ActionLog & { user_id: string } = {
    ...payload,
    user_id: userId,
    created_at: new Date().toISOString(),
  };
  await withStore(ACTION_STORE, "readwrite", (store) => store.add(record));
}

export async function getActionLogs(userId: string, max = 20): Promise<ActionLog[]> {
  const items = await withIndexAll<ActionLog & { user_id: string }>(
    ACTION_STORE,
    "user_id",
    userId
  );
  return items
    .sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""))
    .slice(0, max)
    .map(({ user_id: _userId, ...rest }) => rest as ActionLog);
}
