import { useState, useCallback } from 'react';
import { fetchReplay } from '../lib/replay-fetcher';
import { parseReplayLog } from '../lib/protocol-parser';
import { inferOpponentTeam } from '../lib/opponent-inferrer';
import type { ReplayData, TurnSnapshot, OpponentTeamInfo } from '../types';

export interface ReplayState {
  loading: boolean;
  error: string | null;
  replayData: ReplayData | null;
  snapshots: TurnSnapshot[];
  opponentInfo: OpponentTeamInfo | null;
}

export function useReplay() {
  const [state, setState] = useState<ReplayState>({
    loading: false,
    error: null,
    replayData: null,
    snapshots: [],
    opponentInfo: null,
  });

  const loadReplay = useCallback(async (urlOrId: string) => {
    setState(prev => ({ ...prev, loading: true, error: null }));
    try {
      const data = await fetchReplay(urlOrId);
      const snapshots = parseReplayLog(data.log);
      const opponentInfo = inferOpponentTeam(data.log, 'p2');

      setState({
        loading: false,
        error: null,
        replayData: data,
        snapshots,
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
