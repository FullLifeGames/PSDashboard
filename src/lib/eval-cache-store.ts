import type { EvalResult } from './eval/types';

/**
 * IndexedDB persistence for evaluation results, keyed by position + settings.
 * A completed sweep survives reloads, so re-analyzing a replay is instant.
 * Every failure path degrades to "no cache" — evaluation never depends on
 * storage working.
 */

export interface StoredEval {
  /** Full cache key (replay:turn:sets-fingerprint + settings suffix). */
  key: string;
  result: EvalResult;
  depth: number;
  samples: number;
  mode: string;
  tera: boolean;
  /** Engine expectation of the actually played pair (sweeps). */
  playedOutcome?: number | null;
  savedAt: number;
}

/**
 * Bump when the engine's numbers change meaning (eval weights, search
 * behavior) — persisted results from older engine versions must not
 * resurface as current.
 */
export const EVAL_ENGINE_CACHE_VERSION = 4;

export function evalStoreKey(
  cacheKey: string,
  depth: number,
  samples: number,
  mode: string,
  tera: boolean,
): string {
  return `v${EVAL_ENGINE_CACHE_VERSION}|${cacheKey}|d${depth}s${samples}m${mode}t${tera ? 1 : 0}`;
}

const DB_NAME = 'ps-replay-interceptor-eval';
const STORE = 'evals';
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

let dbPromise: Promise<IDBDatabase | null> | null = null;

/** Deletes entries older than MAX_AGE_MS — bounds growth, best-effort. */
function prune(db: IDBDatabase): void {
  try {
    const tx = db.transaction(STORE, 'readwrite');
    const index = tx.objectStore(STORE).index('savedAt');
    index.openCursor(IDBKeyRange.upperBound(Date.now() - MAX_AGE_MS)).onsuccess = event => {
      const cursor = (event.target as IDBRequest<IDBCursorWithValue | null>).result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      }
    };
  } catch {
    // Pruning is opportunistic.
  }
}

function openDb(): Promise<IDBDatabase | null> {
  dbPromise ??= new Promise(resolve => {
    try {
      if (typeof indexedDB === 'undefined') {
        resolve(null);
        return;
      }
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        const store = request.result.createObjectStore(STORE, { keyPath: 'key' });
        store.createIndex('savedAt', 'savedAt');
      };
      request.onsuccess = () => {
        prune(request.result);
        resolve(request.result);
      };
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

export async function loadStoredEval(key: string): Promise<StoredEval | null> {
  const db = await openDb();
  if (!db) return null;
  return new Promise(resolve => {
    try {
      const request = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
      request.onsuccess = () => {
        const value = request.result as StoredEval | undefined;
        resolve(value && value.key === key ? value : null);
      };
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function saveStoredEval(value: StoredEval): Promise<void> {
  const db = await openDb();
  if (!db) return;
  await new Promise<void>(resolve => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(value);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
}
