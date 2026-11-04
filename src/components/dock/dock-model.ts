import type {
  BranchMoveOption, BranchSimState, BranchSlotChoice, BranchSlotModifiers, BranchSwitchOption, DamageResult, SimPokemonInfo,
} from '@fulllifegames/eval-engine';
import type { SideDamage, SpreadTargetDamage } from '../../lib/branch-damage';
import type { Gimmick } from '../../hooks/useSideControlsState';
import type { PlayedAtPosition, PlayedPick } from '../../lib/played-pick';
import type { SeedChoices, SideChoices } from '../../lib/dock-seed';
import { withDeferred } from '../../lib/dock-fill';
import type { DockFillView } from '../../hooks/useDockFill';
import { chipOrigin, chipPickText, chipPlaceholder, type ChipOrigin, type EngineWait } from '../../lib/dock-chip';
import {
  EMPTY_MODIFIERS, EMPTY_MOVES, EMPTY_SWITCHES, blockedSwitchKeys, panelFlags, playedOfSlot, slotIdentity,
} from '../../lib/dock-panel';

/**
 * Round 84 (turn dock): everything the chip and the tray of one slot read, built once per render from the picker state, the
 * damage preview, the gimmick toggles, the played record and the seed.
 */

export type Side = 'p1' | 'p2';

export interface DockSlotModel {
  side: Side;
  slot: number;
  /** "P1A" in doubles, "P1" in singles. */
  label: string;
  name: string;
  species: string;
  hpPercent: number;
  fainted: boolean;
  moves: BranchMoveOption[];
  switches: BranchSwitchOption[];
  forceSwitch: boolean;
  /** The slot has no choice to make: a fainted body nobody replaces. */
  nobodyLeft: boolean;
  /** The other side replaces a body and this side has nothing to choose until it has (round 77, B5). */
  waits: boolean;
  pending: BranchSlotChoice | null;
  blockedSwitchKeys: Set<string>;
  modifiers: BranchSlotModifiers;
  gimmick: Gimmick;
  dmg: DamageResult[];
  spread: Record<number, SpreadTargetDamage[]>;
  targets: Record<string, DamageResult | undefined>;
  /** What the viewed line played here; null when it did not act or no line is read. */
  played: PlayedPick | null;
  /** The chip's pick line, empty for an empty slot. */
  pickText: string;
  /** The text of an empty chip. */
  placeholder: string;
  /** What the engine does about this empty chip: the placeholder's style reads it (a shimmer while the run is pending). */
  wait: EngineWait | null;
  origin: ChipOrigin | null;
  /** Round 84 (A7a): the engine's pick for this slot while its tray is open; the chip and the tile name it, the slot takes it on close. */
  deferred: BranchSlotChoice | null;
  /** The HP of the one living foe, for a move that names no target. */
  foeHp: number | undefined;
}

export interface DockModel {
  p1: DockSlotModel[];
  p2: DockSlotModel[];
  /** The HP of every body on the field by slot label. */
  hpByLabel: Record<string, number>;
  flags: ReturnType<typeof panelFlags>;
  /** What Execute sends: the effective choices, the engine's deferred picks counted in. */
  sendChoices: SideChoices;
}

type SlotViews = {
  p1ActiveSlots: (SimPokemonInfo | null)[]; p2ActiveSlots: (SimPokemonInfo | null)[];
  p1MovesBySlot: BranchMoveOption[][]; p2MovesBySlot: BranchMoveOption[][];
  p1SwitchesBySlot: BranchSwitchOption[][]; p2SwitchesBySlot: BranchSwitchOption[][];
};

export interface DockModelArgs {
  simState: BranchSimState;
  slots: SlotViews;
  damageBySide: { p1: SideDamage; p2: SideDamage };
  gimmickFor: (side: Side, slot: number) => Gimmick;
  played?: PlayedAtPosition | null;
  seed?: SeedChoices | null;
  /** The engine's fill at the live tip: which chips it wrote, and whether it is under way. */
  fill?: DockFillView | null;
}

