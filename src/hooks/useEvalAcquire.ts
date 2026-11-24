import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReplacementPoint } from '@fulllifegames/eval-engine';
import type { ReplayData } from '@fulllifegames/replay-core';
import type { useBranch } from './useBranch';
import type { PositionSource } from './usePositionSource';

type GetBattle = ReturnType<typeof useBranch>['getBattle'];
type Report = (turn: number, target: number) => void;

function useDwellReconstruction(args: {
  replayData: ReplayData | null;
  dwellEnabled: boolean;
  smogonPending: boolean;
  viewTurn: number;
  source: PositionSource;
}) {
  const { replayData, dwellEnabled, smogonPending, viewTurn, source } = args;
  const { exactKeyFor, hasStored, hasFailed, markFailed, acquireExact } = source;
  const [exactAcquiringTurn, setExactAcquiringTurn] = useState<number | null>(null);
  const exactAcquireBusyRef = useRef(false);
  useEffect(() => {
    if (!replayData || !dwellEnabled || smogonPending) return;
    const key = exactKeyFor(viewTurn);
    if (!key || hasStored(key) || hasFailed(key)) return;
    // A turn settled on while another acquires waits, not dropped: the effect reruns when `exactAcquiringTurn` changes.
    if (exactAcquiringTurn !== null) return;
    const turn = viewTurn;
    const timer = window.setTimeout(() => {
      if (exactAcquireBusyRef.current) return;
      exactAcquireBusyRef.current = true;
      setExactAcquiringTurn(turn);
      void acquireExact(turn, () => {})
        .catch(() => {
          // The approximation stays usable; remember the failure so a diverging replay does not re-run every render.
          markFailed(key);
        })
        .finally(() => {
          exactAcquireBusyRef.current = false;
          setExactAcquiringTurn(current => (current === turn ? null : current));
        });
    }, 900);
    return () => window.clearTimeout(timer);
  }, [replayData, dwellEnabled, smogonPending, viewTurn, exactAcquiringTurn, exactKeyFor, hasStored, hasFailed, markFailed, acquireExact]);
  return exactAcquiringTurn;
}

/** The acquisition surface the evaluation and picker layers read, all over the one position source. */
export function useEvalAcquire(inputs: {
  replayData: ReplayData | null;
  source: PositionSource;
  getBattle: GetBattle;
  viewTurn: number;
  dwellEnabled: boolean;
  smogonPending: boolean;
}) {
  const { replayData, source, getBattle, viewTurn, dwellEnabled, smogonPending } = inputs;
  const { acquireExact, acquireAll } = source;

  const acquireBranchPosition = useCallback(async () => {
    const battle = getBattle();
    if (!battle) throw new Error('No live branch battle to evaluate.');
    const { serializeLiveBattle } = await import('../lib/lazy/serialize');
    return serializeLiveBattle(battle);
  }, [getBattle]);

  const makeReplayAcquire = useCallback(
    (turn: number) => (reportReconstruct: Report) => acquireExact(turn, reportReconstruct),
    [acquireExact],
  );
  const acquireReplayPosition = useMemo(() => makeReplayAcquire(viewTurn), [makeReplayAcquire, viewTurn]);
  const makeSweepAcquireAll = useCallback((turns: number) =>
    (
      report: Report,
      onPosition?: (turn: number, serialized: string) => void,
      onDiagnostic?: (message: string) => void,
      onReplacement?: (point: ReplacementPoint, serialized: string) => void,
    ) => (onReplacement
      ? acquireAll(turns, report, onPosition, onDiagnostic, onReplacement)
      : acquireAll(turns, report, onPosition, onDiagnostic)), [acquireAll]);

  const exactAcquiringTurn = useDwellReconstruction({ replayData, dwellEnabled, smogonPending, viewTurn, source });
  return {
    acquireBranchPosition, makeReplayAcquire, acquireReplayPosition, makeSweepAcquireAll,
    sweepAlignment: source.sweepAlignment,
    exactAcquiringTurn,
    exactKeyFor: source.exactKeyFor,
    getExact: source.getExact,
    storeExactPosition: source.storeExactPosition,
    exactPositionsVersion: source.exactPositionsVersion,
  };
}
