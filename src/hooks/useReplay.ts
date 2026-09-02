import { useState, useCallback } from 'react';
import { fetchReplay } from '../lib/replay-fetcher';
import { parseExportedReplay } from '../lib/replay-file';
import type { DamageObservation, HiddenPowerEvidence, ReplayData, SpeedOrderObservation, TurnSnapshot, OpponentTeamInfo } from '@fulllifegames/replay-core';

export interface ReplayState {
  loading: boolean;
  error: string | null;
  replayData: ReplayData | null;
  snapshots: TurnSnapshot[];
  /** Clean damaging hits observed in the protocol — spread inference input. */
  observations: DamageObservation[];
  /** Proven same-turn move order — hard speed constraints for the solver. */
  speedOrders: SpeedOrderObservation[];
  /** Effectiveness readings of typeless Hidden Power hits — type evidence. */
  hpEvidence: HiddenPowerEvidence[];
  p1Info: OpponentTeamInfo | null;
  opponentInfo: OpponentTeamInfo | null;
}

/** Load outcome for callers that need to react (embed host responses). */
export interface LoadReplayResult {
  data: ReplayData | null;
  error: string | null;
}

export function useReplay() {
  const [state, setState] = useState<ReplayState>({
    loading: false,
    error: null,
    replayData: null,
    snapshots: [],
    observations: [],
    speedOrders: [],
    hpEvidence: [],
    p1Info: null,
    opponentInfo: null,
  });

  const runLoad = useCallback(async (task: () => Promise<ReplayData>): Promise<LoadReplayResult> => {
    setState(prev => ({ ...prev, loading: true, error: null }));
    try {
      const data = await task();
      const [{ parseReplayLogWithObservations }, { inferOpponentTeam }] = await Promise.all([
        import('../lib/lazy/protocol-parser'),
        import('../lib/lazy/opponent-inferrer'),
      ]);
      const { snapshots, observations, speedOrders, hpEvidence } = parseReplayLogWithObservations(data.log);
      const p1Info = inferOpponentTeam(data.log, 'p1');
      const opponentInfo = inferOpponentTeam(data.log, 'p2');

      setState({
        loading: false,
        error: null,
        replayData: data,
        snapshots,
        observations,
        speedOrders,
        hpEvidence,
        p1Info,
        opponentInfo,
      });
      return { data, error: null };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setState(prev => ({ ...prev, loading: false, error: message }));
      return { data: null, error: message };
    }
  }, []);

  const loadReplay = useCallback(
    (urlOrId: string) => runLoad(() => fetchReplay(urlOrId)),
    [runLoad],
  );

  const loadReplayFile = useCallback(
    (content: string, fileName?: string) => runLoad(async () => parseExportedReplay(content, fileName)),
    [runLoad],
  );

  return { ...state, loadReplay, loadReplayFile };
}
