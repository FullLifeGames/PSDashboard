import { useCallback, useEffect, useRef, useState } from 'react';
import {
  matchPlayedSide, REGRET_THRESHOLD,
  type SensitivityProbe, type TurnSensitivity, type TurnVerification,
} from '../lib/eval/analysis';
import { patchSerializedItem, selectProbeCombos, type SensitivityTarget } from '../lib/eval/sensitivity';
import type { LeadEvalData } from '../lib/eval/leads';
import type { PlayedTurn } from '../lib/eval/played';
import { EvalWorkerClient } from '../lib/eval/worker-client';
import { evalStoreKey, loadStoredEval, saveStoredEval } from '../lib/eval-cache-store';
import { selectKeyTurns } from '../lib/eval/graph';
import type { EvalPreferences, EvalResult, EvalSettings, RankedChoice, SearchProgress, TeraAllowance } from '../lib/eval/types';
import { teraKey } from '../lib/eval/tera';

export type EvalStatus = 'idle' | 'reconstructing' | 'searching' | 'done' | 'stale' | 'error';

export interface EvaluateParams {
  /** Cache key for replay-view positions; null disables caching (branch mode). */
  cacheKey: string | null;
  /** Resolved Tera allowance (the panel pref resolved against the replay). */
  tera: TeraAllowance;
  /**
   * Produces the serialized position. A reconstruction-based acquire calls
   * reportReconstruct(turn, target) as it replays turns; the hook surfaces
   * that as reconstructProgress state.
   */
  acquire: (reportReconstruct: (turn: number, target: number) => void) => Promise<string>;
}

const PREFS_KEY = 'ps-replay-interceptor:eval-prefs';
const DEFAULT_PREFS: EvalPreferences = { depth: 2, samples: 3, mode: 'matrix', auto: false, tera: 'auto' };

