import type { BranchMoveOption, BranchSwitchOption } from '../../hooks/useBranch';
import type { BranchSlotModifiers } from '../../lib/branch-engine';
import type { BranchMoveModifier } from '../../lib/branch-choices';
import type { BranchSlotChoice } from '../../lib/branch-choices';
import { toId } from '@fulllifegames/replay-core';

/** What turning a button click into a choice needs: the active gimmick and the side's options. */
export interface ChoiceContext {
  modifier: BranchMoveModifier | null;
  modifierAvailable: boolean;
  moves: BranchMoveOption[];
  modifiers: BranchSlotModifiers;
}

function withModifier(choice: BranchSlotChoice, ctx: ChoiceContext): BranchSlotChoice {
  const { modifier, modifierAvailable, moves, modifiers } = ctx;
  if (choice.kind !== 'move' || !modifier || !modifierAvailable) return choice;
  // A Z toggle only applies to moves that actually have a Z option.
  if (modifier === 'zmove') {
    const moveIndex = moves.findIndex(candidate => toId(candidate.name) === choice.moveId);
    if (moveIndex < 0 || !modifiers.zMoves[moveIndex]) return choice;
  }
  return { ...choice, modifier };
}

export function moveChoiceFor(move: BranchMoveOption, targetLoc: number | undefined, ctx: ChoiceContext): BranchSlotChoice {
  return withModifier({
    kind: 'move',
    moveId: toId(move.name),
    moveName: move.name,
    ...(targetLoc !== undefined ? { targetLoc } : {}),
  }, ctx);
}

/** The free-choice dropdown's value ("move:slot[:target]" / "switch:slot") as a choice, or null. */
export function pickedChoice(value: string, switches: BranchSwitchOption[], ctx: ChoiceContext): BranchSlotChoice | null {
  const [kind, slotText, targetText] = value.split(':');
  const slot = parseInt(slotText, 10);
  if (kind === 'move') {
    const move = ctx.moves.find(candidate => candidate.slot === slot);
    if (!move) return null;
    const targetLoc = targetText !== undefined ? parseInt(targetText, 10) : undefined;
    return moveChoiceFor(move, targetLoc, ctx);
  }
  if (kind === 'switch') {
    const target = switches.find(candidate => candidate.slot === slot);
    if (!target) return null;
    return { kind: 'switch', speciesId: toId(target.species), pokemonName: target.name };
  }
  return null;
}
