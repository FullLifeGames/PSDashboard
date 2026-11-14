import { State, type Battle } from '@pkmn/sim';
import { expect } from 'vitest';
import { createBranchStateFromBattle } from '../src/branch/state';
import { resolveSideChoices } from '../src/branch/execute';
import { requiredChoicesForActiveSlots } from '../src/branch-choices';
import type { EvalLine } from '../src/types';
import type { WinPathsRequest } from '../src/endgame/win-paths/types';
import { branchOf, mon, runTurn, type Commands } from './branch-dice-support';
import { set } from './move-oracle';

/**
 * Round 89 (#130): boards of the win-path specs. A board is a fresh game of a custom format whose bodies the spec sets
 * (`prepare`), serialized as the app serializes a live battle; `play` replays a line on a fresh branch of the same board the way the
 * app plays a variation (each step's slot choices resolved on the rebuilt battle, the dice forced from the slot choices).
 */
export interface Board {
  format: string;
  p1: ReturnType<typeof set>[];
  p2: ReturnType<typeof set>[];
  prepare?: (battle: Battle) => void;
}

export { mon };

type Runtime = Awaited<ReturnType<typeof branchOf>>;

export async function serializedBoard(board: Board, seed = '1,2,3,4'): Promise<{ runtime: Runtime; serialized: string }> {
  const runtime = await branchOf(board.format, board.p1, board.p2, seed);
  board.prepare?.(runtime.battleStream.battle!);
  return { runtime, serialized: JSON.stringify(State.serializeBattle(runtime.battleStream.battle!)) };
}

/** A line played as a variation on a fresh branch of the board; the branch's battle after its last step. */
export async function playLine(board: Board, line: EvalLine, seed: string): Promise<Battle> {
  const runtime = await branchOf(board.format, board.p1, board.p2, seed);
  board.prepare?.(runtime.battleStream.battle!);
  return playLineOn(runtime, line);
}

/** A line played on a branch the caller built (a corpus scene's reconstruction); the branch's battle after its last step. */
export async function playLineOn(runtime: Runtime, line: EvalLine): Promise<Battle> {
  for (const step of line.steps) {
    const battle = runtime.battleStream.battle!;
    const state = createBranchStateFromBattle(battle, [], {});
    const commands: Commands = [];
    for (const side of ['p1', 'p2'] as const) {
      const choice = side === 'p1' ? step.p1 : step.p2;
      if (choice.choice === 'wait') continue;
      const required = requiredChoicesForActiveSlots(side === 'p1' ? state.p1ActiveSlots : state.p2ActiveSlots, side === 'p1' ? state.p1ForceSwitches : state.p2ForceSwitches);
      const resolved = resolveSideChoices(battle, side, choice.slots, required);
      expect(resolved.ok, `${side} ${choice.label} resolves${resolved.ok ? '' : ` (${resolved.error})`}`).toBe(true);
      if (!resolved.ok) return battle;
      commands.push({ side, command: resolved.command });
    }
    const played = await runTurn(runtime, commands, { p1: step.p1.slots, p2: step.p2.slots });
    expect(played.ok, `the turn plays${played.ok ? '' : ` (${played.error})`}`).toBe(true);
  }
  return runtime.battleStream.battle!;
}

export const won = (battle: Battle, side: 'p1' | 'p2'): boolean => battle.ended && battle.winner === battle.sides[side === 'p1' ? 0 : 1].name;

export const REQUEST = (side: 'p1' | 'p2', extra: Partial<WinPathsRequest> = {}): WinPathsRequest => ({ side, tera: false, ...extra });
