import type { PokemonSet } from '@pkmn/sim';
import type { DamageObservation, OpponentTeamInfo, ReplayData } from '@fulllifegames/replay-core';
import type { BranchHistoryEntry } from './branch-history';
import { buildReplayTeams, type TeamBuildSources } from './eval-acquire';
import { entriesOfTurns } from './variation-turns';

export interface BranchInputs {
  p1Team: PokemonSet[];
  p2Team: PokemonSet[];
  choiceLocks: Awaited<ReturnType<typeof import('./lazy/choice-lock')['buildChoiceLockContext']>>;
}

/** Team build plus choice locks for a branch start — the shared prelude of
 *  the deviation rebuild and the team-edit refresh. Null when the teams
 *  could not be built (the caller skips silently, as before). */
export async function prepareBranchInputs(
  replayData: ReplayData,
  sources: TeamBuildSources,
  observations: DamageObservation[],
  overrides?: { p1: OpponentTeamInfo | null; p2: OpponentTeamInfo | null },
): Promise<BranchInputs | null> {
  const { p1Team, p2Team } = await buildReplayTeams(replayData, sources, overrides);
  if (p1Team.length === 0 || p2Team.length === 0) return null;
  const { buildChoiceLockContext } = await import('./lazy/choice-lock');
  return {
    p1Team,
    p2Team,
    choiceLocks: buildChoiceLockContext(replayData.log, { p1Team, p2Team }, observations),
  };
}

/** The honest divergence notice after a branch arrival (or null). */
export function divergenceNoticeFor(
  battle: { ended?: boolean; winner?: string | null; turn: number } | null | undefined,
  startTurn: number,
): string | null {
  if (battle?.ended) {
    return 'The simulated replay diverged from the real game and already ended' +
      `${battle.winner ? ` (${battle.winner} won the simulated line)` : ''}: ` +
      'the guessed sets could not reproduce this position. Recommendations cannot be played out here; ' +
      'correcting items/moves via Edit Player/Opp is the common fix.';
  }
  if (battle && battle.turn < startTurn) {
    return `The simulated replay wedged at turn ${battle.turn} on the way to ` +
      `turn ${startTurn}: the guessed sets diverge from the real game before this position.`;
  }
  return null;
}

/** Kept entries for a truncating rebuild: interludes (a replacement on one side or on both) ride along with
 *  the turn they resolve — keep them until the NEXT turn entry past the cut
 *  (mirrors alignHistoryRows; round 88, T348: one rule in `variation-turns.ts`). */
export function keptHistorySlice(history: BranchHistoryEntry[], keepTurns: number): BranchHistoryEntry[] {
  return entriesOfTurns(history, keepTurns);
}
