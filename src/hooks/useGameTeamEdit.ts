import { useCallback, useState } from 'react';
import type { OpponentTeamInfo } from '@fulllifegames/replay-core';
import { teamOfInfo } from '../lib/new-game/edit-team';
import type { NewGameRecord } from '../lib/new-game/record';


type Teams = { p1: ReturnType<typeof teamOfInfo>; p2: ReturnType<typeof teamOfInfo> };

interface Inputs {
  record: NewGameRecord | null;
  /** A dry run: how many turns the game would keep; changes nothing. */
  planTeams: (teams: Teams) => Promise<{ kept: number; error: string | null } | null>;
  editTeams: (teams: Teams) => Promise<{ kept: number; error: string | null } | null>;
  variationOpen: boolean;
  stopBranch: () => void;
  close: () => void;
}

const keptTurns = (kept: number): string => (kept === 0 ? 'no turn' : kept === 1 ? 'its first turn' : `its first ${kept} turns`);

function cutQuestion(falling: number, kept: number, variationOpen: boolean): string {
  const turns = falling === 1 ? '1 played turn invalid. It falls' : `${falling} played turns invalid. They fall`;
  return `This edit makes ${turns} away: the game keeps ${keptTurns(kept)}${variationOpen ? ', and the open variation goes' : ''}.`;
}

export interface TeamEditConfirm {
  message: string;
  proceed: () => void;
  cancel: () => void;
}

export function useGameTeamEdit({ record, planTeams, editTeams, variationOpen, stopBranch, close }: Inputs) {
  const [notice, setNotice] = useState<string | null>(null);
  const [asked, setAsked] = useState<{ teams: Teams; message: string; close: () => void } | null>(null);
  /** True from the click until the edit applies, fails or is cancelled: the editor stays open but hidden. */
  const [hold, setHold] = useState(false);
  const apply = useCallback((teams: Teams, closeEditor: () => void) => {
    setHold(false);
    closeEditor();
    stopBranch();
    setNotice(null);
    void editTeams(teams).then(outcome => {
      if (outcome?.error) {
        setNotice(`The edited team cannot play every turn. The game keeps ${keptTurns(outcome.kept)}: ${outcome.error}`);
      }
    }, (failure: unknown) => setNotice(`The edit could not be applied: ${failure instanceof Error ? failure.message : String(failure)}`));
  }, [editTeams, stopBranch]);
  /** A null side keeps the record's own sets; false when no game is open; an edit that cuts played turns asks first. */
  const editSides = useCallback((next: { p1: OpponentTeamInfo | null; p2: OpponentTeamInfo | null }, closeEditor: () => void = close): boolean => {
    if (!record) return false;
    const teams = {
      p1: next.p1 ? teamOfInfo(next.p1, record.teams.p1) : record.teams.p1,
      p2: next.p2 ? teamOfInfo(next.p2, record.teams.p2) : record.teams.p2,
    };
    setNotice(null);
    setAsked(null);
    setHold(true);
    void planTeams(teams).then(plan => {
      const falling = plan ? record.turns - plan.kept : 0;
      if (plan && falling > 0) setAsked({ teams, message: cutQuestion(falling, plan.kept, variationOpen), close: closeEditor });
      else apply(teams, closeEditor);
    }, (failure: unknown) => {
      setHold(false);
      closeEditor();
      setNotice(`The edit could not be applied: ${failure instanceof Error ? failure.message : String(failure)}`);
    });
    return true;
  }, [record, planTeams, apply, close, variationOpen]);
  const edit = useCallback((side: 'p1' | 'p2', info: OpponentTeamInfo): boolean => editSides({ p1: null, p2: null, [side]: info }), [editSides]);
  const confirm: TeamEditConfirm | null = asked && {
    message: asked.message,
    proceed: () => { setAsked(null); apply(asked.teams, asked.close); },
    cancel: () => { setAsked(null); setHold(false); },
  };
  return { edit, editSides, notice, confirm, hold, dismiss: () => setNotice(null) };
}
