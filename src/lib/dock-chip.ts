import { toId } from '@fulllifegames/replay-core';
import type { BranchMoveModifier, BranchMoveOption, BranchSlotChoice, BranchSwitchOption } from '@fulllifegames/eval-engine';
import { shownType } from './move-damage-text';
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
 * from the user's pick (even one that equals the seed). The engine's fill marks the slots it wrote (`engine`), which wins: at the
 * live tip no seed stands, and a slot the engine filled was empty.
 */
export function chipOrigin(choice: BranchSlotChoice | null, seedChoice: BranchSlotChoice | null | undefined, engine = false): ChipOrigin | null {
  if (!choice) return null;
  if (engine) return 'engine';
  return seedChoice && choice === seedChoice ? 'played' : null;
}

/** What the engine is doing about an empty slot: filling it, or kept off by the game analysis. */
export type EngineWait = 'pending' | 'busy';

/** The text of an empty chip. `hasRecord`: the position has a played record to seed from (a replay turn), so an empty slot is a slot nothing was logged for. */
export function chipPlaceholder({ forceSwitch, nobodyLeft, played, hasRecord, engine, deferred, commanding }: {
  forceSwitch: boolean; nobodyLeft: boolean; played: Pick<PlayedPick, 'kind' | 'name'> | null; hasRecord: boolean; engine?: EngineWait | null;
  /** Round 84 (A7a): the engine's pick for this slot, held back while its tray is open. */
  deferred?: Pick<PlayedPick, 'kind' | 'name'> | null;
  /** Round 85 (T320): a Tatsugiri inside its Dondozo; the game asks the slot nothing this turn. */
  commanding?: boolean;
}): string {
  if (nobodyLeft) return 'fainted · no one left';
  if (commanding) return 'commanding · no choice';
  if (deferred) return `engine: ${deferred.kind === 'move' ? deferred.name : `→ ${deferred.name}`} · choose`;
  // A forced replacement is filled like any slot; while the analysis blocks the engine the user has to choose.
  if (engine === 'pending') return 'engine choosing…';
  if (forceSwitch) return 'choose a replacement';
  if (engine === 'busy') return 'engine busy with the game analysis';
  if (played) return `played: ${played.kind === 'move' ? played.name : `→ ${played.name}`} · choose`;
  return hasRecord ? 'no logged move · choose' : 'choose';
}

/** What stands at the right of a chip (round 84, A7b): the type of the move it holds, or the species that comes in. */
export type ChipAside = { kind: 'type'; type: string } | { kind: 'sprite'; species: string };

/**
 * The aside of a chip. A move shows the type its tile shows (`shownType`: the Tera type counts while the slot's Tera toggle is
 * pressed); a switch shows the body from the bench list, else the name the choice carries; no choice or a move the slot does not
 * list shows nothing.
 */
export function chipAside(
  choice: BranchSlotChoice | null | undefined, moves: BranchMoveOption[], switches: Pick<BranchSwitchOption, 'species'>[], teraArmed: boolean,
): ChipAside | null {
  if (choice?.kind === 'switch') {
    return { kind: 'sprite', species: switches.find(sw => toId(sw.species) === choice.speciesId)?.species ?? choice.pokemonName };
  }
  const move = choice?.kind === 'move' ? moves.find(option => toId(option.name) === choice.moveId) : undefined;
  return move ? { kind: 'type', type: shownType(move, teraArmed) } : null;
}
