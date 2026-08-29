import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DamageObservation, ReplayData, TurnSnapshot } from '../types';
import type { TurnAlignmentRecord } from '../lib/hax-alignment';
import type { useBranch } from './useBranch';
import { buildReplayTeams, reconstructReplayRuntime, type TeamBuildSources } from '../lib/eval-acquire';

type GetBattle = ReturnType<typeof useBranch>['getBattle'];

/**
 * Exact main-line positions the app has already reconstructed, keyed like
 * the eval cache (replay:turn:sets). In the unified timeline exactness is
 * the app's job, not a button: every acquisition (Evaluate, Analyze game's
 * streamed boundaries, the dwell rebuild below) lands here, and the pickers
 * upgrade from approximate to exact the moment a position is known.
 */
function useExactPositions(replayData: ReplayData | null, setsFingerprint: string) {
  // New replay or new set knowledge means yesterday's reconstructions no
  // longer describe these positions: the store swaps itself lazily when its
  // identity key changes (per-entry keys differ anyway; this is memory
  // hygiene). Accessed only from callbacks/effects, never during render.
  const storeIdentity = `${replayData?.id}:${setsFingerprint}`;
  const storeRef = useRef({ identity: storeIdentity, positions: new Map<string, string>(), failed: new Set<string>() });
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
  const storeExactPosition = useCallback((turn: number, serialized: string) => {
    const key = exactKeyFor(turn);
    if (!key || store().positions.get(key) === serialized) return;
    store().positions.set(key, serialized);
    setExactPositionsVersion(version => version + 1);
  }, [exactKeyFor, store]);
  const getExact = useCallback((turn: number) => {
    const key = exactKeyFor(turn);
    return key ? store().positions.get(key) ?? null : null;
  }, [exactKeyFor, store]);
  const hasStored = useCallback((key: string) => store().positions.has(key), [store]);
  const hasFailed = useCallback((key: string) => store().failed.has(key), [store]);
  const markFailed = useCallback((key: string) => { store().failed.add(key); }, [store]);
  return { exactKeyFor, storeExactPosition, getExact, exactPositionsVersion, hasStored, hasFailed, markFailed };
}

type ExactPositions = ReturnType<typeof useExactPositions>;

/** Single-position acquisitions: the live branch battle and the healed
 *  main-line reconstruction behind Evaluate (and the dwell upgrade). */
function useReplayAcquire(args: {
  replayData: ReplayData | null;
  snapshots: TurnSnapshot[];
  observations: DamageObservation[];
  sources: TeamBuildSources;
  bringOnlyLists: { p1: string[]; p2: string[] } | null;
  getBattle: GetBattle;
  exact: ExactPositions;
  viewTurn: number;
}) {
  const { replayData, snapshots, observations, sources, bringOnlyLists, getBattle, exact, viewTurn } = args;

  const acquireBranchPosition = useCallback(async () => {
    const battle = getBattle();
    if (!battle) throw new Error('No live branch battle to evaluate.');
    const { serializeLiveBattle } = await import('../lib/eval/serialize');
    return serializeLiveBattle(battle);
  }, [getBattle]);

  const makeReplayAcquire = useCallback((turn: number) =>
    async (reportReconstruct: (turn: number, target: number) => void) => {
      if (!replayData) throw new Error('Load a replay first.');
      const { serializeLiveBattle } = await import('../lib/eval/serialize');
      const { p1Team, p2Team } = await buildReplayTeams(replayData, sources);
      if (p1Team.length === 0 || p2Team.length === 0) throw new Error('Could not build both teams for this replay.');
      const { runtime, branchEngine } = await reconstructReplayRuntime({
        replayData, p1Team, p2Team, targetTurn: turn, snapshots, observations,
        // Bring-limited replays: the evaluated position fields only the
        // brought species — a bring-all bench offered the search switches
        // into Pokemon the real game never had (A.3c).
        bringOnly: bringOnlyLists ?? undefined,
        onProgress: reportReconstruct,
        // The sweep's healing, on the single-turn path too: per-turn
        // boundary corrections keep a diverging choice replay in lockstep
        // with the protocol, so the cascade zone arrives LIVE instead of
        // prematurely ended.
      });
      const invalid = branchEngine.validateBranchRuntime(runtime);
      if (invalid) throw new Error(invalid);
      const battle = runtime.battleStream.battle;
      if (!battle) throw new Error('Reconstruction produced no battle.');
      // Backstop for replays healing cannot save: an ended (or short)
      // arrival is a divergence artifact, and evaluating it would report a
      // decided ±1.00. Fail loudly instead of publishing a phantom number.
      if (!branchEngine.reconstructionReached(runtime, turn)) {
        throw new Error(`The reconstruction diverged before turn ${turn}: the guessed sets could not reproduce this position. Correcting items/moves via Edit Player/Opp is the common fix.`);
      }
      const serialized = serializeLiveBattle(battle);
      exact.storeExactPosition(turn, serialized);
      return serialized;
    }, [replayData, snapshots, observations, sources, bringOnlyLists, exact]);

  const acquireReplayPosition = useMemo(() => makeReplayAcquire(viewTurn), [makeReplayAcquire, viewTurn]);

  return { acquireBranchPosition, makeReplayAcquire, acquireReplayPosition };
}

