import type { EvalResult, TeraAllowance } from './eval/types';
import type { TurnSensitivity, TurnVerification } from './eval/analysis';
import { teraKey } from './eval/tera';

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
  tera: TeraAllowance;
  /** Engine expectation of the actually played pair (sweeps). */
  playedOutcome?: number | null;
  /** Depth+1 re-search of flagged misplays (null = checked, nothing flagged). */
  verified?: TurnVerification | null;
  /** Item-sensitivity probes for still-flagged sides (null = checked, none needed). */
  sensitivity?: TurnSensitivity | null;
  savedAt: number;
}

/**
 * Bump when the engine's numbers change meaning (eval weights, search
 * behavior) — persisted results from older engine versions must not
 * resurface as current.
 */
// v7: active-pair matchup emphasis + team-preview (turn 0) evaluation.
// v11: phase-aware winprob (K = k0 + k1·faintedFraction), sensitivity
//      probes cached per turn.
// v12: hazard-removal option value (net board state, move-aware).
// v13: entry-cost-weighted matchup/coverage (benched mons fight through
//      their hazard entry damage; Boots/Magic Guard exempt).
// v14: guaranteed-failing field moves dropped from candidate lists.
// v15: horizon-trend tiebreak — EV ties in the leading rows reorder by the
//      one-ply trend of their decisive cells (stall lines stop shading out
//      equivalent switches).
// v16: seeded reconstruction — evals cached from unseeded (run-varying)
//      reconstructions could disagree with the branch a click executes in.
// v17: Sleep Clause — branch formats carry the clause (declared |rule| lines
//      or the singles default), and redundant sleep moves leave the
//      candidate lists.
// v18: video-pipeline watermark |rule| lines no longer suppress the
//      singles Sleep Clause default (GPL evals cached without the clause).
// v19: corrected actives enter FRESH (no inherited choice locks from
//      diverged sim histories — GPL T38 hid Grass Knot).
// v20: post-correction request refresh, Imprison-concealed candidates
//      filtered, transform-shortened moveSlots round-trip (the Mew replay
//      crashed whole searches; corrected positions offered benched mons'
//      moves).
// v21: horizon-trend extrapolation (2b-lite) — tied leading rows carry
//      their one-ply trend in their VALUES (no re-solve; score untouched).
// v22: pivot pairs — the root matrix enumerates "U-turn → X" as first-class
//      choices instead of one greedy row.
export const EVAL_ENGINE_CACHE_VERSION = 22;

export function evalStoreKey(
  cacheKey: string,
  depth: number,
  samples: number,
  mode: string,
  tera: TeraAllowance,
): string {
  return `v${EVAL_ENGINE_CACHE_VERSION}|${cacheKey}|d${depth}s${samples}m${mode}t${teraKey(tera)}`;
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
