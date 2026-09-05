import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PokemonSet } from '@pkmn/sim';
import { type DamageObservation, type ReplayData, type TurnSnapshot, getBranchSimulatorFormat } from '@fulllifegames/replay-core';
import type { BranchRuntime, ReconstructParams, TurnAlignmentRecord } from '@fulllifegames/eval-engine';
import { buildReplayTeams, type TeamBuildSources } from '../lib/eval-acquire';
import type { ReplayWorkerClient } from '../lib/replay-jobs/client';
import type { ReconstructJob, ReconstructOutcome } from '../lib/replay-jobs/types';

type Report = (turn: number, target: number) => void;
type Teams = { p1Team: PokemonSet[]; p2Team: PokemonSet[] };

/**
 * The exact store's API. Render-stable on purpose: the acquisitions built
 * on it feed effects (the dwell timer, the team-edit refresh), and an
 * identity that churned per render restarted those effects mid-flight —
 * a refresh whose own progress re-rendered the app restarted itself
 * forever. The version counter, which does change as positions land,
 * travels separately for the pickers.
 */
interface ExactStore {
  exactKeyFor(turn: number): string | null;
  storeExactPosition(turn: number, serialized: string): void;
  getExact(turn: number): string | null;
  hasStored(key: string): boolean;
  hasFailed(key: string): boolean;
  markFailed(key: string): void;
}

/**
 * Exact main-line positions the app has already reconstructed, keyed like
 * the eval cache (replay:turn:sets). Exactness is the app's job, not a
 * button: every acquisition (Evaluate, Analyze game's streamed boundaries,
 * the dwell rebuild, a branch start) lands here, the pickers upgrade from
 * approximate to exact the moment a position is known, and every later
 * consumer of the same position reads it instead of reconstructing again.
 */
function useExactPositions(replayData: ReplayData | null, setsFingerprint: string, smogonPending: boolean) {
  // New replay or new set knowledge means yesterday's reconstructions no
  // longer describe these positions: the store swaps itself lazily when its
  // identity key changes (per-entry keys differ anyway; this is memory
  // hygiene). Accessed only from callbacks/effects, never during render.
  const storeIdentity = `${replayData?.id}:${setsFingerprint}`;
  const storeRef = useRef({ identity: storeIdentity, positions: new Map<string, string>(), failed: new Set<string>() });
  // A position built while the Smogon sets are still loading was built on
  // other teams than the settled ones — it may be used once, never kept.
  const smogonPendingRef = useRef(smogonPending);
  useEffect(() => {
    smogonPendingRef.current = smogonPending;
  }, [smogonPending]);
  const [exactPositionsVersion, setExactPositionsVersion] = useState(0);
  const store = useCallback(() => {
    if (storeRef.current.identity !== storeIdentity) {
      storeRef.current = { identity: storeIdentity, positions: new Map(), failed: new Set() };
    }
    return storeRef.current;
  }, [storeIdentity]);
  const exactKeyFor = useCallback(
    (turn: number) => (replayData ? `${replayData.id}:${turn}:${setsFingerprint}` : null),
    [replayData, setsFingerprint],
  );
  const exact = useMemo<ExactStore>(() => ({
    exactKeyFor,
    storeExactPosition: (turn, serialized) => {
      const key = exactKeyFor(turn);
      if (!key || smogonPendingRef.current || store().positions.get(key) === serialized) return;
      store().positions.set(key, serialized);
      setExactPositionsVersion(version => version + 1);
    },
    getExact: turn => {
      const key = exactKeyFor(turn);
      return key ? store().positions.get(key) ?? null : null;
    },
    hasStored: key => store().positions.has(key),
    hasFailed: key => store().failed.has(key),
    markFailed: key => { store().failed.add(key); },
  }), [exactKeyFor, store]);
  return { exact, exactPositionsVersion };
}

interface ReconstructArgs {
  targetTurn: number;
  mode: ReconstructJob['mode'];
  teams: Teams;
  bringOnly?: { p1: string[]; p2: string[] } | null;
  leadOverride?: ReconstructJob['leadOverride'];
  onProgress?: Report;
  onPosition?: (turn: number, serialized: string) => void;
  signal?: AbortSignal;
}