/** Single-pass sweep acquisition: one reconstruction captures every turn
 *  boundary, instead of one O(turn) replay per turn (quadratic polling). */
function useSweepAcquire(args: {
  replayData: ReplayData | null;
  snapshots: TurnSnapshot[];
  observations: DamageObservation[];
  sources: TeamBuildSources;
  bringOnlyLists: { p1: string[]; p2: string[] } | null;
  exact: ExactPositions;
}) {
  const { replayData, snapshots, observations, sources, bringOnlyLists, exact } = args;
  // Per-block seed/residual records of the last sweep reconstruction —
  // instrumentation only (debug handle + drift report), never verdicts.
  const [sweepAlignment, setSweepAlignment] = useState<TurnAlignmentRecord[] | null>(null);

  const makeSweepAcquireAll = useCallback((turns: number) =>
    async (
      report: (turn: number, target: number) => void,
      onPosition?: (turn: number, serialized: string) => void,
      onDiagnostic?: (message: string) => void,
    ): Promise<(string | null)[]> => {
      if (!replayData) throw new Error('Load a replay first.');
      setSweepAlignment(null);
      const { serializeLiveBattle } = await import('../lib/eval/serialize');
      const { p1Team, p2Team } = await buildReplayTeams(replayData, sources);
      if (p1Team.length === 0 || p2Team.length === 0) throw new Error('Could not build both teams for this replay.');
      const positions: (string | null)[] = new Array(turns).fill(null);
      const { runtime, branchEngine } = await reconstructReplayRuntime({
        replayData, p1Team, p2Team, targetTurn: turns, snapshots, observations,
        bringOnly: bringOnlyLists ?? undefined,
        onProgress: report,
        onPosition: (turn, battle) => {
          if (turn > turns) return;
          try {
            const serialized = serializeLiveBattle(battle);
            positions[turn - 1] = serialized;
            exact.storeExactPosition(turn, serialized);
            onPosition?.(turn, serialized);
          } catch {
            // A broken boundary becomes a graph gap, not a failed sweep.
          }
        },
      });
      setSweepAlignment(runtime.haxAlignment);
      const finalBattle = runtime.battleStream.battle;
      if (finalBattle?.ended && finalBattle.turn < turns) {
        onDiagnostic?.(
          `The simulated battle ended at turn ${finalBattle.turn} although the real game continued: ` +
          `no candidate seed avoided the divergence, so later turns have no positions.`,
        );
      }
      const invalid = branchEngine.validateBranchRuntime(runtime);
      const battle = runtime.battleStream.battle;
      if (!invalid && battle && branchEngine.reconstructionReached(runtime, turns)) {
        const serialized = serializeLiveBattle(battle);
        positions[turns - 1] = serialized;
        exact.storeExactPosition(turns, serialized);
        onPosition?.(turns, serialized);
      }
      return positions;
    }, [replayData, snapshots, observations, sources, bringOnlyLists, exact]);

  return { sweepAlignment, makeSweepAcquireAll };
}

