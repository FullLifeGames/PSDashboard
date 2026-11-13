import { useCallback, useState } from 'react';
import type { OpponentTeamInfo } from '@fulllifegames/replay-core';
import { teamOfInfo } from '../lib/new-game/edit-team';
import type { NewGameRecord } from '../lib/new-game/record';

/**
 * Round 89 (lane H, #105), stage H4: Edit Player and Edit Opp on a new game. The editor hands over the side's `OpponentTeamInfo`;
 * the game takes it as sets (`teamOfInfo`), stops the live branch (its runtime stands on the old teams), plays the record again on
 * the new teams (`editTeams`) and says where the main line ends when an entry no longer applies. A replay keeps its own path.
 */

interface Inputs {
  record: NewGameRecord | null;
  editTeams: (teams: { p1: ReturnType<typeof teamOfInfo>; p2: ReturnType<typeof teamOfInfo> }) => Promise<{ kept: number; error: string | null } | null>;
  /** Stops the live branch and returns the pointer to the main line. */
  stopBranch: () => void;
  close: () => void;
}

export function useGameTeamEdit({ record, editTeams, stopBranch, close }: Inputs) {
  const [notice, setNotice] = useState<string | null>(null);
  const edit = useCallback((side: 'p1' | 'p2', info: OpponentTeamInfo): boolean => {
    if (!record) return false;
    const teams = {
      p1: side === 'p1' ? teamOfInfo(info, record.teams.p1) : record.teams.p1,
      p2: side === 'p2' ? teamOfInfo(info, record.teams.p2) : record.teams.p2,
    };
    stopBranch();
    close();
    setNotice(null);
    void editTeams(teams).then(outcome => {
      if (outcome?.error) {
        setNotice(`The edited team cannot play every turn. The game keeps its first ${outcome.kept} ${outcome.kept === 1 ? 'turn' : 'turns'}: ${outcome.error}`);
      }
    }, (failure: unknown) => setNotice(`The edit could not be applied: ${failure instanceof Error ? failure.message : String(failure)}`));
    return true;
  }, [record, editTeams, stopBranch, close]);
  return { edit, notice, dismiss: () => setNotice(null) };
}
