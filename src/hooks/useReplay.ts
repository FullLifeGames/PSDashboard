import { useState, useCallback } from 'react';
import { fetchReplay } from '../lib/replay-fetcher';
import { parseExportedReplay } from '../lib/replay-file';
import { loadReplayMods } from '../lib/replay-mods';
import { useGameReplay } from './useGameReplay';
import type {
  DamageObservation, HiddenPowerEvidence, ItemDamageJudge, ReplayData, SpeedOrderObservation, TurnSnapshot, OpponentTeamInfo,
} from '@fulllifegames/replay-core';

export interface ReplayState {
  loading: boolean;
  error: string | null;
  replayData: ReplayData | null;
  snapshots: TurnSnapshot[];
  observations: DamageObservation[];
  speedOrders: SpeedOrderObservation[];
  hpEvidence: HiddenPowerEvidence[];
  p1Info: OpponentTeamInfo | null;
  opponentInfo: OpponentTeamInfo | null;
  /** Loaded with the inference, so the enrichment reads the logged hits with it in the same render. */
  itemJudge: ItemDamageJudge | null;
  /** The replay came by link or id, so the address can name it (`?replay=`); a file or a game has no such address. */
  byLink: boolean;
}

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
    itemJudge: null,
    byLink: false,
  });

  const runLoad = useCallback(async (task: () => Promise<ReplayData>, given?: { p1: OpponentTeamInfo; p2: OpponentTeamInfo }, byLink = false): Promise<LoadReplayResult> => {
    setState(prev => ({ ...prev, loading: true, error: null }));
    try {
      const data = await task();
      await loadReplayMods(data);
      const [{ parseReplayLogWithObservations }, { inferOpponentTeam, judgeItemsByDamage }] = await Promise.all([
        import('../lib/lazy/protocol-parser'),
        import('../lib/lazy/opponent-inferrer'),
      ]);
      const { snapshots, observations, speedOrders, hpEvidence } = parseReplayLogWithObservations(data.log);
      const p1Info = given ? given.p1 : inferOpponentTeam(data.log, 'p1');
      const opponentInfo = given ? given.p2 : inferOpponentTeam(data.log, 'p2');

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
        itemJudge: judgeItemsByDamage,
        byLink,
      });
      return { data, error: null };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setState(prev => ({ ...prev, loading: false, error: message }));
      return { data: null, error: message };
    }
  }, []);

  const { openGame, extendGame } = useGameReplay(runLoad, setState);

  const loadReplay = useCallback(
    (urlOrId: string) => runLoad(() => fetchReplay(urlOrId), undefined, true),
    [runLoad],
  );

  const loadReplayFile = useCallback(
    (content: string, fileName?: string) => runLoad(async () => parseExportedReplay(content, fileName)),
    [runLoad],
  );

  return { ...state, loadReplay, loadReplayFile, openGame, extendGame };
}
