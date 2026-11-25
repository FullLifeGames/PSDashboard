import { toId } from '@fulllifegames/replay-core';
import type { BranchMoveModifier, BranchMoveOption, BranchSlotChoice, BranchSwitchOption } from '@fulllifegames/eval-engine';
import { shownType } from './move-damage-text';
import type { PlayedPick } from './played-pick';


export type ChipOrigin = 'played' | 'engine' | 'user';

const MODIFIER_WORD: Record<BranchMoveModifier, string> = {
  terastallize: 'Tera', mega: 'Mega', zmove: 'Z-Move', ultra: 'Ultra Burst',
};

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

/** The merge hands an untouched slot the seed's own object, so identity tells a seeded choice from a pick. */
export function chipOrigin(choice: BranchSlotChoice | null, seedChoice: BranchSlotChoice | null | undefined, engine = false): ChipOrigin | null {
  if (!choice) return null;
  if (engine) return 'engine';
  return seedChoice && choice === seedChoice ? 'played' : null;
}

/** What the engine is doing about an empty slot: filling it, or kept off by the game analysis. */
export type EngineWait = 'pending' | 'busy';

/** The text of an empty chip; `hasRecord`: the position has a played record (a replay turn) to seed from. */
export function chipPlaceholder({ forceSwitch, nobodyLeft, partnerSwitching, played, hasRecord, engine, deferred, commanding }: {
  forceSwitch: boolean; nobodyLeft: boolean; played: Pick<PlayedPick, 'kind' | 'name'> | null; hasRecord: boolean; engine?: EngineWait | null;
  /** The engine's pick for this slot, held back while its tray is open. */
  deferred?: Pick<PlayedPick, 'kind' | 'name'> | null;
  /** A Tatsugiri inside its Dondozo: the game asks the slot nothing this turn. */
  commanding?: boolean;
  /** Another slot of the side must switch (pivot move, Parting Shot): the fainted slot's replacement follows. */
  partnerSwitching?: boolean;
}): string {
  if (nobodyLeft) return partnerSwitching ? 'fainted · waits for the switch' : 'fainted · no one left';
  if (commanding) return 'commanding · no choice';
  if (deferred) return `engine: ${deferred.kind === 'move' ? deferred.name : `→ ${deferred.name}`} · choose`;
  if (engine === 'pending') return 'engine choosing…';
  if (forceSwitch) return 'choose a replacement';
  if (engine === 'busy') return 'engine busy with the game analysis';
  if (played) return `played: ${played.kind === 'move' ? played.name : `→ ${played.name}`} · choose`;
  return hasRecord ? 'no logged move · choose' : 'choose';
}

export type ChipAside = { kind: 'type'; type: string } | { kind: 'sprite'; species: string };

/** A move shows the type its tile shows (`shownType`: Tera counts while toggled); a switch, the bench body. */
export function chipAside(
  choice: BranchSlotChoice | null | undefined, moves: BranchMoveOption[], switches: Pick<BranchSwitchOption, 'species'>[], teraArmed: boolean,
): ChipAside | null {
  if (choice?.kind === 'switch') {
    return { kind: 'sprite', species: switches.find(sw => toId(sw.species) === choice.speciesId)?.species ?? choice.pokemonName };
  }
  const move = choice?.kind === 'move' ? moves.find(option => toId(option.name) === choice.moveId) : undefined;
  return move ? { kind: 'type', type: shownType(move, teraArmed) } : null;
}
