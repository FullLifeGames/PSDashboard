import {
  type EvalResult, type StaticRuleset, type TeraAllowance, type TurnSensitivity, type TurnVerification, type WinPaths, type WinPathsRequest,
  searchBudgetTag, teraKey,
} from '@fulllifegames/eval-engine';

/** IndexedDB persistence of evaluation results, keyed by position and settings; a failure degrades to "no cache". */

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

export interface StoredWinPaths {
  key: string;
  kind: 'winPaths';
  paths: WinPaths;
  savedAt: number;
}

// Bump when the engine's numbers change meaning: persisted results of another version never resurface.
const EVAL_ENGINE_CACHE_VERSION = 80;

const WIN_PATHS_STORE_VERSION = 1;

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

function digest(text: string): string {
  let low = 0x811c9dc5;
  let high = 0x01000193;
  for (let index = 0; index < text.length; index++) {
    low = Math.imul(low ^ text.charCodeAt(index), 0x01000193) >>> 0;
    high = Math.imul(high ^ text.charCodeAt(index), 0x811c9dc5) >>> 0;
  }
  return `${low.toString(16).padStart(8, '0')}${high.toString(16).padStart(8, '0')}`;
}

export function winPathsStoreKey(cacheKey: string, ruleset: StaticRuleset, request: WinPathsRequest): string {
  return `${versionTag()}|${cacheKey}|winpaths${WIN_PATHS_STORE_VERSION}:${digest(JSON.stringify([ruleset, request]))}`;
}

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

export async function loadStoredWinPaths(key: string): Promise<StoredWinPaths | null> {
  const db = await openDb();
  if (!db) return null;
  return new Promise(resolve => {
    try {
      const request = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
      request.onsuccess = () => {
        const value = request.result as StoredWinPaths | undefined;
        resolve(value && value.key === key && value.kind === 'winPaths' ? value : null);
      };
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

/** One transaction for every stored eval of a replay; null when the store is unavailable (callers read singly). */
export async function loadStoredEvalsByPrefix(prefix: string): Promise<Map<string, StoredEval> | null> {
  const db = await openDb();
  if (!db) return null;
  return new Promise(resolve => {
    try {
      const range = IDBKeyRange.bound(prefix, `${prefix}\uffff`);
      const request = db.transaction(STORE, 'readonly').objectStore(STORE).getAll(range);
      request.onsuccess = () => {
        const map = new Map<string, StoredEval>();
        for (const value of request.result as (StoredEval | StoredWinPaths)[]) if (!('kind' in value)) map.set(value.key, value);
        resolve(map);
      };
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function put(value: StoredEval | StoredWinPaths): Promise<void> {
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

export const saveStoredEval = (value: StoredEval): Promise<void> => put(value);

export const saveStoredWinPaths = (value: StoredWinPaths): Promise<void> => put(value);