/**
 * The unified timeline's exactness promise, without a button: when the
 * pointer DWELLS on a main-line turn whose exact position is unknown, the
 * app quietly reconstructs it in the background (the same healed path
 * Evaluate acquires through) and the pickers upgrade in place. Scrubbing
 * stays free — the timer only fires once the user settles, and never while
 * the sim, an evaluation, or a play-out is busy (the dwellEnabled input).
 */
function useDwellReconstruction(args: {
  replayData: ReplayData | null;
  dwellEnabled: boolean;
  smogonPending: boolean;
  viewTurn: number;
  exact: ExactPositions;
  makeReplayAcquire: (turn: number) => (report: (t: number, target: number) => void) => Promise<string>;
}) {
  const { replayData, dwellEnabled, smogonPending, viewTurn, exact, makeReplayAcquire } = args;
  const [exactAcquiringTurn, setExactAcquiringTurn] = useState<number | null>(null);
  const exactAcquireBusyRef = useRef(false);
  useEffect(() => {
    if (!replayData || !dwellEnabled || smogonPending) return;
    const key = exact.exactKeyFor(viewTurn);
    if (!key || exact.hasStored(key) || exact.hasFailed(key)) return;
    const turn = viewTurn;
    const timer = window.setTimeout(() => {
      if (exactAcquireBusyRef.current) return;
      exactAcquireBusyRef.current = true;
      setExactAcquiringTurn(turn);
      void makeReplayAcquire(turn)(() => {})
        .catch(() => {
          // The approximation stays usable — the sim still validates on
          // execute. Remember the failure so a diverging replay does not
          // re-run the reconstruction on every render tick.
          exact.markFailed(key);
        })
        .finally(() => {
          exactAcquireBusyRef.current = false;
          setExactAcquiringTurn(current => (current === turn ? null : current));
        });
    }, 900);
    return () => window.clearTimeout(timer);
  }, [replayData, dwellEnabled, smogonPending, viewTurn, exact, makeReplayAcquire]);
  return exactAcquiringTurn;
}

export function useEvalAcquire(inputs: {
  replayData: ReplayData | null;
  snapshots: TurnSnapshot[];
  observations: DamageObservation[];
  sources: TeamBuildSources;
  setsFingerprint: string;
  bringOnlyLists: { p1: string[]; p2: string[] } | null;
  getBattle: GetBattle;
  viewTurn: number;
  /** View-side gate for the dwell rebuild (main line, nothing busy). */
  dwellEnabled: boolean;
  smogonPending: boolean;
}) {
  const { replayData, snapshots, observations, sources, setsFingerprint, bringOnlyLists, getBattle, viewTurn, dwellEnabled, smogonPending } = inputs;
  const exact = useExactPositions(replayData, setsFingerprint);
  const single = useReplayAcquire({ replayData, snapshots, observations, sources, bringOnlyLists, getBattle, exact, viewTurn });
  const sweep = useSweepAcquire({ replayData, snapshots, observations, sources, bringOnlyLists, exact });
  const exactAcquiringTurn = useDwellReconstruction({
    replayData, dwellEnabled, smogonPending, viewTurn, exact,
    makeReplayAcquire: single.makeReplayAcquire,
  });
  return {
    ...single,
    ...sweep,
    exactAcquiringTurn,
    exactKeyFor: exact.exactKeyFor,
    getExact: exact.getExact,
    storeExactPosition: exact.storeExactPosition,
    exactPositionsVersion: exact.exactPositionsVersion,
  };
}
