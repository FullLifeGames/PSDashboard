import {
  type EvalResult, type TeraAllowance, type TurnSensitivity, type TurnVerification, searchBudgetTag, teraKey,
} from '@fulllifegames/eval-engine';

/** IndexedDB persistence for evaluation results, keyed by position and settings; every failure degrades to "no cache". */

export interface StoredEval {
  /** Full cache key (replay:turn:sets-fingerprint + settings suffix). */
  key: string;
  result: EvalResult;
  /** false marks a sketch result (no forced-win prover); a full pass never reuses it. */
  prove?: boolean;
  depth: number;
  samples: number;
  mode: string;
  tera: TeraAllowance;
  playedOutcome?: number | null;
  /** Depth+1 re-search of flagged misplays (null = checked, nothing flagged). */
  verified?: TurnVerification | null;
  /** Item-sensitivity probes for still-flagged sides (null = checked, none needed). */
  sensitivity?: TurnSensitivity | null;
  savedAt: number;
}

/** Persisted results of another engine version never resurface as current: bump it when the engine's numbers change meaning. */
const EVAL_ENGINE_CACHE_VERSION = 80;

/** A search-budget form stores under its own tag; the default keeps the plain keys. */
const versionTag = (): string => {
  const tag = searchBudgetTag();
  return tag ? `v${EVAL_ENGINE_CACHE_VERSION}~${tag}` : `v${EVAL_ENGINE_CACHE_VERSION}`;
};

export function evalStoreKey(
  cacheKey: string,
  depth: number,
  samples: number,
  mode: string,
  tera: TeraAllowance,
): string {
  return `${versionTag()}|${cacheKey}|d${depth}s${samples}m${mode}t${teraKey(tera)}`;
}

/** The key prefix shared by every turn, engine, and set fingerprint of one replay. */
export function evalStorePrefix(replayId: string): string {
  return `${versionTag()}|${replayId}:`;
}

const DB_NAME = 'ps-replay-interceptor-eval';
const STORE = 'evals';
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

let dbPromise: Promise<IDBDatabase | null> | null = null;

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

/**
 * One transaction for every stored eval of a replay, so the graph sweep reads the store once, not once per turn. null: the store is
 * unavailable or the read failed (the caller falls back to single reads).
 */
export async function loadStoredEvalsByPrefix(prefix: string): Promise<Map<string, StoredEval> | null> {
  const db = await openDb();
  if (!db) return null;
  return new Promise(resolve => {
    try {
      const range = IDBKeyRange.bound(prefix, `${prefix}\uffff`);
      const request = db.transaction(STORE, 'readonly').objectStore(STORE).getAll(range);
      request.onsuccess = () => {
        const map = new Map<string, StoredEval>();
        for (const value of request.result as StoredEval[]) map.set(value.key, value);
        resolve(map);
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