/** The worker reconstruction over the app's replay inputs; every healed boundary of a replay pass lands in the store. */
function useWorkerReconstruct(args: {
  replayData: ReplayData | null;
  snapshots: TurnSnapshot[];
  observations: DamageObservation[];
  sources: TeamBuildSources;
  replayWorker: ReplayWorkerClient;
  exact: ExactStore;
}) {
  const { replayData, snapshots, observations, sources, replayWorker, exact } = args;
  const reconstruct = useCallback((run: ReconstructArgs): Promise<ReconstructOutcome> => {
    if (!replayData) throw new Error('Load a replay first.');
    const job: ReconstructJob = {
      format: getBranchSimulatorFormat(replayData),
      p1Team: run.teams.p1Team,
      p2Team: run.teams.p2Team,
      replayLog: replayData.log,
      targetTurn: run.targetTurn,
      snapshots,
      playerNames: [replayData.players[0], replayData.players[1]],
      observations,
      bringOnly: run.bringOnly ?? null,
      leadOverride: run.leadOverride,
      mode: run.mode,
    };
    return replayWorker.reconstruct(job, {
      onProgress: run.onProgress,
      onPosition: (turn, serialized) => {
        if (run.mode === 'replay') exact.storeExactPosition(turn, serialized);
        run.onPosition?.(turn, serialized);
      },
    }, run.signal);
  }, [replayData, snapshots, observations, replayWorker, exact]);

  const buildTeams = useCallback(async (): Promise<Teams> => {
    if (!replayData) throw new Error('Load a replay first.');
    const teams = await buildReplayTeams(replayData, sources);
    if (teams.p1Team.length === 0 || teams.p2Team.length === 0) throw new Error('Could not build both teams for this replay.');
    return teams;
  }, [replayData, sources]);

  return { reconstruct, buildTeams };
}

type Reconstruct = ReturnType<typeof useWorkerReconstruct>['reconstruct'];
type BuildTeams = ReturnType<typeof useWorkerReconstruct>['buildTeams'];

/** The sweep's honest story when the simulated game ended before the real one. */
function sweepDiagnostic(outcome: ReconstructOutcome, turns: number): string | null {
  if (!outcome.ended || outcome.turn >= turns) return null;
  return `The simulated battle ended at turn ${outcome.turn} although the real game continued: ` +
    'no candidate seed avoided the divergence, so later turns have no positions.';
}

/** Main-line acquisitions: the single exact turn (Evaluate, the dwell) and the sweep's streamed pass. */
function useMainLineAcquire(args: {
  exact: ExactStore;
  reconstruct: Reconstruct;
  buildTeams: BuildTeams;
  bringOnlyLists: { p1: string[]; p2: string[] } | null;
}) {
  const { exact, reconstruct, buildTeams, bringOnlyLists } = args;
  // Per-block seed/residual records of the last sweep reconstruction —
  // instrumentation only (debug handle + drift report), never verdicts.
  const [sweepAlignment, setSweepAlignment] = useState<TurnAlignmentRecord[] | null>(null);

  /** The exact position of a main-line turn: stored, else reconstructed (healed) in the worker. */
  const acquireExact = useCallback(async (turn: number, report: Report, signal?: AbortSignal): Promise<string> => {
    const stored = exact.getExact(turn);
    if (stored) return stored;
    const teams = await buildTeams();
    const outcome = await reconstruct({ targetTurn: turn, mode: 'replay', teams, bringOnly: bringOnlyLists, onProgress: report, signal });
    if (outcome.invalid) throw new Error(outcome.invalid);
    if (!outcome.serialized) throw new Error('Reconstruction produced no battle.');
    // Backstop for replays healing cannot save: an ended (or short)
    // arrival is a divergence artifact, and evaluating it would report a
    // decided ±1.00. Fail loudly instead of publishing a phantom number.
    if (!outcome.reached) {
      throw new Error(`The reconstruction diverged before turn ${turn}: the guessed sets could not reproduce this position. Correcting items/moves via Edit Player/Opp is the common fix.`);
    }
    exact.storeExactPosition(turn, outcome.serialized);
    return outcome.serialized;
  }, [exact, buildTeams, reconstruct, bringOnlyLists]);

  /** Single-pass sweep acquisition: one reconstruction captures every turn boundary. */
  const acquireAll = useCallback(async (
    turns: number,
    report: Report,
    onPosition?: (turn: number, serialized: string) => void,
    onDiagnostic?: (message: string) => void,
  ): Promise<(string | null)[]> => {
    setSweepAlignment(null);
    const teams = await buildTeams();
    const positions: (string | null)[] = new Array(turns).fill(null);
    const outcome = await reconstruct({
      targetTurn: turns, mode: 'replay', teams, bringOnly: bringOnlyLists, onProgress: report,
      onPosition: (turn, serialized) => {
        if (turn > turns) return;
        positions[turn - 1] = serialized;
        onPosition?.(turn, serialized);
      },
    });
    setSweepAlignment(outcome.haxAlignment);
    const diagnostic = sweepDiagnostic(outcome, turns);
    if (diagnostic) onDiagnostic?.(diagnostic);
    if (!outcome.invalid && outcome.serialized && outcome.reached) {
      positions[turns - 1] = outcome.serialized;
      exact.storeExactPosition(turns, outcome.serialized);
      onPosition?.(turns, outcome.serialized);
    }
    return positions;
  }, [buildTeams, reconstruct, bringOnlyLists, exact]);

  return { sweepAlignment, acquireExact, acquireAll };
}

