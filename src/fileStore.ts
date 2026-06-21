import type { ExportSource } from "./types";

const DB_NAME = "cursor-events-analyzer";
const STORE_NAME = "files";
const DB_VERSION = 1;

export type StoredFile = {
  id: string;
  name: string;
  source: ExportSource;
  importedAt: number;
  text: string;
  rowCount: number;
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error ?? new Error("Failed to open IndexedDB"));
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
  });
}

function runTransaction<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T> | void
): Promise<T | void> {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, mode);
        const store = tx.objectStore(STORE_NAME);
        const request = fn(store);

        tx.oncomplete = () => {
          db.close();
          resolve(request ? request.result : undefined);
        };
        tx.onerror = () => {
          db.close();
          reject(tx.error ?? new Error("IndexedDB transaction failed"));
        };
      })
  );
}

export async function listStoredFiles(): Promise<StoredFile[]> {
  const rows = (await runTransaction("readonly", (store) => store.getAll())) as StoredFile[] | void;
  const files = rows ?? [];
  return files.sort((a, b) => b.importedAt - a.importedAt);
}

export async function saveStoredFile(file: StoredFile): Promise<void> {
  await runTransaction("readwrite", (store) => store.put(file));
}

export async function deleteStoredFile(id: string): Promise<void> {
  await runTransaction("readwrite", (store) => store.delete(id));
}

export async function clearStoredFiles(): Promise<void> {
  await runTransaction("readwrite", (store) => store.clear());
}
