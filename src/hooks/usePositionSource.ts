import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PokemonSet } from '@pkmn/sim';
import { type DamageObservation, type ReplayData, type TurnSnapshot, getBranchSimulatorFormat } from '@fulllifegames/replay-core';
import type { BranchRuntime, BringWorld, ReconstructParams, ReplacementPoint, TurnAlignmentRecord } from '@fulllifegames/eval-engine';
import { buildReplayTeams, type TeamBuildSources } from '../lib/eval-acquire';
import { throttleLatest } from '../lib/eval/throttle-latest';
import { registerWorldPositions, worldPositionsOf, type WorldPosition } from '../lib/eval/world-positions';
import type { ReplayWorkerClient } from '../lib/replay-jobs/client';
import type { ReconstructJob, ReconstructOutcome } from '../lib/replay-jobs/types';
import type { NewGameRecord } from '../lib/new-game/record';
import { useGamePositions, type GamePositions } from './useGamePositions';

type Report = (turn: number, target: number) => void;
type Teams = { p1Team: PokemonSet[]; p2Team: PokemonSet[] };

/** A streamed sweep pass stores one position per message; the pickers repaint at most this often. */
const VERSION_REPAINT_MS = 100;

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
function useExactPositions(replayData: ReplayData | null, setsFingerprint: string, smogonPending: boolean, worldsKey: string) {
  // New replay or new set knowledge means yesterday's reconstructions no
  // longer describe these positions: the store swaps itself lazily when its
  // identity key changes (per-entry keys differ anyway; this is memory
  // hygiene). Accessed only from callbacks/effects, never during render.
  // Round 89 (#124): the main line is the heaviest world's, so other worlds (the statistics moved the heaviest guess) are other positions.
  const storeIdentity = `${replayData?.id}:${setsFingerprint}:${worldsKey}`;
  const storeRef = useRef({ identity: storeIdentity, positions: new Map<string, string>(), failed: new Set<string>() });
  // A position built while the Smogon sets are still loading was built on
  // other teams than the settled ones — it may be used once, never kept.
  const smogonPendingRef = useRef(smogonPending);
  useEffect(() => {
    smogonPendingRef.current = smogonPending;
  }, [smogonPending]);
  const [exactPositionsVersion, setExactPositionsVersion] = useState(0);
  const [bumpVersion] = useState(() =>
    throttleLatest<null>(() => setExactPositionsVersion(version => version + 1), VERSION_REPAINT_MS));
  useEffect(() => () => bumpVersion.cancel(), [bumpVersion]);
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
      bumpVersion.push(null);
    },
    getExact: turn => {
      const key = exactKeyFor(turn);
      return key ? store().positions.get(key) ?? null : null;
    },
    hasStored: key => store().positions.has(key),
    hasFailed: key => store().failed.has(key),
    markFailed: key => { store().failed.add(key); },
  }), [exactKeyFor, store, bumpVersion]);
  return { exact, exactPositionsVersion };
}

