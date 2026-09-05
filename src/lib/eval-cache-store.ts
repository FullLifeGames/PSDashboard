import {
  type EvalResult, type TeraAllowance, type TurnSensitivity, type TurnVerification, teraKey,
} from '@fulllifegames/eval-engine';

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
  /** Round 35: false marks a sketch result (no forced-win prover); a full pass never reuses it. */
  prove?: boolean;
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
// v23: pivot pairs reach the ORCHESTRATED path too (the app's worker-pool
//      results cached under v22 were built from unexpanded root options).
// v24: locked releases carry dex-derived targets (doubles mid-charge
//      Phantom Force/Meteor Beam candidates were guaranteed rejects on
//      round-tripped states — those cells never sampled).
// v25: KO'd-before-acting sides price their pair through the stay-in
//      phantom — playedOutcome values stored as null under v24 would
//      otherwise never heal (null means "tried, unmatched" and is final).
// v26: side invariants (pokemonLeft, isActive) restore on every
//      deserialize — corrupted-correction positions used to throw (GPL
//      T38/T39 gaps) or evaluate wiped sides as alive.
// v27: choice tokens come from the request's move id (display names carry
//      computed BP for happiness moves — "Return 102" built a token the
//      sim rejects, silently gapping every Return/Frustration turn) and
//      guessed Frustration sets assume 0 happiness (the sim default 255
//      priced them at BP 1).
// v28: hidden-trapped actives (unrevealed Magnet Pull — the request conceals
//      trapping the validation enforces) stop offering bench switches, the
//      guaranteed reject that killed whole turn evals (573756 t24/32/38-40).
// v29: corrected actives regain protocol-proven choice locks (one distinct
//      committed move since entry + choice item + undisturbed item), a
//      guessed Choice item additionally needing damage corroboration —
//      Keldeo @ Specs graded as a free 4-option side (649664 t23).
// v30: typeless Hidden Power resolves via effectiveness evidence + usage
//      instead of the IV-default type (648453 t13 ran HP Dark for a real
//      HP Ice).
// v31: stranded bench mons (hp ≤ own-side hazard entry fraction, no living
//      removal carrier) price at a damped alive share instead of a full
//      body, leaving the hazard victim term (653785 t19's switch banked a
//      Charizard that could never return; 655336 t23/t24 artifacts) — and
//      the sweep feature weight becomes adoptable (fit 2026-08-15).
// v32: hax-aligned reconstruction — every turn boundary reseeds the sim
//      with the pinned candidate whose rolls reproduce the protocol's
//      crits/misses/secondaries/faints (best of 16, deterministic), so
//      positions no longer carry phantom RNG the real game disproves
//      (653785's endgame died 2 turns early to a seeded crit).
// v33: analytic class-blend at root boundary cells + koOdds payloads
//      (expectation grounding round — a 43% kill roll can no longer
//      sample 5/5 and grade certain; 649664 t23's desired).
// v34: MCTS root odds grounding — koOdds payloads on MCTS rows, boundary-
//      suspect verify coverage (uniform-outcome kill ranges re-priced by
//      the blending sampler), mismatch diagnostics passthrough.
// v35: effective speed is the standard speed source — the matchup and
//      sweep tie-breaks and the Trick Room sign read stages, paralysis,
//      Tailwind, Choice Scarf, Iron Ball, Unburden, weather abilities,
//      and invert under Trick Room instead of comparing naked stats.
// v36: PP truth in the threat model — pair threats, heal status, and the
//      removal-option terms read live slot PP (a drained wall stops
//      walling, a Struggle-locked body stops threatening; 573756's
//      endgame). PP comes from the sim state only, never from dex pools.
// v37: pin-efficiency discount on held heal PP — past the heal rate a
//      race defender's healAbsorb realizes only at healRate/incoming
//      (a pinned healer heals at a net loss and dies with PP in the
//      tank), so healing now outprices holding (655336 t26: Slack Off
//      over a free-turn Protect).
// v38: bring-limited positions field only the brought species (A.3c) —
//      sweep and single-turn reconstructions of VGC/BSS replays trim to
//      the protocol-pinned bring per side (per-side fail-open), and the
//      turn-0 preview enumerates lead pairs over the real four. Singles
//      and bring-all formats are byte-identical to v37.
// v39: knock-out hits are lower bounds in the spread fit (a KO line only
//      says "at least the remainder"; read as a reading it pulled every
//      solve toward a bulkier defender and a weaker attacker: 573756's
//      p1 Toxapex fitted as Bold 252 Def, Melmetal at 0 Atk). Sets, and
//      with them positions, change wherever a knock-out was observed.
// v40: the last pair is priced by its race (a burned, healing-only Toxapex
//      no longer outscores a Choice Band Zapdos-Galar on HP alone), the
//      threat proxy sees fixed-damage moves, the verify step pools tree
//      depth per outcome class and prices verified cells one ply deeper
//      with their rows completed, tree disagreement is visit-weighted, and
//      knock-out hits corroborate Choice items as lower bounds. Teams also
//      moved in round 33 (published Smogon sets, the Ubers fallback, the
//      revealed-attack default, the keep-the-prior fit). Scores move in
//      every endgame and wherever an MCTS verdict leaned on a verified cell.
// v41: round 35, the forced-win bar on the score.
// v42: round 37, a Choice Scarf inferred or dropped from move orders no
//      plausible spread reproduces, and speed evidence in doubles. Sets
//      move wherever an order decided an item or a doubles turn proved one.
const EVAL_ENGINE_CACHE_VERSION = 42;

export function evalStoreKey(
  cacheKey: string,
  depth: number,
  samples: number,
  mode: string,
  tera: TeraAllowance,
): string {
  return `v${EVAL_ENGINE_CACHE_VERSION}|${cacheKey}|d${depth}s${samples}m${mode}t${teraKey(tera)}`;
}

/** The key prefix shared by every turn, engine, and set fingerprint of one replay. */
export function evalStorePrefix(replayId: string): string {
  return `v${EVAL_ENGINE_CACHE_VERSION}|${replayId}:`;
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

/**
 * One transaction for every stored eval of a replay (all turns, engines,
 * and set fingerprints): the graph sweep reads the store once instead of
 * once per turn (five seconds of serial reads on a 139-turn game). null
 * means the store is unavailable or the read failed; the caller then
 * falls back to single reads.
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
