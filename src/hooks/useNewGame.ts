import { useCallback, useEffect, useRef, useState } from 'react';
import { Teams } from '@pkmn/sim';
import type { PokemonSet } from '@pkmn/sim';
import { parsePastedTeam, teamInfoOfSets, type OpponentTeamInfo, type ReplayData } from '@fulllifegames/replay-core';
import { appendTurn, gameReplayData, withoutPosition, withPendingTurn, type NewGameRecord } from '../lib/new-game/record';
import { isInterlude, turnEntryCount } from '../lib/variation-turns';
import { bodyLines, newLines } from '../lib/new-game/game-log';
import { saveGame } from '../lib/new-game/store';
import { gamePositions, rebuildGame } from './branch/game-rebuild';
import { forceSwitches } from './branch/shared';
import type { BranchHistoryEntry, BattleStream } from './branch/shared';

/** A new game in the hooks: the record is the truth, the replay data is its log, and a turn played at the game's tip joins the main
 *  line ("promotion"): the record takes its entries, the exact store the positions, the replay state the grown log, and the live
 *  branch rebases at the new tip. */

export function useGameState(replayId?: string | null) {
  const [held, setState] = useState<NewGameRecord | null>(null);
  const recordRef = useRef<NewGameRecord | null>(null);
  const setRecord = useCallback((next: NewGameRecord | null) => {
    recordRef.current = next;
    setState(next);
  }, []);
  // The record is the game of the replay data that carries its id: while another replay is on screen (or the game's own data is
  // still on its way) the app reads no game. Without an id to compare (the hook specs) the record stands as set.
  const record = held && (replayId === undefined || held.id === replayId) ? held : null;
  return { record, recordRef, setRecord };
}

export type GameState = ReturnType<typeof useGameState>;

export function infoOfTeam(team: PokemonSet[]): OpponentTeamInfo {
  return teamInfoOfSets(parsePastedTeam(Teams.export(team)));
}

/** The pointer turn the main line's next turn is played from: turn 0 before the lead pick, else the turn after the finished ones. */
export const gameTipTurn = (record: NewGameRecord): number => (record.entries.length === 0 ? 0 : record.turns + 1);

function replacementPending(stream: BattleStream | null): boolean {
  const battle = stream?.battle;
  if (!battle) return false;
  return (['p1', 'p2'] as const).some(side => forceSwitches(battle, side).some(Boolean));
}

/** The turn the pointer should land on once an opened game's replay state has reset it (a saved game's tip, turn 0 at Team Preview),
 *  else null. The board's reset runs once for replay data without an id (a reload on `?game=` mounts it while the document is on its
 *  way) and again for the new id; only the run for the game's own id takes the landing. */
function useLanding() {
  const landing = useRef<{ id: string; turn: number } | null>(null);
  const askLanding = useCallback((next: { id: string; turn: number } | null) => { landing.current = next; }, []);
  const takeLanding = useCallback((replayId: string | undefined): number | null => {
    const held = landing.current;
    if (!held || held.id !== replayId) return null;
    landing.current = null;
    return held.turn;
  }, []);
  return { askLanding, takeLanding };
}

export interface NewGameInputs {
  state: GameState;
  replay: { openGame(data: ReplayData, infos: { p1: OpponentTeamInfo; p2: OpponentTeamInfo }): Promise<unknown>; extendGame(data: ReplayData): Promise<void> };
  branch: {
    getHistory(): BranchHistoryEntry[];
    getLog(): { log: string[]; since: number };
    getStartTurn(): number | null;
    getStream(): BattleStream | null;
    rebaseAtTip(startTurn: number, startPosition: string | null): void;
  };
  storePosition(turn: number, serialized: string): void;
  landRef?: React.RefObject<((turn: number) => void) | null>;
  save?: (record: NewGameRecord) => boolean;
}

/** Start saves the record before the game opens (no entry played), so the address and the saved lists find a game still at Team
 *  Preview. A saved game that opens again saves nothing (its row keeps its place). */
function useStartGame(openRecord: (next: NewGameRecord) => Promise<void>, save: (record: NewGameRecord) => boolean, setSaveFailed: (failed: boolean) => void) {
  return useCallback(async (next: NewGameRecord) => {
    setSaveFailed(!save(next));
    await openRecord(next);
  }, [save, openRecord, setSaveFailed]);
}

interface PromoteInputs extends Pick<NewGameInputs, 'replay' | 'branch' | 'landRef'> {
  recordRef: React.RefObject<NewGameRecord | null>;
  setRecord: (next: NewGameRecord | null) => void;
  storePosition: NewGameInputs['storePosition'];
  save: (record: NewGameRecord) => boolean;
  setSaveFailed: (failed: boolean) => void;
}

function usePromote({ recordRef, setRecord, replay, branch, storePosition, landRef, save, setSaveFailed }: PromoteInputs) {
  /** Called after a finished turn and after a lead start: a turn that started at the game's tip and is finished (no replacement
   *  pending) joins the main line; a turn played from any other position stays a variation. */
  return useCallback(async (): Promise<boolean> => {
    const current = recordRef.current;
    const history = branch.getHistory();
    if (!current || history.length === 0) return false;
    const start = branch.getStartTurn();
    if (start === null || start !== gameTipTurn(current)) {
      // a variation of an earlier turn replaces the live branch: the tip turn that waited for its replacement is given up
      if (current.pending) {
        const cleared = withPendingTurn(current, []);
        recordRef.current = cleared;
        setRecord(cleared);
        setSaveFailed(!save(cleared));
      }
      return false;
    }
    if (replacementPending(branch.getStream())) {
      // the turn is played and waits for its replacement: it stays out of the main line, and the record keeps it for a reload
      const waiting = withPendingTurn(current, history);
      recordRef.current = waiting;
      setRecord(waiting);
      setSaveFailed(!save(waiting));
      return false;
    }
    const { log, since } = branch.getLog();
    const lines = current.entries.length === 0 ? bodyLines(log) : newLines(log, since);
    const next = appendTurn(current, { entries: history, lines });
    const tip = next.turns + 1;
    const positions = gamePositions(history);
    for (const [turn, serialized] of positions) storePosition(start + turn, serialized);
    recordRef.current = next;
    setRecord(next);
    await replay.extendGame(gameReplayData(next));
    branch.rebaseAtTip(tip, history[history.length - 1].serializedPosition ?? null);
    landRef?.current?.(tip);
    setSaveFailed(!save(next));
    return true;
  }, [recordRef, setRecord, replay, branch, storePosition, landRef, save, setSaveFailed]);
}

