import { useState, useCallback } from 'react';
import { fetchReplay } from '../lib/replay-fetcher';
import type { ReplayData, TurnSnapshot, OpponentTeamInfo } from '../types';

export interface ReplayState {
  loading: boolean;
  error: string | null;
  replayData: ReplayData | null;
  snapshots: TurnSnapshot[];
  p1Info: OpponentTeamInfo | null;
  opponentInfo: OpponentTeamInfo | null;
}

export function useReplay() {
  const [state, setState] = useState<ReplayState>({
    loading: false,
    error: null,
    replayData: null,
    snapshots: [],
    p1Info: null,
    opponentInfo: null,
  });

  const loadReplay = useCallback(async (urlOrId: string) => {
    setState(prev => ({ ...prev, loading: true, error: null }));
    try {
      const data = await fetchReplay(urlOrId);
      const [{ parseReplayLog }, { inferOpponentTeam }] = await Promise.all([
        import('../lib/protocol-parser'),
        import('../lib/opponent-inferrer'),
      ]);
      const snapshots = parseReplayLog(data.log);
      const p1Info = inferOpponentTeam(data.log, 'p1');
      const opponentInfo = inferOpponentTeam(data.log, 'p2');

      setState({
        loading: false,
        error: null,
        replayData: data,
        snapshots,
        p1Info,
        opponentInfo,
      });
    } catch (err) {
      setState(prev => ({
        ...prev,
        loading: false,
        error: err instanceof Error ? err.message : 'Unknown error',
      }));
    }
  }, []);

  return { ...state, loadReplay };
}