/** What the engine does about an empty chip right now. */
function engineWait(fill: DockFillView | null | undefined): EngineWait | null {
  if (fill?.pending) return 'pending';
  return fill?.busy ? 'busy' : null;
}

/** The engine's state for one slot: none for the side that waits and for a slot the position asks nothing of (the partner of a forced replacement). */
function slotEngine(fill: DockFillView | null | undefined, view: Pick<SideView, 'waits' | 'required'>, slot: number): EngineWait | null {
  return view.waits || !view.required[slot] ? null : engineWait(fill);
}

/**
 * Round 84 (A7f): a slot that takes no input. The side that waits for the other's replacement, and the partner of a forced
 * replacement on the replacing side (it is asked nothing); a slot the user must fill, forced or not, stays live.
 */
function slotWaits(view: Pick<SideView, 'waits' | 'required' | 'forceSwitches'>, slot: number): boolean {
  return view.waits || (view.forceSwitches.some(Boolean) && !view.required[slot]);
}

/**
 * What an empty chip says, and the engine's state as the placeholder's style shows it (only a chip that waits for the engine has
 * one). A forced replacement shimmers while the run is pending like any slot; when the game analysis blocks the engine it keeps
 * its own text, since the user has to choose.
 */
function emptyChip(
  pending: BranchSlotChoice | null, facts: Omit<Parameters<typeof chipPlaceholder>[0], 'deferred'>, deferred: BranchSlotChoice | null,
): { placeholder: string; wait: EngineWait | null } {
  const word = deferred ? { kind: deferred.kind, name: deferred.kind === 'move' ? deferred.moveName : deferred.pokemonName } : null;
  const silent = pending || deferred || facts.nobodyLeft || facts.commanding || (facts.forceSwitch && facts.engine === 'busy');
  return { placeholder: chipPlaceholder({ ...facts, deferred: word }), wait: silent ? null : facts.engine ?? null };
}

const isLiving = (info: SimPokemonInfo | null | undefined): info is SimPokemonInfo => !!info && !info.fainted && info.hp > 0;

/** What one side of the position holds, by slot. */
interface SideView {
  actives: (SimPokemonInfo | null)[];
  movesBySlot: BranchMoveOption[][];
  switchesBySlot: BranchSwitchOption[][];
  forceSwitches: boolean[];
  choices: (BranchSlotChoice | null)[];
  modifiersBySlot: BranchSlotModifiers[];
  required: boolean[];
  damage: SideDamage;
  waits: boolean;
  foeHp: number | undefined;
}

function sideView(side: Side, args: DockModelArgs, flags: DockModel['flags']): SideView {
  const { simState, slots, damageBySide } = args;
  const p1 = side === 'p1';
  const foes = p1 ? slots.p2ActiveSlots : slots.p1ActiveSlots;
  return {
    actives: p1 ? slots.p1ActiveSlots : slots.p2ActiveSlots,
    movesBySlot: p1 ? slots.p1MovesBySlot : slots.p2MovesBySlot,
    switchesBySlot: p1 ? slots.p1SwitchesBySlot : slots.p2SwitchesBySlot,
    forceSwitches: p1 ? simState.p1ForceSwitches : simState.p2ForceSwitches,
    choices: p1 ? simState.p1Choices : simState.p2Choices,
    modifiersBySlot: p1 ? simState.p1ModifiersBySlot : simState.p2ModifiersBySlot,
    required: p1 ? flags.p1RequiredChoices : flags.p2RequiredChoices,
    damage: damageBySide[side],
    waits: p1 ? flags.p1Waits : flags.p2Waits,
    foeHp: foes.find(isLiving)?.hpPercent,
  };
}

/** What the viewed line played in one slot. */
function playedIn(side: Side, played: PlayedAtPosition | null | undefined, slot: number): PlayedPick | null {
  if (!played) return null;
  return side === 'p1' ? playedOfSlot(played.p1Slots, played.p1, slot) : playedOfSlot(played.p2Slots, played.p2, slot);
}