interface ReconstructArgs {
  targetTurn: number;
  mode: ReconstructJob['mode'];
  teams: Teams;
  bringOnly?: ReconstructJob['bringOnly'];
  leadOverride?: ReconstructJob['leadOverride'];
  /** Round 89 (#105): the dice seed of a new game's lead job. */
  seed?: string;
  /** Round 89 (#124): false for a pass over another world: its positions never enter the main line's exact store. */
  store?: boolean;
  onProgress?: Report;
  onPosition?: (turn: number, serialized: string) => void;
  /** Round 79 (T290): asks the worker for the open replacement requests of the knockouts too. */
  onReplacement?: (point: ReplacementPoint, serialized: string) => void;
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
      ...(run.seed ? { seed: run.seed } : {}),
      mode: run.mode,
      ...(run.onReplacement ? { replacements: true } : {}),
    };
    return replayWorker.reconstruct(job, {
      onProgress: run.onProgress,
      onPosition: (turn, serialized) => {
        if (run.mode === 'replay' && run.store !== false) exact.storeExactPosition(turn, serialized);
        run.onPosition?.(turn, serialized);
      },
      onReplacement: run.onReplacement,
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

/** A sibling world's list as the replay job takes it. */
const listOf = (world: BringWorld) => ({ p1: world.p1, p2: world.p2, guessed: world.guessed });
const pointKey = (point: ReplacementPoint) => `${point.turn}:${point.ordinal}`;

/** What the lighter worlds' passes found: their positions per turn and their replacement requests per point. */
interface SiblingPasses {
  positions: Map<string, string>[];
  replacements: Map<string, string>[];
  worlds: BringWorld[];
}

/**
 * Round 89 (#124): the main-line positions the user plays are the heaviest world's. This registers the positions of every other
 * world beside each one (`world-positions.ts`), so the worker client searches them all and blends by usage. The passes of the
 * lighter worlds run first, one after the other; a world whose pass fails drops out and the rest keep their weights.
 */
function useWorldPasses(args: { reconstruct: Reconstruct; bringWorlds: BringWorld[] | null }) {
  const { reconstruct, bringWorlds } = args;
  const worlds = bringWorlds && bringWorlds.length > 1 ? bringWorlds : null;

  const runSiblings = useCallback(async (run: {
    targetTurn: number; teams: Teams; report?: Report; signal?: AbortSignal; replacements: boolean;
  }): Promise<SiblingPasses | null> => {
    if (!worlds) return null;
    const passes: SiblingPasses = { positions: [], replacements: [], worlds: [] };
    for (const world of worlds.slice(1)) {
      const positions = new Map<string, string>();
      const replacements = new Map<string, string>();
      try {
        const outcome = await reconstruct({
          targetTurn: run.targetTurn, mode: 'replay', teams: run.teams, bringOnly: listOf(world), store: false, onProgress: run.report, signal: run.signal,
          onPosition: (turn, serialized) => { if (turn <= run.targetTurn) positions.set(String(turn), serialized); },
          ...(run.replacements ? { onReplacement: (point: ReplacementPoint, serialized: string) => { replacements.set(pointKey(point), serialized); } } : {}),
        });
        if (!outcome.invalid && outcome.serialized && outcome.reached) positions.set(String(run.targetTurn), outcome.serialized);
      } catch (error) {
        if (run.signal?.aborted) throw error;
        continue;
      }
      passes.positions.push(positions);
      passes.replacements.push(replacements);
      passes.worlds.push(world);
    }
    return passes;
  }, [reconstruct, worlds]);

  /** Registers one position of the heaviest world with the lighter worlds' positions found under `key` (a turn, or a replacement point). */
  const register = useCallback((primary: string, passes: SiblingPasses | null, found: 'positions' | 'replacements', key: string) => {
    if (!worlds || !passes) return;
    const siblings = passes[found].flatMap((held, index): WorldPosition[] => {
      const position = held.get(key);
      return position === undefined ? [] : [{ position, weight: passes.worlds[index].weight }];
    });
    registerWorldPositions([{ position: primary, weight: worlds[0].weight }, ...siblings]);
  }, [worlds]);

  return { runSiblings, register, hasWorlds: worlds !== null };
}

interface MainLineArgs {
  exact: ExactStore;
  reconstruct: Reconstruct;
  buildTeams: BuildTeams;
  bringOnlyLists: ReconstructJob['bringOnly'];
  worlds: ReturnType<typeof useWorldPasses>;
}

/** The exact position of a main-line turn: stored, else reconstructed (healed) in the worker, with the lighter worlds' siblings beside it. */
function useAcquireExact(args: MainLineArgs) {
  const { exact, reconstruct, buildTeams, bringOnlyLists, worlds: { runSiblings, register, hasWorlds } } = args;
  return useCallback(async (turn: number, report: Report, signal?: AbortSignal): Promise<string> => {
    const stored = exact.getExact(turn);
    const teams = stored && (!hasWorlds || worldPositionsOf(stored)) ? null : await buildTeams();
    if (stored) {
      // A position the branch start stored has no siblings yet: the lighter worlds' passes to this turn complete it.
      if (teams) register(stored, await runSiblings({ targetTurn: turn, teams, report, signal, replacements: false }), 'positions', String(turn));
      return stored;
    }
    const siblings = await runSiblings({ targetTurn: turn, teams: teams!, report, signal, replacements: false });
    const outcome = await reconstruct({
      targetTurn: turn, mode: 'replay', teams: teams!, bringOnly: bringOnlyLists, onProgress: report, signal,
      onPosition: (boundary, serialized) => register(serialized, siblings, 'positions', String(boundary)),
    });
    if (outcome.invalid) throw new Error(outcome.invalid);
    if (!outcome.serialized) throw new Error('Reconstruction produced no battle.');
    // Backstop for replays healing cannot save: an ended (or short)
    // arrival is a divergence artifact, and evaluating it would report a
    // decided ±1.00. Fail loudly instead of publishing a phantom number.
    if (!outcome.reached) {
      throw new Error(`The reconstruction diverged before turn ${turn}: the guessed sets could not reproduce this position. Correcting items/moves via Edit Player/Opp is the common fix.`);
    }
    register(outcome.serialized, siblings, 'positions', String(turn));
    exact.storeExactPosition(turn, outcome.serialized);
    return outcome.serialized;
  }, [exact, buildTeams, reconstruct, bringOnlyLists, hasWorlds, runSiblings, register]);
}

/** Single-pass sweep acquisition: one reconstruction captures every turn boundary. */
function useAcquireAll(args: MainLineArgs & { setSweepAlignment: (records: TurnAlignmentRecord[] | null) => void }) {
  const { exact, reconstruct, buildTeams, bringOnlyLists, setSweepAlignment, worlds: { runSiblings, register } } = args;
  return useCallback(async (
    turns: number,
    report: Report,
    onPosition?: (turn: number, serialized: string) => void,
    onDiagnostic?: (message: string) => void,
    onReplacement?: (point: ReplacementPoint, serialized: string) => void,
  ): Promise<(string | null)[]> => {
    setSweepAlignment(null);
    const teams = await buildTeams();
    const positions: (string | null)[] = new Array(turns).fill(null);
    // Round 89 (#124): the lighter worlds first, so every position the sweep receives already knows its siblings.
    const siblings = await runSiblings({ targetTurn: turns, teams, report, replacements: onReplacement !== undefined });
    const outcome = await reconstruct({
      targetTurn: turns, mode: 'replay', teams, bringOnly: bringOnlyLists, onProgress: report,
      onPosition: (turn, serialized) => {
        if (turn > turns) return;
        positions[turn - 1] = serialized;
        register(serialized, siblings, 'positions', String(turn));
        onPosition?.(turn, serialized);
      },
      onReplacement: onReplacement && ((point, serialized) => {
        register(serialized, siblings, 'replacements', pointKey(point));
        onReplacement(point, serialized);
      }),
    });
    setSweepAlignment(outcome.haxAlignment);
    const diagnostic = sweepDiagnostic(outcome, turns);
    if (diagnostic) onDiagnostic?.(diagnostic);
    if (!outcome.invalid && outcome.serialized && outcome.reached) {
      positions[turns - 1] = outcome.serialized;
      register(outcome.serialized, siblings, 'positions', String(turns));
      exact.storeExactPosition(turns, outcome.serialized);
      onPosition?.(turns, outcome.serialized);
    }
    return positions;
  }, [buildTeams, reconstruct, bringOnlyLists, exact, runSiblings, register, setSweepAlignment]);
}

/** Main-line acquisitions: the single exact turn (Evaluate, the dwell) and the sweep's streamed pass. */
function useMainLineAcquire(args: Omit<MainLineArgs, 'worlds'> & { bringWorlds: BringWorld[] | null }) {
  const { bringWorlds, ...rest } = args;
  const worlds = useWorldPasses({ reconstruct: args.reconstruct, bringWorlds });
  // Per-block seed/residual records of the last sweep reconstruction —
  // instrumentation only (debug handle + drift report), never verdicts.
  const [sweepAlignment, setSweepAlignment] = useState<TurnAlignmentRecord[] | null>(null);
  const acquireExact = useAcquireExact({ ...rest, worlds });
  const acquireAll = useAcquireAll({ ...rest, worlds, setSweepAlignment });
  return { sweepAlignment, acquireExact, acquireAll };
}

/**
 * The branch start's runtime: a stored position adopts at once; anything
 * else reconstructs in the worker (a lead game for turn 0) and adopts the
 * arrival. Only a sim that could not even start falls back to the
 * main-thread reconstruction, which reports that case as it always did.
 */
function useRuntimeAcquire(args: { replayData: ReplayData | null; exact: ExactStore; reconstruct: Reconstruct; game: GamePositions | null }) {
  const { replayData, exact, reconstruct, game } = args;
  return useCallback(async (params: ReconstructParams, plan: { isT0: boolean }): Promise<BranchRuntime> => {
    const branchEngine = await import('../lib/lazy/branch-engine');
    if (!replayData) return branchEngine.reconstructBranchRuntime(params);
    // A Champions position revives on the Champions mod, loaded in this realm first (round 67, T145).
    await branchEngine.loadSimMods(params.format);
    const adopt = (serialized: string, outcome?: ReconstructOutcome) => branchEngine.adoptSerializedRuntime({
      serialized, replayLog: params.replayLog, targetTurn: params.targetTurn,
      snapshot: plan.isT0 ? null : game ? game.adoptSnapshot() : params.snapshot ?? null,
      ...(outcome ? { log: outcome.log, haxAlignment: outcome.haxAlignment, timedOut: outcome.timedOut } : {}),
    });
    // A game's positions are the record's: stored, else rebuilt from its entries; a miss never starts a 'replay' job (round 89, #105).
    if (!plan.isT0 && game) return adopt(await game.acquireExact(params.targetTurn));
    if (!plan.isT0) {
      const stored = exact.getExact(params.targetTurn);
      if (stored) return adopt(stored);
    }
    const outcome = await reconstruct({
      targetTurn: params.targetTurn, mode: plan.isT0 ? 'lead' : 'replay',
      teams: { p1Team: params.p1Team, p2Team: params.p2Team },
      bringOnly: params.bringOnly, leadOverride: params.leadOverride, ...(params.seed ? { seed: params.seed } : {}),
      onProgress: params.onProgress, signal: params.abort,
    });
    if (!outcome.serialized) return branchEngine.reconstructBranchRuntime(params);
    if (!plan.isT0 && outcome.reached && !outcome.invalid) exact.storeExactPosition(params.targetTurn, outcome.serialized);
    return adopt(outcome.serialized, outcome);
  }, [replayData, exact, reconstruct, game]);
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
  bringOnlyLists: ReconstructJob['bringOnly'];
  /** Round 89 (#124): the worlds of a short-side game, the heaviest first (`bringOnlyLists` is its list); null for any other game. */
  bringWorlds?: BringWorld[] | null;
  smogonPending: boolean;
  replayWorker: ReplayWorkerClient;
  /** Round 89 (#105): the record of a new game; its positions never come from a replay job. */
  gameRecord?: NewGameRecord | null;
}) {
  const { gameRecord = null, replayData, snapshots, observations, sources, setsFingerprint, bringOnlyLists, bringWorlds = null, smogonPending, replayWorker } = inputs;
  const worldsKey = useMemo(() => (bringWorlds ? JSON.stringify(bringWorlds) : ''), [bringWorlds]);
  const { exact, exactPositionsVersion } = useExactPositions(replayData, setsFingerprint, smogonPending && !gameRecord, worldsKey);
  // The worker's bundle parses while the replay is still loading.
  useEffect(() => {
    if (replayData) replayWorker.warm();
  }, [replayData, replayWorker]);
  const { reconstruct, buildTeams } = useWorkerReconstruct({ replayData, snapshots, observations, sources, replayWorker, exact });
  const { sweepAlignment, acquireExact, acquireAll } = useMainLineAcquire({ exact, reconstruct, buildTeams, bringOnlyLists, bringWorlds });
  const game = useGamePositions({ record: gameRecord, exact });
  const acquireRuntime = useRuntimeAcquire({ replayData, exact, reconstruct, game });
  return useMemo(() => ({
    ...exact, exactPositionsVersion, sweepAlignment, acquireExact: game?.acquireExact ?? acquireExact, acquireAll: game?.acquireAll ?? acquireAll, acquireRuntime,
  }), [exact, exactPositionsVersion, sweepAlignment, acquireExact, acquireAll, acquireRuntime, game]);
}

export type PositionSource = ReturnType<typeof usePositionSource>;
