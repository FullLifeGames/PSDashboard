import type { Battle } from '@pkmn/sim';
import { sideIndex } from '@fulllifegames/replay-core';
import { planCellEvents, type CellEvent } from '../cell-blend.ts';
import type { MatchupCache } from '../eval-function.ts';
import { positionBattle, type ChoiceOption } from '../forward-model.ts';
import { boundaryEvent } from '../ko-odds.ts';
import { leafValue } from '../search/leaf.ts';
import type { ForcedWinCaveat, ForcedWinOpen, ForcedWinProof } from '../types.ts';
import type { EndgameChildren } from './children.ts';

/**
 * The forced-win prover's candidate order and its open-branch fields
 * (moved out of prover.ts in round 67): the root tries the ranking's order,
 * inner nodes the kill odds, and a proof names the binding reply's open
 * children for the bar and the sentence.
 */

export type Side = 'p1' | 'p2';
export interface Proven { mass: number; turns: number; caveat: ForcedWinCaveat }
export interface Cell extends EndgameChildren { reply: ChoiceOption; p1Choice: string; p2Choice: string }
export interface CellProof { cell: Cell; proofs: Proven[]; proven: Proven }

export const other = (side: Side): Side => (side === 'p1' ? 'p2' : 'p1');

/** The move id of a choice's first move part, or null for switches and passes. */
export function firstMoveId(choice: string): string | null {
  for (const part of choice.split(',')) {
    const tokens = part.trim().split(' ');
    if (tokens[0] === 'move' && tokens[1]) return tokens[1];
  }
  return null;
}

/** Root: the ranking's order, unnamed options after it. */
export function orderByRanking(options: ChoiceOption[], rootOrder: string[]): ChoiceOption[] {
  const rank = new Map(rootOrder.map((choice, index) => [choice, index]));
  return [...options].sort((a, b) => (rank.get(a.choice) ?? rootOrder.length) - (rank.get(b.choice) ?? rootOrder.length));
}

/** Inner nodes: kill odds first (certain kills top), then damaging moves by base power, status, switches. */
export function orderByOdds(battle: Battle, side: Side, options: ChoiceOption[]): ChoiceOption[] {
  const attacker = battle.sides[sideIndex(side)].active[0];
  const defender = battle.sides[sideIndex(other(side))].active[0];
  const score = (option: ChoiceOption): number => {
    const id = firstMoveId(option.choice);
    if (!id) return 0;
    const move = battle.dex.moves.get(id);
    const event = attacker && defender && !attacker.fainted && !defender.fainted ? boundaryEvent(battle, attacker, defender, id) : null;
    if (event) return 3 + event.pKill;
    return move.exists && move.basePower > 0 ? 2 + move.basePower / 1000 : 1;
  };
  return options.map(option => ({ option, score: score(option) })).sort((a, b) => b.score - a.score).map(entry => entry.option);
}

/** The own side's open class of a cell, read from the child's group key against the cell's event plan. */
function openOf(root: Battle, cell: Cell, key: string | undefined, side: Side): ForcedWinOpen | undefined {
  const plan = planCellEvents(root, cell.p1Choice, cell.p2Choice);
  if (plan.kind !== 'events' || !key) return undefined;
  const outcomes = key.split(':')[1]?.split('|') ?? [];
  return plan.events.map((event: CellEvent, index: number) => ({ event, outcome: outcomes[index] }))
    .filter(({ event }) => event.side === side)
    .map(({ event, outcome }): ForcedWinOpen | undefined => {
      const label = root.dex.moves.get(event.moveId).name;
      if (outcome === 'miss') return { side, moveId: event.moveId, label, odds: event.event.accuracy, kind: 'hit' };
      if (outcome === 'hit-nokill') return { side, moveId: event.moveId, label, odds: event.event.killFraction, kind: 'kill' };
      return undefined;
    })
    .find(open => open !== undefined);
}

/** The binding reply (the cell with the least mass) and its open children, valued for the bar and the sentence. */
export function openFields(root: Battle, side: Side, cells: CellProof[], cache: MatchupCache): Pick<ForcedWinProof, 'open' | 'openValue'> {
  if (cells.length === 0) return { openValue: null };
  const binding = cells.reduce((worst, proof) => (proof.proven.mass < worst.proven.mass ? proof : worst), cells[0]);
  let weight = 0;
  let sum = 0;
  let heaviest: { weight: number; key?: string } = { weight: 0 };
  binding.cell.children.forEach((child, index) => {
    const openShare = child.share * (1 - (binding.proofs[index]?.mass ?? 0));
    if (openShare <= 0) return;
    weight += openShare;
    sum += openShare * leafValue(positionBattle(child.position), cache);
    if (openShare > heaviest.weight) heaviest = { weight: openShare, key: child.key };
  });
  if (weight === 0) return { openValue: null };
  const open = openOf(root, binding.cell, heaviest.key, side);
  return { ...(open ? { open } : {}), openValue: sum / weight };
}
