/**
 * IndexedDB checkpoint store.
 *
 * Large documents do not fit in localStorage (5-10MB) so page texts and chunk
 * results live in IndexedDB. Everything degrades to a no-op when IndexedDB is
 * unavailable (private windows, hardened builds) — the pipeline still works,
 * it just cannot resume after a reload.
 */
import type { IngestPage } from "./types";

const DB_NAME = "qexam-ingest";
const DB_VERSION = 2;
const FILE_STORE = "files";
const AI_STORE = "ai";
const PAGE_STORE = "pages";

export interface FileCheckpoint {
  signature: string;
  name: string;
  size: number;
  kind: string;
  pageCount: number | null;
  needsOcr: boolean | null;
  plan: string;
  pages: IngestPage[];
  text: string;
  notes: string[];
  selectedPages: number[] | null;
  updatedAt: string;
}

export interface AiCheckpoint {
  key: string;
  value: unknown;
  updatedAt: string;
}

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    if (typeof indexedDB === "undefined") {
      resolve(null);
      return;
    }
    try {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(FILE_STORE)) db.createObjectStore(FILE_STORE, { keyPath: "signature" });
        if (!db.objectStoreNames.contains(AI_STORE)) db.createObjectStore(AI_STORE, { keyPath: "key" });
        if (!db.objectStoreNames.contains(PAGE_STORE)) db.createObjectStore(PAGE_STORE, { keyPath: "key" });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T | null> {
  return new Promise((resolve) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
}

async function withStore<T>(
  store: string,
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => Promise<T>,
): Promise<T | null> {
  const db = await openDb();
  if (!db) return null;
  try {
    const transaction = db.transaction(store, mode);
    return await action(transaction.objectStore(store));
  } catch {
    return null;
  }
}

export async function saveFileCheckpoint(record: FileCheckpoint): Promise<void> {
  await withStore(FILE_STORE, "readwrite", async (store) => {
    await requestToPromise(store.put(record));
    return true;
  });
}

export async function loadFileCheckpoint(signature: string): Promise<FileCheckpoint | null> {
  return withStore(FILE_STORE, "readonly", (store) =>
    requestToPromise<FileCheckpoint>(store.get(signature)),
  );
}

export async function listFileCheckpoints(): Promise<FileCheckpoint[]> {
  const result = await withStore(FILE_STORE, "readonly", (store) =>
    requestToPromise<FileCheckpoint[]>(store.getAll()),
  );
  return result ?? [];
}

export async function deleteFileCheckpoint(signature: string): Promise<void> {
  await withStore(FILE_STORE, "readwrite", async (store) => {
    await requestToPromise(store.delete(signature));
    return true;
  });
  await deletePageCheckpoints(signature);
}

/* ------------------------------------------------------------------ */
/* Per-page checkpoints                                                */
/* ------------------------------------------------------------------ */

function pageKey(signature: string, index: number): string {
  return `${signature}#${index.toString().padStart(5, "0")}`;
}

/** One record per page keeps checkpoint writes O(1) for 500+ page documents. */
export async function savePageCheckpoint(signature: string, page: IngestPage): Promise<void> {
  await withStore(PAGE_STORE, "readwrite", async (store) => {
    await requestToPromise(store.put({ ...page, key: pageKey(signature, page.index) }));
    return true;
  });
}

export async function loadPageCheckpoints(signature: string): Promise<IngestPage[]> {
  const records = await withStore(PAGE_STORE, "readonly", (store) =>
    requestToPromise<Array<IngestPage & { key: string }>>(
      store.getAll(IDBKeyRange.bound(`${signature}#`, `${signature}#\uffff`)),
    ),
  );
  return (records ?? []).map((record) => {
    const page: IngestPage = {
      index: record.index,
      kind: record.kind,
      status: record.status,
      chars: record.chars,
      needsOcr: record.needsOcr,
      text: record.text,
    };
    if (record.confidence !== undefined) page.confidence = record.confidence;
    if (record.error) page.error = record.error;
    return page;
  });
}

export async function deletePageCheckpoints(signature: string): Promise<void> {
  await withStore(PAGE_STORE, "readwrite", async (store) => {
    await requestToPromise(store.delete(IDBKeyRange.bound(`${signature}#`, `${signature}#\uffff`)));
    return true;
  });
}

export async function clearFileCheckpoints(): Promise<void> {
  await withStore(FILE_STORE, "readwrite", async (store) => {
    await requestToPromise(store.clear());
    return true;
  });
}

export async function saveAiCheckpoint(key: string, value: unknown): Promise<void> {
  await withStore(AI_STORE, "readwrite", async (store) => {
    await requestToPromise(store.put({ key, value, updatedAt: new Date().toISOString() }));
    return true;
  });
}

export async function loadAiCheckpoint<T>(key: string): Promise<T | null> {
  const record = await withStore(AI_STORE, "readonly", (store) =>
    requestToPromise<AiCheckpoint>(store.get(key)),
  );
  return record ? (record.value as T) : null;
}

export async function deleteAiCheckpoint(key: string): Promise<void> {
  await withStore(AI_STORE, "readwrite", async (store) => {
    await requestToPromise(store.delete(key));
    return true;
  });
}

/** Keep the chunk cache from growing forever. */
export async function pruneAiCheckpoints(keep = 240): Promise<void> {
  const records = await withStore(AI_STORE, "readonly", (store) =>
    requestToPromise<AiCheckpoint[]>(store.getAll()),
  );
  if (!records || records.length <= keep) return;
  const sorted = [...records].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  const stale = sorted.slice(keep);
  await withStore(AI_STORE, "readwrite", async (store) => {
    for (const record of stale) {
      await requestToPromise(store.delete(record.key));
    }
    return true;
  });
}
