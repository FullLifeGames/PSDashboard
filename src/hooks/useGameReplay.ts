import { useCallback } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { loadReplayMods } from '../lib/replay-mods';
import type { LoadReplayResult, ReplayState } from './useReplay';
import type { OpponentTeamInfo, ReplayData } from '@fulllifegames/replay-core';

/**
 * Round 89 (#105): the replay state of a new game. It opens from the record (the log is the simulator's own: nothing is fetched and
 * no team is inferred, both sides are the record's teams) and grows turn by turn.
 */
export function useGameReplay(
  runLoad: (task: () => Promise<ReplayData>, given?: { p1: OpponentTeamInfo; p2: OpponentTeamInfo }) => Promise<LoadReplayResult>,
  setState: Dispatch<SetStateAction<ReplayState>>,
) {
  const openGame = useCallback(
    (data: ReplayData, infos: { p1: OpponentTeamInfo; p2: OpponentTeamInfo }) => runLoad(async () => data, infos),
    [runLoad],
  );

  /** A finished turn joined the game's log: the snapshots and observations follow it, the infos and the id stay. */
  const extendGame = useCallback(async (data: ReplayData): Promise<void> => {
    await loadReplayMods(data);
    const { parseReplayLogWithObservations } = await import('../lib/lazy/protocol-parser');
    const { snapshots, observations, speedOrders, hpEvidence } = parseReplayLogWithObservations(data.log);
    setState(prev => ({ ...prev, replayData: data, snapshots, observations, speedOrders, hpEvidence }));
  }, [setState]);

  return { openGame, extendGame };
}
