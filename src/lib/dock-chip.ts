import { toId } from '@fulllifegames/replay-core';
import type { BranchMoveModifier, BranchMoveOption, BranchSlotChoice } from '@fulllifegames/eval-engine';
import type { PlayedPick } from './played-pick';

/**
 * Round 84 (turn dock): what a slot's chip says. The pick line reads the choice ("Flare Blitz → P2B · Tera · dice"), the origin
 * says where an untouched choice came from, and an empty chip says why it is empty.
 */

export type ChipOrigin = 'played' | 'engine' | 'user';

const MODIFIER_WORD: Record<BranchMoveModifier, string> = {
  terastallize: 'Tera', mega: 'Mega', zmove: 'Z-Move', ultra: 'Ultra Burst',
};

/** The label of a move's target ("P2B"), the location itself when the move lists none for it. */
function targetWord(choice: Extract<BranchSlotChoice, { kind: 'move' }>, moves: BranchMoveOption[]): string {
  const move = moves.find(option => toId(option.name) === choice.moveId);
  return move?.targetOptions.find(option => option.targetLoc === choice.targetLoc)?.label ?? `${choice.targetLoc}`;
}

export function chipPickText(choice: BranchSlotChoice | null | undefined, moves: BranchMoveOption[]): string {
  if (!choice) return '';
  const dice = choice.dice?.length ? ' · dice' : '';
  if (choice.kind === 'switch') return `→ ${choice.pokemonName}${dice}`;
  const target = choice.targetLoc !== undefined ? ` → ${targetWord(choice, moves)}` : '';
  const modifier = choice.modifier ? ` · ${MODIFIER_WORD[choice.modifier]}` : '';
  return `${choice.moveName}${target}${modifier}${dice}`;
}

/**
 * Where a chip's choice came from. The merge hands an untouched slot the seed's own object, so identity tells a seeded choice
 * from the user's pick (even one that equals the seed). The engine's fill (A5) marks its own slots.
 */
export function chipOrigin(choice: BranchSlotChoice | null, seedChoice: BranchSlotChoice | null | undefined): ChipOrigin | null {
  return choice && seedChoice && choice === seedChoice ? 'played' : null;
}

/** The text of an empty chip. `hasRecord`: the position has a played record to seed from (a replay turn), so an empty slot is a slot nothing was logged for. */
export function chipPlaceholder({ forceSwitch, nobodyLeft, played, hasRecord }: {
  forceSwitch: boolean; nobodyLeft: boolean; played: Pick<PlayedPick, 'kind' | 'name'> | null; hasRecord: boolean;
}): string {
  if (nobodyLeft) return 'fainted · no one left';
  if (forceSwitch) return 'choose a replacement';
  if (played) return `played: ${played.kind === 'move' ? played.name : `→ ${played.name}`} · choose`;
  return hasRecord ? 'no logged move · choose' : 'choose';
}
