import { useCallback, useEffect, useRef, useState } from 'react';
import { Teams } from '@pkmn/sim';
import type { PokemonSet } from '@pkmn/sim';
import { parsePastedTeam, teamInfoOfSets, type OpponentTeamInfo, type ReplayData } from '@fulllifegames/replay-core';
import { appendTurn, gameReplayData, withoutPosition, type NewGameRecord } from '../lib/new-game/record';
import { isInterlude, turnEntryCount } from '../lib/variation-turns';
import { bodyLines, newLines } from '../lib/new-game/game-log';
import { saveGame } from '../lib/new-game/store';
import { gamePositions, rebuildGame } from './branch/game-rebuild';
import { forceSwitches } from './branch/shared';
import type { BranchHistoryEntry, BattleStream } from './branch/shared';

/**
 * Round 89 (lane H, #105): a new game in the hooks. The record is the truth; the replay data of the app is its log, and a turn the
 * user plays at the game's tip joins the main line ("promotion"): the record takes the turn's entries and lines, the exact store
 * the positions, the replay state the grown log, and the live branch rebases at the new tip with no entry of its own.
 */

/** The record as state and as a ref the async promotion reads (a render's copy is stale by then). */
export function useGameState() {
  const [record, setState] = useState<NewGameRecord | null>(null);
  const recordRef = useRef<NewGameRecord | null>(null);
  const setRecord = useCallback((next: NewGameRecord | null) => {
    recordRef.current = next;
    setState(next);
  }, []);
  return { record, recordRef, setRecord };
}

export type GameState = ReturnType<typeof useGameState>;

/** The stats panel's team info of a record's team: every set as typed, the user's own knowledge on both sides. */
export function infoOfTeam(team: PokemonSet[]): OpponentTeamInfo {
  return teamInfoOfSets(parsePastedTeam(Teams.export(team)));
}

/** The pointer turn the main line's next turn is played from: turn 0 before the lead pick, else the turn after the finished ones. */
export const gameTipTurn = (record: NewGameRecord): number => (record.entries.length === 0 ? 0 : record.turns + 1);

/** Whether a side of the live battle still waits for a replacement: the turn is not finished then. */
function replacementPending(stream: BattleStream | null): boolean {
  const battle = stream?.battle;
  if (!battle) return false;
  return (['p1', 'p2'] as const).some(side => forceSwitches(battle, side).some(Boolean));
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
  /** Where the pointer lands after a promotion (the timeline's); optional. */
  landRef?: React.RefObject<((turn: number) => void) | null>;
  save?: (record: NewGameRecord) => boolean;
}

export function useNewGame(inputs: NewGameInputs) {
  const { state, replay, branch, storePosition, landRef, save = saveGame } = inputs;
  const { record, recordRef, setRecord } = state;
  const [saveFailed, setSaveFailed] = useState(false);

  /** Opens a record (a fresh Start or a saved game) as the app's current game. */
  const openRecord = useCallback(async (next: NewGameRecord) => {
    setRecord(next);
    await replay.openGame(gameReplayData(next), { p1: infoOfTeam(next.teams.p1), p2: infoOfTeam(next.teams.p2) });
  }, [replay, setRecord]);

  /**
   * Called after a finished turn and after a lead start. A turn that started at the game's tip and is finished (no replacement
   * pending) joins the main line; a turn played from any other position stays a variation.
   */
  const promote = useCallback(async (): Promise<boolean> => {
    const current = recordRef.current;
    const history = branch.getHistory();
    if (!current || history.length === 0) return false;
    const start = branch.getStartTurn();
    if (start === null || start !== gameTipTurn(current)) return false;
    if (replacementPending(branch.getStream())) return false;
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
  }, [recordRef, setRecord, replay, branch, storePosition, landRef, save]);

  /**
   * Plays the record's entries again on other teams (a set edit): the header and the teams follow the edit, every entry that still
   * applies stays, and the main line ends before the first one that does not (a removed move), at a settled turn. The caller
   * stops the live branch; its runtime stands on the old teams.
   */
  const editTeams = useCallback(async (teams: { p1: PokemonSet[]; p2: PokemonSet[] }): Promise<{ kept: number; error: string | null } | null> => {
    const current = recordRef.current;
    if (!current) return null;
    const branchEngine = await import('../lib/lazy/branch-engine');
    await branchEngine.loadSimMods(current.format);
    const start = await branchEngine.startGameLog({ format: current.format, p1Team: teams.p1, p2Team: teams.p2, playerNames: current.players, seed: current.seed });
    let entries = current.entries;
    let rebuilt = await rebuildGame(branchEngine, { ...current, teams: start.teams, header: start.header, entries });
    const failure = rebuilt?.failure ?? null;
    if (rebuilt && failure) {
      // an entry that no longer applies ends the line; a turn left without its replacement ends one entry earlier
      let kept = rebuilt.entries.length;
      while (kept > 1 && isInterlude(current.entries, kept)) kept -= 1;
      entries = current.entries.slice(0, kept);
      rebuilt = await rebuildGame(branchEngine, { ...current, teams: start.teams, header: start.header, entries });
    }
    const error = failure?.error ?? null;
    const played = rebuilt?.entries ?? [];
    const next: NewGameRecord = {
      ...current, teams: start.teams, header: start.header, teamPreview: start.teamPreview, bringCount: start.bringCount,
      entries: played.map(withoutPosition), body: rebuilt ? bodyLines(rebuilt.runtime.log) : [],
      turns: Math.max(0, turnEntryCount(played) - 1), updatedAt: new Date().toISOString(),
    };
    // the positions follow on the new sets: the store keys them by the sets' fingerprint, so the position source rebuilds them once from the record
    await openRecord(next);
    setSaveFailed(!save(next));
    return { kept: next.turns, error };
  }, [recordRef, openRecord, save]);

  return { record, openRecord, promote, editTeams, saveFailed };
}

/**
 * The game hook wired to the app's pieces: the replay state, the branch, and the position source's exact store. The branch calls
 * `afterTurnRef` after every entry and every lead start; `landRef` is where the timeline puts the pointer after a promotion.
 */
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