export function useNewGame(inputs: NewGameInputs) {
  const { state, replay, branch, storePosition, landRef, save = saveGame } = inputs;
  const { record, recordRef, setRecord } = state;
  const [saveFailed, setSaveFailed] = useState(false);
  const { askLanding, takeLanding } = useLanding();

  /** Opens a record (a fresh Start or a saved game) as the app's current game. A game asks the pointer for its tip, which the
   *  timeline controller hands over after the new id has reset the pointer (`takeLanding`); the same game opened again leaves it. */
  const openRecord = useCallback(async (next: NewGameRecord) => {
    askLanding(recordRef.current?.id !== next.id ? { id: next.id, turn: next.entries.length > 0 ? next.turns + 1 : 0 } : null);
    setRecord(next);
    await replay.openGame(gameReplayData(next), { p1: infoOfTeam(next.teams.p1), p2: infoOfTeam(next.teams.p2) });
  }, [replay, recordRef, setRecord, askLanding]);

  const startGame = useStartGame(openRecord, save, setSaveFailed);

  const promote = usePromote({ recordRef, setRecord, replay, branch, storePosition, landRef, save, setSaveFailed });

  /** Plays the record's entries again on other teams (a set edit) and says what the game would be: every entry that still applies
   *  stays, and the main line ends before the first one that does not, at a settled turn. It changes nothing: the caller asks first. */
  const planTeams = useCallback(async (teams: { p1: PokemonSet[]; p2: PokemonSet[] }): Promise<{ kept: number; error: string | null; next: NewGameRecord } | null> => {
    const current = recordRef.current;
    if (!current) return null;
    const branchEngine = await import('../lib/lazy/branch-engine');
    await branchEngine.loadSimMods(current.format);
    const start = await branchEngine.startGameLog({ format: current.format, p1Team: teams.p1, p2Team: teams.p2, playerNames: current.players, seed: current.seed });
    let entries = current.entries;
    let rebuilt = await rebuildGame(branchEngine, { ...current, teams: start.teams, header: start.header, entries });
    const failure = rebuilt?.failure ?? null;
    if (rebuilt && failure) {
      let kept = rebuilt.entries.length;
      while (kept > 1 && isInterlude(current.entries, kept)) kept -= 1;
      entries = current.entries.slice(0, kept);
      rebuilt = await rebuildGame(branchEngine, { ...current, teams: start.teams, header: start.header, entries });
    }
    const played = rebuilt?.entries ?? [];
    const next: NewGameRecord = {
      ...current, teams: start.teams, header: start.header, teamPreview: start.teamPreview, bringCount: start.bringCount,
      entries: played.map(withoutPosition), pending: undefined, body: rebuilt ? bodyLines(rebuilt.runtime.log) : [],
      turns: Math.max(0, turnEntryCount(played) - 1), updatedAt: new Date().toISOString(),
    };
    return { kept: next.turns, error: failure?.error ?? null, next };
  }, [recordRef]);

  /** Plays the record again on other teams and opens the result; the caller stops the live branch, its runtime stands on the old teams. */
  const editTeams = useCallback(async (teams: { p1: PokemonSet[]; p2: PokemonSet[] }): Promise<{ kept: number; error: string | null } | null> => {
    const plan = await planTeams(teams);
    if (!plan) return null;
    // the positions follow on the new sets: the store keys them by the sets' fingerprint, so the position source rebuilds them once from the record
    await openRecord(plan.next);
    setSaveFailed(!save(plan.next));
    return { kept: plan.kept, error: plan.error };
  }, [planTeams, openRecord, save]);

  return { record, openRecord, startGame, promote, planTeams, editTeams, saveFailed, takeLanding };
}

/** The game hook wired to the app's pieces: `afterTurnRef` is called after every entry and lead start; `landRef` is where the
 *  timeline puts the pointer after a promotion. */
export function useNewGameAt(args: {
  state: GameState;
  replay: NewGameInputs['replay'];
  branch: NewGameInputs['branch'];
  positions: { storeExactPosition(turn: number, serialized: string): void };
  afterTurnRef: React.RefObject<(() => Promise<void>) | null>;
}) {
  const { state, replay, branch, positions, afterTurnRef } = args;
  const landRef = useRef<((turn: number) => void) | null>(null);
  const newGame = useNewGame({
    state, replay, landRef, storePosition: positions.storeExactPosition,
    branch: {
      getHistory: branch.getHistory, getLog: branch.getLog, getStartTurn: branch.getStartTurn, getStream: branch.getStream,
      rebaseAtTip: branch.rebaseAtTip,
    },
  });
  const { promote } = newGame;
  useEffect(() => {
    afterTurnRef.current = async () => { await promote(); };
  }, [afterTurnRef, promote]);
  return { newGame, landRef };
}
