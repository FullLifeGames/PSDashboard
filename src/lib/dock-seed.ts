import { toId } from '@fulllifegames/replay-core';
import {
  switchChoiceKey, switchOptionKey,
  type BranchMoveModifier, type BranchMoveOption, type BranchSimState, type BranchSlotChoice, type BranchSlotModifiers,
} from '@fulllifegames/eval-engine';
import type { PlayedAtPosition, PlayedPick } from './played-pick';

/** The seed of the dock: each slot starts with the choice the viewed line played, derived and never stored, so Execute without a change plays the logged turn. */

type Side = 'p1' | 'p2';

/** The parts of a position the seed reads; the force flags are optional so a bare picker state works. */
export type SeedState = Pick<BranchSimState,
  'p1MovesBySlot' | 'p2MovesBySlot' | 'p1SwitchesBySlot' | 'p2SwitchesBySlot' | 'p1ModifiersBySlot' | 'p2ModifiersBySlot'>
  & Partial<Pick<BranchSimState, 'p1ForceSwitch' | 'p2ForceSwitch'>>;

type OfferedState = Pick<BranchSimState, 'p1MovesBySlot' | 'p2MovesBySlot' | 'p1SwitchesBySlot' | 'p2SwitchesBySlot'>;

export interface SeedSlot {
  /** The choice the slot starts with; null when nothing was played or the picker does not offer what was. */
  choice: BranchSlotChoice | null;
  /** What the viewed line played, kept also when the picker lacks it. */
  played: PlayedPick | null;
}

export type SeedChoices = Record<Side, SeedSlot[]>;
export type SideChoices = Record<Side, (BranchSlotChoice | null)[]>;

export function gimmickApplies(kind: BranchMoveModifier, modifiers: BranchSlotModifiers | undefined): boolean {
  if (!modifiers) return false;
  if (kind === 'terastallize') return !!modifiers.teraType;
  if (kind === 'mega') return modifiers.canMegaEvo;
  if (kind === 'ultra') return modifiers.canUltraBurst;
  return modifiers.zMoves.some(Boolean);
}

export function stillOffered(choice: BranchSlotChoice, state: OfferedState, side: Side, slot: number): boolean {
  if (choice.kind === 'move') {
    const moves = (side === 'p1' ? state.p1MovesBySlot : state.p2MovesBySlot)?.[slot] ?? [];
    return moves.some(option => toId(option.name) === choice.moveId && !option.disabled);
  }
  const switches = (side === 'p1' ? state.p1SwitchesBySlot : state.p2SwitchesBySlot)?.[slot] ?? [];
  const wanted = switchChoiceKey(choice);
  return switches.some(option => !option.fainted && switchOptionKey(option) === wanted);
}

const EMPTY_SLOT: SeedSlot = { choice: null, played: null };

function playedSlots(played: PlayedAtPosition, side: Side): (PlayedPick | null)[] {
  const slots = side === 'p1' ? played.p1Slots : played.p2Slots;
  return slots ?? [side === 'p1' ? played.p1 : played.p2];
}

function seededModifier(
  wanted: BranchMoveModifier | undefined, modifiers: BranchSlotModifiers | undefined, moves: BranchMoveOption[], option: BranchMoveOption,
): BranchMoveModifier | undefined {
  if (!wanted || !gimmickApplies(wanted, modifiers)) return undefined;
  if (wanted === 'zmove' && !modifiers?.zMoves[moves.indexOf(option)]) return undefined;
  return wanted;
}

/** The target a played move keeps: the one the move lists. A spread move lists none, so the log's first name for it never counts. */
function seededTarget(wanted: number | null | undefined, option: BranchMoveOption): number | undefined {
  return typeof wanted === 'number' && option.targetOptions.some(target => target.targetLoc === wanted) ? wanted : undefined;
}

function seedMove(pick: PlayedPick, state: SeedState, side: Side, slot: number): BranchSlotChoice | null {
  const moves = (side === 'p1' ? state.p1MovesBySlot : state.p2MovesBySlot)?.[slot] ?? [];
  const option = moves.find(candidate => toId(candidate.name) === toId(pick.name));
  if (!option || option.disabled) return null;
  // A recorded choice (behind the tip) is the source for target, gimmick and dice; else the log's pick.
  const source = pick.recorded?.kind === 'move' ? pick.recorded : pick;
  const targetLoc = seededTarget(source.targetLoc, option);
  const modifiers = (side === 'p1' ? state.p1ModifiersBySlot : state.p2ModifiersBySlot)?.[slot];
  const modifier = seededModifier(source.modifier, modifiers, moves, option);
  const dice = pick.recorded?.dice;
  return {
    kind: 'move', moveId: toId(option.name), moveName: option.name,
    ...(targetLoc !== undefined ? { targetLoc } : {}),
    ...(modifier ? { modifier } : {}),
    ...(dice ? { dice } : {}),
  };
}

function seedSwitch(pick: PlayedPick, state: SeedState, side: Side, slot: number): BranchSlotChoice | null {
  const switches = (side === 'p1' ? state.p1SwitchesBySlot : state.p2SwitchesBySlot)?.[slot] ?? [];
  const key = toId(pick.species || pick.name);
  const option = switches.find(candidate => toId(candidate.species) === key || toId(candidate.name) === key);
  if (!option) return null;
  const dice = pick.recorded?.kind === 'switch' ? pick.recorded.dice : undefined;
  return { kind: 'switch', speciesId: toId(option.species), pokemonName: option.name, ...(dice ? { dice } : {}) };
}

function seedSlot(pick: PlayedPick | null, state: SeedState, side: Side, slot: number): SeedSlot {
  if (!pick) return EMPTY_SLOT;
  const choice = pick.kind === 'move' ? seedMove(pick, state, side, slot) : seedSwitch(pick, state, side, slot);
  return { choice: choice && stillOffered(choice, state, side, slot) ? choice : null, played: pick };
}

function seedSide(played: PlayedAtPosition, state: SeedState, side: Side): SeedSlot[] {
  // A side with a forced replacement is the user's pick, and the played record belongs to the turn before it.
  const forced = side === 'p1' ? state.p1ForceSwitch : state.p2ForceSwitch;
  return playedSlots(played, side).map((pick, slot) => (forced ? { choice: null, played: pick } : seedSlot(pick, state, side, slot)));
}

/**
 * Per side and slot the choice the viewed line played, validated against the position's pickers; `played` null (the tip, an
 * unreadable turn) seeds nothing.
 */
export function seedChoices(played: PlayedAtPosition | null, state: SeedState): SeedChoices {
  if (!played) return { p1: [], p2: [] };
  return { p1: seedSide(played, state, 'p1'), p2: seedSide(played, state, 'p2') };
}

/**
 * The effective choices: a slot the user touched keeps the draft entry, an untouched slot the seed. Returns the draft itself when
 * the seed holds no choice, so a memo keyed on the draft settles.
 */
export function mergeChoices(seed: SeedChoices, draft: SideChoices): SideChoices {
  if (![...seed.p1, ...seed.p2].some(slot => slot.choice)) return draft;
  const side = (key: Side): (BranchSlotChoice | null)[] => {
    const length = Math.max(seed[key].length, draft[key].length);
    return Array.from({ length }, (_, slot) => draft[key][slot] ?? seed[key][slot]?.choice ?? null);
  };
  return { p1: side('p1'), p2: side('p2') };
}