/** The damage preview of one slot's moves. */
function damageOf(damage: SideDamage, slot: number) {
  return { dmg: damage.default[slot] ?? [], spread: damage.spread[slot] ?? {}, targets: damage.targets[slot] ?? {} };
}

/** The chip of one slot: the pick line or the placeholder, the origin, and the engine's deferred pick. */
function chipOf(
  side: Side, slot: number, view: SideView, args: DockModelArgs,
  facts: { forceSwitch: boolean; nobodyLeft: boolean; commanding: boolean; played: PlayedPick | null },
) {
  const { seed, fill } = args;
  const pending = view.choices[slot] ?? null;
  const deferred = pending ? null : fill?.deferred[side][slot] ?? null;
  return {
    pickText: chipPickText(pending, view.movesBySlot[slot] ?? EMPTY_MOVES),
    ...emptyChip(pending, { ...facts, hasRecord: !!args.played, engine: slotEngine(fill, view, slot) }, deferred),
    origin: chipOrigin(pending, seed?.[side]?.[slot]?.choice, fill?.engine[side][slot] === true),
    deferred,
  };
}

function slotModel(side: Side, slot: number, view: SideView, args: DockModelArgs): DockSlotModel {
  const { played, gimmickFor } = args;
  const active = view.actives[slot] ?? null;
  const identity = slotIdentity(side, slot, view.actives, active);
  const moves = view.movesBySlot[slot] ?? EMPTY_MOVES;
  const switches = view.switchesBySlot[slot] ?? EMPTY_SWITCHES;
  const forceSwitch = view.forceSwitches[slot] ?? false;
  const pending = view.choices[slot] ?? null;
  const nobodyLeft = identity.activeFainted && !forceSwitch && switches.length === 0;
  // Round 85 (T320): a Tatsugiri inside its Dondozo takes no input; the position asks its slot nothing.
  const commanding = !!active?.commanding && !identity.activeFainted && !view.required[slot];
  const pick = playedIn(side, played, slot);
  return {
    side, slot, label: identity.label, name: identity.activeName, species: identity.activeSpecies,
    hpPercent: active?.hpPercent ?? 0, fainted: identity.activeFainted,
    moves, switches, forceSwitch, nobodyLeft, waits: commanding || slotWaits(view, slot),
    pending, blockedSwitchKeys: blockedSwitchKeys(view.choices, view.required, slot),
    modifiers: view.modifiersBySlot[slot] ?? EMPTY_MODIFIERS, gimmick: gimmickFor(side, slot),
    ...damageOf(view.damage, slot),
    played: pick,
    ...chipOf(side, slot, view, args, { forceSwitch, nobodyLeft, commanding, played: pick }),
    foeHp: view.foeHp,
  };
}

function sideSlots(side: Side, args: DockModelArgs, flags: DockModel['flags']): DockSlotModel[] {
  const view = sideView(side, args, flags);
  return view.actives.map((_, slot) => slotModel(side, slot, view, args));
}

export function buildDockModel(args: DockModelArgs): DockModel {
  const { simState, slots } = args;
  // Execute counts the engine's deferred pick of an open slot as chosen.
  const effective = withDeferred(simState, args.fill?.deferred);
  const flags = panelFlags(effective, slots.p1ActiveSlots, slots.p2ActiveSlots);
  const p1 = sideSlots('p1', args, flags);
  const p2 = sideSlots('p2', args, flags);
  const hpByLabel: Record<string, number> = {};
  for (const slot of [...p1, ...p2]) {
    // The damage rows label a body "P2A" also on a side with one slot; the chip reads "P2".
    hpByLabel[slot.label] = slot.hpPercent;
    hpByLabel[`${slot.side.toUpperCase()}${String.fromCharCode(65 + slot.slot)}`] = slot.hpPercent;
  }
  return { p1, p2, hpByLabel, flags, sendChoices: { p1: effective.p1Choices, p2: effective.p2Choices } };
}
