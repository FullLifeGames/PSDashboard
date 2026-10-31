import type { BranchMoveOption, DamageResult, DieName } from '@fulllifegames/eval-engine';
import { toId } from '@fulllifegames/replay-core';
import type { SpreadTargetDamage } from './branch-damage';

/**
 * Round 82 (forced dice), step A7a: the damage of each step of the roll for one die of the panel. The preview computes it for the
 * move a slot has chosen (`DamageResult.rolls`); this reads the entry the die's target belongs to: the target's own result when the
 * move aims at one (doubles), the spread entry of that target for a move that hits both foes, the move's default result otherwise.
 */

export type StepDamage = NonNullable<DamageResult['rolls']>;

export interface RollSources {
  moves: BranchMoveOption[];
  dmgResults: DamageResult[];
  spreadDamageResults: Record<number, SpreadTargetDamage[]>;
  targetDamageResults: Record<string, DamageResult | undefined>;
}

const SIDES = { '1': 'p1', '2': 'p2' } as const;

export function rollsFor(name: DieName, sources: RollSources): StepDamage | undefined {
  const index = sources.moves.findIndex(move => toId(move.name) === name.moveId);
  const move = sources.moves[index];
  if (!move || !name.targetSlot) return undefined;
  const side = SIDES[name.targetSlot[1] as '1' | '2'];
  const activeSlot = name.targetSlot[2] === 'a' ? 0 : 1;
  if (move.targetOptions.length > 0) {
    const aimed = move.targetOptions.find(target => target.side === side && target.activeSlot === activeSlot);
    return aimed ? sources.targetDamageResults[`${move.slot}:${aimed.targetLoc}`]?.rolls : undefined;
  }
  const label = `${side.toUpperCase()}${String.fromCharCode(65 + activeSlot)}`;
  const spread = sources.spreadDamageResults[move.slot]?.find(target => target.label === label);
  return spread ? spread.result.rolls : sources.dmgResults[index]?.rolls;
}