/**
 * The branch start's runtime: a stored position adopts at once; anything
 * else reconstructs in the worker (a lead game for turn 0) and adopts the
 * arrival. Only a sim that could not even start falls back to the
 * main-thread reconstruction, which reports that case as it always did.
 */
function useRuntimeAcquire(args: { replayData: ReplayData | null; exact: ExactStore; reconstruct: Reconstruct }) {
  const { replayData, exact, reconstruct } = args;
  return useCallback(async (params: ReconstructParams, plan: { isT0: boolean }): Promise<BranchRuntime> => {
    const branchEngine = await import('../lib/lazy/branch-engine');
    if (!replayData) return branchEngine.reconstructBranchRuntime(params);
    const adopt = (serialized: string, outcome?: ReconstructOutcome) => branchEngine.adoptSerializedRuntime({
      serialized, replayLog: params.replayLog, targetTurn: params.targetTurn,
      snapshot: plan.isT0 ? null : params.snapshot ?? null,
      ...(outcome ? { log: outcome.log, haxAlignment: outcome.haxAlignment, timedOut: outcome.timedOut } : {}),
    });
    if (!plan.isT0) {
      const stored = exact.getExact(params.targetTurn);
      if (stored) return adopt(stored);
    }
    const outcome = await reconstruct({
      targetTurn: params.targetTurn, mode: plan.isT0 ? 'lead' : 'replay',
      teams: { p1Team: params.p1Team, p2Team: params.p2Team },
      bringOnly: params.bringOnly, leadOverride: params.leadOverride,
      onProgress: params.onProgress, signal: params.abort,
    });
    if (!outcome.serialized) return branchEngine.reconstructBranchRuntime(params);
    if (!plan.isT0 && outcome.reached && !outcome.invalid) exact.storeExactPosition(params.targetTurn, outcome.serialized);
    return adopt(outcome.serialized, outcome);
  }, [replayData, exact, reconstruct]);
}

/**
 * One position source for every acquisition path (round 38): the exact
 * store, and behind it the replay worker. The single-turn acquire behind
 * Evaluate and the dwell, the sweep's streamed pass, and the branch start
 * all resolve here — and a position the app already holds is handed out
 * instead of reconstructed a second or third time.
 */
export function usePositionSource(inputs: {
  replayData: ReplayData | null;
  snapshots: TurnSnapshot[];
  observations: DamageObservation[];
  sources: TeamBuildSources;
  setsFingerprint: string;
  bringOnlyLists: { p1: string[]; p2: string[] } | null;
  smogonPending: boolean;
  replayWorker: ReplayWorkerClient;
}) {
  const { replayData, snapshots, observations, sources, setsFingerprint, bringOnlyLists, smogonPending, replayWorker } = inputs;
  const { exact, exactPositionsVersion } = useExactPositions(replayData, setsFingerprint, smogonPending);
  // The worker's bundle parses while the replay is still loading.
  useEffect(() => {
    if (replayData) replayWorker.warm();
  }, [replayData, replayWorker]);
  const { reconstruct, buildTeams } = useWorkerReconstruct({ replayData, snapshots, observations, sources, replayWorker, exact });
  const { sweepAlignment, acquireExact, acquireAll } = useMainLineAcquire({ exact, reconstruct, buildTeams, bringOnlyLists });
  const acquireRuntime = useRuntimeAcquire({ replayData, exact, reconstruct });
  return useMemo(() => ({
    ...exact, exactPositionsVersion, sweepAlignment, acquireExact, acquireAll, acquireRuntime,
  }), [exact, exactPositionsVersion, sweepAlignment, acquireExact, acquireAll, acquireRuntime]);
}

export type PositionSource = ReturnType<typeof usePositionSource>;