function loadPrefs(): EvalPreferences {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return DEFAULT_PREFS;
    const parsed = JSON.parse(raw) as Partial<EvalPreferences>;
    return {
      depth: parsed.depth === 1 ? 1 : 2,
      samples: parsed.samples === 1 || parsed.samples === 5 ? parsed.samples : 3,
      mode: parsed.mode === 'mcts' ? 'mcts' : 'matrix',
      auto: !!parsed.auto,
      tera: parsed.tera === 'on' || parsed.tera === 'off' || parsed.tera === 'revealed' ? parsed.tera : 'auto',
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

interface CachedEval {
  result: EvalResult;
  // Engine-typed: the UI only offers depth 1/2, but sweeps cache whatever
  // EvalSettings the engine ran with.
  depth: EvalSettings['depth'];
  samples: EvalSettings['samples'];
  mode: EvalPreferences['mode'];
  tera: TeraAllowance;
  /** Engine expectation of the actually played pair (set by graph sweeps). */
  playedOutcome?: number | null;
  /** Depth+1 re-search of flagged misplays (null = checked, nothing flagged). */
  verified?: TurnVerification | null;
  /** Item-sensitivity probes for still-flagged sides (null = checked, none needed). */
  sensitivity?: TurnSensitivity | null;
}

export interface GraphSweepParams {
  /** Number of turns in the game (sizes the graph; sweep may cover less). */
  turns: number;
  /** Optional sub-range to sweep (on-demand analysis); defaults to 1..turns. */
  from?: number;
  to?: number;
  /** Resolved Tera allowance. */
  tera: TeraAllowance;
  cacheKeyFor(turn: number): string;
  acquireFor(turn: number): (report: (turn: number, target: number) => void) => Promise<string>;
  /**
   * Optional single-pass acquisition of ALL positions (index = turn − 1).
   * Preferred over acquireFor when present — one reconstruction instead of
   * one per turn. Only invoked once, on the first cache miss. `onPosition`
   * streams each position as it is captured so searches start immediately
   * instead of waiting for the full replay pass.
   */
  acquireAll?(
    report: (turn: number, target: number) => void,
    onPosition?: (turn: number, serialized: string) => void,
  ): Promise<(string | null)[]>;
  /** What was actually played on this turn (parsed from the replay log). */
  playedFor(turn: number): PlayedTurn | null;
  /**
   * Turn 0: the serialized team-preview position, or null for formats
   * without preview. Present only on full-game sweeps.
   */
  acquirePreview?(): Promise<string | null>;
  /** The leads each side actually sent (species, slot order). */
  playedLeads?: { p1: string[] | null; p2: string[] | null };
  /**
   * Guessed-item mons per side with their usage-plausible alternative items
   * (rule-outs applied) — the sensitivity probes' search space. Absent =
   * probing disabled.
   */
  sensitivityTargetsFor?(side: 'p1' | 'p2'): SensitivityTarget[];
}

export interface EvalGraphState {
  /** scores[t-1] = score at turn t; null = not evaluated (gap). */
  scores: (number | null)[];
  /** Full per-turn results for the analysis view. */
  results: (EvalResult | null)[];
  played: (PlayedTurn | null)[];
  playedOutcome: (number | null)[];
  /** Depth+1 verification of flagged misplays (null = nothing flagged / not run). */
  verified: (TurnVerification | null)[];
  /** Item-sensitivity probes per turn (null = nothing to probe / not run). */
  sensitivity: (TurnSensitivity | null)[];
  /** Turn 0 (team preview) evaluation — null when unavailable or not swept. */
  lead: LeadEvalData | null;
  running: boolean;
  progress: { done: number; total: number } | null;
}

export function useEvaluation() {
  const [prefs, setPrefsState] = useState<EvalPreferences>(loadPrefs);
  const [status, setStatus] = useState<EvalStatus>('idle');
  const [result, setResult] = useState<EvalResult | null>(null);
  const [progress, setProgress] = useState<SearchProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reconstructProgress, setReconstructProgress] = useState<{ turn: number; target: number } | null>(null);
  const [graph, setGraph] = useState<EvalGraphState>({
    scores: [], results: [], played: [], playedOutcome: [], verified: [], sensitivity: [], lead: null,
    running: false, progress: null,
  });

  const clientRef = useRef<EvalWorkerClient | null>(null);
  const cacheRef = useRef(new Map<string, CachedEval>());
  /** Latest graph arrays, so partial (range) sweeps merge instead of wiping. */
  const graphDataRef = useRef<Pick<EvalGraphState, 'scores' | 'results' | 'played' | 'playedOutcome' | 'verified' | 'sensitivity' | 'lead'> | null>(null);
  const runRef = useRef(0);
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  const resultRef = useRef(result);
  resultRef.current = result;

  useEffect(() => () => {
    runRef.current += 1;
    clientRef.current?.dispose();
    clientRef.current = null;
  }, []);

  const cancel = useCallback(() => {
    runRef.current += 1;
    clientRef.current?.cancel();
    setProgress(null);
    setReconstructProgress(null);
    setStatus(prev => {
      if (prev !== 'searching' && prev !== 'reconstructing') return prev;
      return resultRef.current ? 'stale' : 'idle';
    });
    setGraph(prev => (prev.running ? { ...prev, running: false, progress: null } : prev));
  }, []);

  const evaluate = useCallback((params: EvaluateParams) => {
    const { depth, samples, mode } = prefsRef.current;
    if (params.cacheKey) {
      const hit = cacheRef.current.get(params.cacheKey);
      if (hit && hit.depth === depth && hit.samples === samples && hit.mode === mode && teraKey(hit.tera) === teraKey(params.tera)) {
        runRef.current += 1;
        setResult(hit.result);
        setStatus('done');
        setError(null);
        setProgress(null);
        setReconstructProgress(null);
        return;
      }
    }

    const runId = ++runRef.current;
    setStatus('reconstructing');
    setError(null);
    setResult(null);
    setProgress(null);
    setReconstructProgress(null);

    void (async () => {
      try {
        // Persistent cache: a result from a previous session for the same
        // position + settings skips reconstruction and search entirely.
        if (params.cacheKey) {
          const stored = await loadStoredEval(evalStoreKey(params.cacheKey, depth, samples, mode, params.tera));
          if (runRef.current !== runId) return;
          if (stored) {
            cacheRef.current.set(params.cacheKey, {
              result: stored.result, depth, samples, mode, tera: params.tera,
              ...(stored.playedOutcome !== undefined ? { playedOutcome: stored.playedOutcome } : {}),
            });
            setResult(stored.result);
            setStatus('done');
            return;
          }
        }

        const serialized = await params.acquire((turn, target) => {
          if (runRef.current === runId) setReconstructProgress({ turn, target });
        });
        if (runRef.current !== runId) return;
        setStatus('searching');
        setReconstructProgress(null);

        clientRef.current ??= new EvalWorkerClient();
        const final = await clientRef.current.evaluate(serialized, { depth, samples, mode, tera: params.tera }, {
          onProgress: update => {
            if (runRef.current === runId) setProgress(update);
          },
          onPartial: partial => {
            if (runRef.current === runId) setResult(partial);
          },
        });
        if (runRef.current !== runId) return;
        setResult(final);
        setStatus('done');
        setProgress(null);
        if (params.cacheKey) {
          cacheRef.current.set(params.cacheKey, { result: final, depth, samples, mode, tera: params.tera });
          void saveStoredEval({
            key: evalStoreKey(params.cacheKey, depth, samples, mode, params.tera),
            result: final, depth, samples, mode, tera: params.tera, savedAt: Date.now(),
          });
        }
      } catch (err) {
        if (runRef.current !== runId) return;
        if (err instanceof Error && err.message === 'cancelled') return;
        setStatus('error');
        setError(err instanceof Error ? err.message : String(err));
        setProgress(null);
        setReconstructProgress(null);
      }
    })();
  }, []);

  const setPrefs = useCallback((next: EvalPreferences) => {
    const changed = next.depth !== prefsRef.current.depth ||
      next.samples !== prefsRef.current.samples ||
      next.mode !== prefsRef.current.mode ||
      next.tera !== prefsRef.current.tera;
    setPrefsState(next);
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(next));
    } catch {
      // Storage full/blocked — the prefs still apply for this session.
    }
    if (changed) setStatus(prev => (prev === 'done' ? 'stale' : prev));
  }, []);

  const markStale = useCallback(() => {
    setStatus(prev => (prev === 'done' ? 'stale' : prev));
  }, []);

  const reset = useCallback(() => {
    cancel();
    setStatus('idle');
    setResult(null);
    setError(null);
  }, [cancel]);

  /**
   * Sequential background sweep evaluating turns for the game graph — the
   * whole game by default, or a sub-range (on-demand turn analysis). Range
   * results merge into the existing graph state.
   */
  const runGraphSweep = useCallback((params: GraphSweepParams) => {
    cancel();
    const runId = ++runRef.current;
    const { depth, samples, mode } = prefsRef.current;
    const from = Math.max(1, params.from ?? 1);
    const to = Math.min(params.turns, params.to ?? params.turns);
    const previous = graphDataRef.current;
    const keepPrevious = previous !== null && previous.scores.length === params.turns;
    const scores: (number | null)[] = keepPrevious ? [...previous.scores] : new Array(params.turns).fill(null);
    const results: (EvalResult | null)[] = keepPrevious ? [...previous.results] : new Array(params.turns).fill(null);
    const played: (PlayedTurn | null)[] = keepPrevious ? [...previous.played] : new Array(params.turns).fill(null);
    const playedOutcome: (number | null)[] = keepPrevious ? [...previous.playedOutcome] : new Array(params.turns).fill(null);
    const verified: (TurnVerification | null)[] = keepPrevious && previous.verified.length === params.turns
      ? [...previous.verified]
      : new Array(params.turns).fill(null);
    const sensitivity: (TurnSensitivity | null)[] = keepPrevious && previous.sensitivity?.length === params.turns
      ? [...previous.sensitivity]
      : new Array(params.turns).fill(null);
    let lead: LeadEvalData | null = keepPrevious ? previous.lead : null;
    const snapshot = () => {
      const data = {
        scores: [...scores], results: [...results], played: [...played],
        playedOutcome: [...playedOutcome], verified: [...verified], sensitivity: [...sensitivity], lead,
      };
      graphDataRef.current = data;
      return data;
    };
    const total = Math.max(0, to - from + 1);
    setGraph({ ...snapshot(), running: true, progress: { done: 0, total } });

    // Lazily-run single-pass acquisition, pipelined: positions stream out of
    // the ongoing reconstruction, so the first search starts after the first
    // captured turn instead of after the whole replay pass. Started at most
    // once; a failure fails every waiting turn instead of retrying.
    const arrived = new Map<number, string>();
    const waiters = new Map<number, { resolve(serialized: string): void; reject(error: unknown): void }[]>();
    let acquireStarted = false;
    let acquireSettled = false;
    let acquireError: unknown = null;
    const settleWaiters = () => {
      for (const [turn, list] of waiters) {
        for (const waiter of list) {
          const found = arrived.get(turn);
          if (found) waiter.resolve(found);
          else waiter.reject(acquireError ?? new Error(`No position captured for turn ${turn}.`));
        }
      }
      waiters.clear();
    };
    const startAcquisition = () => {
      if (acquireStarted) return;
      acquireStarted = true;
      params.acquireAll!(() => {}, (turn, serialized) => {
        arrived.set(turn, serialized);
        for (const waiter of waiters.get(turn) ?? []) waiter.resolve(serialized);
        waiters.delete(turn);
      }).then(positions => {
        positions.forEach((serialized, index) => {
          if (serialized) arrived.set(index + 1, serialized);
        });
      }).catch(error => {
        acquireError = error;
      }).finally(() => {
        acquireSettled = true;
        settleWaiters();
      });
    };
    const positionFor = (turn: number): Promise<string> => {
      if (!params.acquireAll) return params.acquireFor(turn)(() => {});
      const found = arrived.get(turn);
      if (found) return Promise.resolve(found);
      if (acquireSettled) {
        return Promise.reject(acquireError ?? new Error(`No position captured for turn ${turn}.`));
      }
      startAcquisition();
      return new Promise((resolve, reject) => {
        const list = waiters.get(turn) ?? [];
        list.push({ resolve, reject });
        waiters.set(turn, list);
      });
    };

    /**
     * Deep re-search before a misplay verdict sticks (chess.com's sacrifice
     * verification): for each side whose played choice trails the best by the
     * regret threshold, value the played and best pairs one depth deeper.
     * Flag checks are pure — the position is only acquired when needed.
     */
    const verifyFlagged = async (
      getSerialized: () => Promise<string>,
      result: EvalResult,
      turnPlayed: PlayedTurn | null,
      settings: EvalSettings,
    ): Promise<TurnVerification | null> => {
      if ((settings.mode ?? 'matrix') !== 'matrix' || settings.depth > 2) return null;
      const p1Choice = matchPlayedSide(result, 'p1', turnPlayed);
      const p2Choice = matchPlayedSide(result, 'p2', turnPlayed);
      if (!p1Choice || !p2Choice) return null;
      const flaggedBest = (side: 'p1' | 'p2', chosen: RankedChoice): RankedChoice | null => {
        const best = result.perSide[side][0];
        return best && best.ev - chosen.ev >= REGRET_THRESHOLD ? best : null;
      };
      const p1Best = flaggedBest('p1', p1Choice);
      const p2Best = flaggedBest('p2', p2Choice);
      if (!p1Best && !p2Best) return null;
      const deep: EvalSettings = {
        ...settings, depth: (settings.depth + 1) as 2 | 3, mode: 'matrix', keepPlayed: undefined,
      };
      const serialized = await getSerialized();
      clientRef.current ??= new EvalWorkerClient();
      const playedDeep = await clientRef.current.evalPair(serialized, p1Choice.choice, p2Choice.choice, deep);
      const verification: TurnVerification = {};
      if (p1Best) {
        verification.p1 = {
          playedDeep,
          bestDeep: await clientRef.current.evalPair(serialized, p1Best.choice, p2Choice.choice, deep),
        };
      }
      if (p2Best) {
        verification.p2 = {
          playedDeep,
          bestDeep: await clientRef.current.evalPair(serialized, p1Choice.choice, p2Best.choice, deep),
        };
      }
      return verification;
    };

    /**
     * Item-sensitivity probes for sides still flagged AFTER verification:
     * re-evaluate the played and best pairs with an opposing guessed item
     * swapped for its next usage candidates (≤2 combos per side = ≤4 extra
     * pair-evals). Probes run at the sweep's own settings so their EVs stay
     * comparable to the regret that raised the flag. Acquit-only downstream
     * (analyzeTurn) — this only gathers evidence.
     */
    const probeSensitivity = async (
      getSerialized: () => Promise<string>,
      result: EvalResult,
      turnPlayed: PlayedTurn | null,
      settings: EvalSettings,
      turnVerified: TurnVerification | null,
    ): Promise<TurnSensitivity | null> => {
      if (!params.sensitivityTargetsFor) return null;
      if ((settings.mode ?? 'matrix') !== 'matrix') return null;
      const p1Choice = matchPlayedSide(result, 'p1', turnPlayed);
      const p2Choice = matchPlayedSide(result, 'p2', turnPlayed);
      if (!p1Choice || !p2Choice) return null;
      const probeSettings: EvalSettings = { ...settings, keepPlayed: undefined };
      const out: TurnSensitivity = {};
      for (const side of ['p1', 'p2'] as const) {
        const chosen = side === 'p1' ? p1Choice : p2Choice;
        const best = result.perSide[side][0];
        if (!best || best.ev - chosen.ev < REGRET_THRESHOLD) continue;
        // The deep pass already acquitted this side — nothing left to soften.
        const sign = side === 'p1' ? 1 : -1;
        const deepSide = turnVerified?.[side];
        if (deepSide && Math.max(0, sign * (deepSide.bestDeep - deepSide.playedDeep)) < REGRET_THRESHOLD) continue;
        const opposing = side === 'p1' ? 'p2' : 'p1';
        const targets = params.sensitivityTargetsFor(opposing);
        if (targets.length === 0) continue;
        const serialized = await getSerialized();
        const opposingPlayed = side === 'p1' ? p2Choice : p1Choice;
        const opposingLabels = [opposingPlayed.label, ...(result.perSide[opposing][0] ? [result.perSide[opposing][0].label] : [])];
        const combos = selectProbeCombos(serialized, opposing, targets, opposingLabels);
        const probes: SensitivityProbe[] = [];
        for (const combo of combos) {
          const patched = patchSerializedItem(serialized, opposing, combo.species, combo.item);
          if (!patched) continue;
          clientRef.current ??= new EvalWorkerClient();
          const playedEv = await clientRef.current.evalPair(patched, p1Choice.choice, p2Choice.choice, probeSettings);
          const bestEv = side === 'p1'
            ? await clientRef.current.evalPair(patched, best.choice, p2Choice.choice, probeSettings)
            : await clientRef.current.evalPair(patched, p1Choice.choice, best.choice, probeSettings);
          probes.push({ species: combo.species, item: combo.item, playedEv: sign * playedEv, bestEv: sign * bestEv });
        }
        if (probes.length > 0) out[side] = probes;
      }
      return out.p1 || out.p2 ? out : null;
    };

    /**
     * One sequential pass over `turnList` at `settings`; false = cancelled.
     * `verify` runs the depth+1 misplay verification — final-verdict passes
     * only, never the fast shaping pass (its results are provisional).
     */
    const sweepTurns = async (turnList: number[], settings: EvalSettings, verify: boolean): Promise<boolean> => {
      const { depth, samples } = settings;
      const mode = settings.mode ?? 'matrix';
      for (let index = 0; index < turnList.length; index++) {
        const turn = turnList[index];
        if (runRef.current !== runId) return false;
        const key = params.cacheKeyFor(turn);
        const storeKey = evalStoreKey(key, depth, samples, mode, params.tera);
        const turnPlayed = params.playedFor(turn);
        played[turn - 1] = turnPlayed;

        let hit = cacheRef.current.get(key);
        if (!(hit && hit.depth === depth && hit.samples === samples && hit.mode === mode && teraKey(hit.tera) === teraKey(params.tera))) {
          // Second cache layer: results persisted by a previous session.
          const stored = await loadStoredEval(storeKey);
          if (runRef.current !== runId) return false;
          hit = stored ? {
            result: stored.result, depth, samples, mode: mode, tera: params.tera,
            ...(stored.playedOutcome !== undefined ? { playedOutcome: stored.playedOutcome } : {}),
            ...(stored.verified !== undefined ? { verified: stored.verified } : {}),
            ...(stored.sensitivity !== undefined ? { sensitivity: stored.sensitivity } : {}),
          } : undefined;
          if (hit) cacheRef.current.set(key, hit);
        }
        if (hit) {
          scores[turn - 1] = hit.result.score;
          results[turn - 1] = hit.result;
          // Entries written by single evaluations never computed the
          // played-pair expectation (undefined ≠ null = tried, unmatched) —
          // fill it in so the analysis gets its decision/chance split.
          let outcome: number | null | undefined = hit.playedOutcome;
          if (outcome === undefined) {
            outcome = null;
            const p1Choice = matchPlayedSide(hit.result, 'p1', turnPlayed);
            const p2Choice = matchPlayedSide(hit.result, 'p2', turnPlayed);
            if (p1Choice && p2Choice) {
              try {
                const serialized = await positionFor(turn);
                if (runRef.current !== runId) return false;
                clientRef.current ??= new EvalWorkerClient();
                outcome = await clientRef.current.evalPair(serialized, p1Choice.choice, p2Choice.choice, { depth, samples, mode, tera: params.tera });
              } catch (err) {
                if (runRef.current !== runId) return false;
                if (err instanceof Error && err.message === 'cancelled') return false;
              }
              if (runRef.current !== runId) return false;
            }
            cacheRef.current.set(key, { ...hit, playedOutcome: outcome });
            void saveStoredEval({
              key: storeKey, result: hit.result, depth, samples, mode: mode, tera: params.tera,
              playedOutcome: outcome, savedAt: Date.now(),
            });
          }
          playedOutcome[turn - 1] = outcome;
          // Verification backfill: cached entries from before the pass (or
          // written by single evaluations) never verified their flags.
          let turnVerified: TurnVerification | null | undefined = hit.verified;
          if (verify && turnVerified === undefined) {
            turnVerified = null;
            try {
              turnVerified = await verifyFlagged(() => positionFor(turn), hit.result, turnPlayed, settings);
            } catch (err) {
              if (runRef.current !== runId) return false;
              if (err instanceof Error && err.message === 'cancelled') return false;
            }
            if (runRef.current !== runId) return false;
            cacheRef.current.set(key, { ...cacheRef.current.get(key) ?? hit, verified: turnVerified });
            void saveStoredEval({
              key: storeKey, result: hit.result, depth, samples, mode: mode, tera: params.tera,
              playedOutcome: outcome ?? null, verified: turnVerified, savedAt: Date.now(),
            });
          }
          if (turnVerified !== undefined) verified[turn - 1] = turnVerified;
          // Sensitivity backfill, same shape as the verification backfill.
          let turnSensitivity: TurnSensitivity | null | undefined = hit.sensitivity;
          if (verify && turnSensitivity === undefined) {
            turnSensitivity = null;
            try {
              turnSensitivity = await probeSensitivity(() => positionFor(turn), hit.result, turnPlayed, settings, turnVerified ?? null);
            } catch (err) {
              if (runRef.current !== runId) return false;
              if (err instanceof Error && err.message === 'cancelled') return false;
            }
            if (runRef.current !== runId) return false;
            cacheRef.current.set(key, { ...cacheRef.current.get(key) ?? hit, sensitivity: turnSensitivity });
            void saveStoredEval({
              key: storeKey, result: hit.result, depth, samples, mode: mode, tera: params.tera,
              playedOutcome: outcome ?? null, verified: turnVerified ?? null,
              sensitivity: turnSensitivity, savedAt: Date.now(),
            });
          }
          if (turnSensitivity !== undefined) sensitivity[turn - 1] = turnSensitivity;
        } else {
          try {
            const serialized = await positionFor(turn);
            if (runRef.current !== runId) return false;
            clientRef.current ??= new EvalWorkerClient();
            const keepPlayed = turnPlayed?.p1Slots || turnPlayed?.p2Slots ? turnPlayed : undefined;
            const result = await clientRef.current.evaluate(serialized, { depth, samples, mode, tera: params.tera, keepPlayed });
            if (runRef.current !== runId) return false;
            scores[turn - 1] = result.score;
            results[turn - 1] = result;

            // The engine's expectation of the real choices — the decision
            // part of the coming swing (chance is the rest).
            let outcome: number | null = null;
            const p1Choice = matchPlayedSide(result, 'p1', turnPlayed);
            const p2Choice = matchPlayedSide(result, 'p2', turnPlayed);
            if (p1Choice && p2Choice) {
              try {
                outcome = await clientRef.current.evalPair(serialized, p1Choice.choice, p2Choice.choice, { depth, samples, mode, tera: params.tera });
              } catch (err) {
                if (runRef.current !== runId) return false;
                if (err instanceof Error && err.message === 'cancelled') return false;
              }
              if (runRef.current !== runId) return false;
            }
            playedOutcome[turn - 1] = outcome;

            let turnVerified: TurnVerification | null | undefined;
            let turnSensitivity: TurnSensitivity | null | undefined;
            if (verify) {
              turnVerified = null;
              try {
                turnVerified = await verifyFlagged(() => Promise.resolve(serialized), result, turnPlayed, settings);
              } catch (err) {
                if (runRef.current !== runId) return false;
                if (err instanceof Error && err.message === 'cancelled') return false;
              }
              if (runRef.current !== runId) return false;
              verified[turn - 1] = turnVerified;
              turnSensitivity = null;
              try {
                turnSensitivity = await probeSensitivity(() => Promise.resolve(serialized), result, turnPlayed, settings, turnVerified ?? null);
              } catch (err) {
                if (runRef.current !== runId) return false;
                if (err instanceof Error && err.message === 'cancelled') return false;
              }
              if (runRef.current !== runId) return false;
              sensitivity[turn - 1] = turnSensitivity;
            }
            cacheRef.current.set(key, {
              result, depth, samples, mode: mode, tera: params.tera,
              playedOutcome: outcome,
              ...(turnVerified !== undefined ? { verified: turnVerified } : {}),
              ...(turnSensitivity !== undefined ? { sensitivity: turnSensitivity } : {}),
            });
            void saveStoredEval({
              key: storeKey, result, depth, samples, mode: mode, tera: params.tera,
              playedOutcome: outcome,
              ...(turnVerified !== undefined ? { verified: turnVerified } : {}),
              ...(turnSensitivity !== undefined ? { sensitivity: turnSensitivity } : {}),
              savedAt: Date.now(),
            });
          } catch (err) {
            if (runRef.current !== runId) return false;
            if (err instanceof Error && err.message === 'cancelled') return false;
            // This turn failed (e.g. reconstruction wedge) — leave a gap.
          }
        }
        setGraph({ ...snapshot(), running: true, progress: { done: index + 1, total: turnList.length } });
      }
      return true;
    };

    void (async () => {
      const rangeTurns: number[] = [];
      for (let turn = from; turn <= to; turn++) rangeTurns.push(turn);
      const fullSettings: EvalSettings = { depth, samples, mode, tera: params.tera };
      const fastSettings: EvalSettings = { depth: 1, samples: 1, mode: 'matrix', tera: params.tera };
      const isFast = depth === 1 && samples === 1 && mode !== 'mcts';

      // Two-pass sweep: a fast depth-1 pass shapes the whole graph first,
      // then the configured settings deepen only the turns around the big
      // swings (both sides of each — analysis compares across them). Short
      // ranges (on-demand turn analysis) go straight to full settings.
      if (rangeTurns.length > 2 && !isFast) {
        if (!(await sweepTurns(rangeTurns, fastSettings, false))) return;
        const keyTurns = selectKeyTurns(scores).filter(turn => turn >= from && turn <= to);
        if (keyTurns.length > 0 && !(await sweepTurns(keyTurns, fullSettings, true))) return;
      } else if (!(await sweepTurns(rangeTurns, fullSettings, true))) {
        return;
      }

      // Turn 0: the lead decision, one extra evaluation at full settings —
      // after the graph so the game line appears first.
      if (params.acquirePreview && lead === null && runRef.current === runId) {
        const key = params.cacheKeyFor(0);
        const storeKey = evalStoreKey(key, depth, samples, mode, params.tera);
        let hit = cacheRef.current.get(key);
        if (!(hit && hit.depth === depth && hit.samples === samples && hit.mode === mode && teraKey(hit.tera) === teraKey(params.tera))) {
          const stored = await loadStoredEval(storeKey);
          if (runRef.current !== runId) return;
          hit = stored ? { result: stored.result, depth, samples, mode: mode, tera: params.tera } : undefined;
          if (hit) cacheRef.current.set(key, hit);
        }
        let leadResult = hit?.result ?? null;
        if (!leadResult) {
          try {
            const serialized = await params.acquirePreview();
            if (runRef.current !== runId) return;
            if (serialized) {
              clientRef.current ??= new EvalWorkerClient();
              leadResult = await clientRef.current.evaluate(serialized, fullSettings);
              if (runRef.current !== runId) return;
              cacheRef.current.set(key, { result: leadResult, depth, samples, mode: mode, tera: params.tera });
              void saveStoredEval({
                key: storeKey, result: leadResult, depth, samples, mode: mode, tera: params.tera,
                savedAt: Date.now(),
              });
            }
          } catch (err) {
            if (runRef.current !== runId) return;
            if (err instanceof Error && err.message === 'cancelled') return;
            // No turn 0 for this replay — the graph stands on its own.
          }
        }
        if (leadResult) {
          lead = { result: leadResult, played: params.playedLeads ?? { p1: null, p2: null } };
          setGraph({ ...snapshot(), running: true, progress: null });
        }
      }

      if (runRef.current === runId) {
        setGraph(prev => ({ ...prev, running: false, progress: null }));
      }
    })();
  }, [cancel]);

  const clearGraph = useCallback(() => {
    graphDataRef.current = null;
    setGraph({ scores: [], results: [], played: [], playedOutcome: [], verified: [], sensitivity: [], lead: null, running: false, progress: null });
  }, []);

  return {
    prefs, setPrefs,
    status, result, progress, error, reconstructProgress,
    evaluate, markStale, reset, cancel,
    graph, runGraphSweep, clearGraph,
  };
}
