import { useCallback } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { loadReplayMods } from '../lib/replay-mods';
import type { LoadReplayResult, ReplayState } from './useReplay';
import type { OpponentTeamInfo, ReplayData } from '@fulllifegames/replay-core';

/** The replay state of a new game: opened from the record, nothing fetched, no team inferred; grows turn by turn. */
export function useGameReplay(
  runLoad: (task: () => Promise<ReplayData>, given?: { p1: OpponentTeamInfo; p2: OpponentTeamInfo }) => Promise<LoadReplayResult>,
  setState: Dispatch<SetStateAction<ReplayState>>,
) {
  const openGame = useCallback(
    (data: ReplayData, infos: { p1: OpponentTeamInfo; p2: OpponentTeamInfo }) => runLoad(async () => data, infos),
    [runLoad],
  );

  /** Snapshots and observations follow the grown log; the infos and the id stay. */
  const extendGame = useCallback(async (data: ReplayData): Promise<void> => {
    await loadReplayMods(data);
    const { parseReplayLogWithObservations } = await import('../lib/lazy/protocol-parser');
    const { snapshots, observations, speedOrders, hpEvidence } = parseReplayLogWithObservations(data.log);
    setState(prev => ({ ...prev, replayData: data, snapshots, observations, speedOrders, hpEvidence }));
  }, [setState]);

  return { openGame, extendGame };
}
