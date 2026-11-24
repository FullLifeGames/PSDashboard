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
  nobodyLeft: boolean;
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
  pickText: string;
  placeholder: string;
  wait: EngineWait | null;
  origin: ChipOrigin | null;
  deferred: BranchSlotChoice | null;
  foeHp: number | undefined;
}

export interface DockModel {
  p1: DockSlotModel[];
  p2: DockSlotModel[];
  hpByLabel: Record<string, number>;
  flags: ReturnType<typeof panelFlags>;
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
  fill?: DockFillView | null;
}

function engineWait(fill: DockFillView | null | undefined): EngineWait | null {
  if (fill?.pending) return 'pending';
  return fill?.busy ? 'busy' : null;
}

function slotEngine(fill: DockFillView | null | undefined, view: Pick<SideView, 'waits' | 'required'>, slot: number): EngineWait | null {
  return view.waits || !view.required[slot] ? null : engineWait(fill);
}

function slotWaits(view: Pick<SideView, 'waits' | 'required' | 'forceSwitches'>, slot: number): boolean {
  return view.waits || (view.forceSwitches.some(Boolean) && !view.required[slot]);
}

function emptyChip(
  pending: BranchSlotChoice | null, facts: Omit<Parameters<typeof chipPlaceholder>[0], 'deferred'>, deferred: BranchSlotChoice | null,
): { placeholder: string; wait: EngineWait | null } {
  const word = deferred ? { kind: deferred.kind, name: deferred.kind === 'move' ? deferred.moveName : deferred.pokemonName } : null;
  const silent = pending || deferred || facts.nobodyLeft || facts.commanding || (facts.forceSwitch && facts.engine === 'busy');
  return { placeholder: chipPlaceholder({ ...facts, deferred: word }), wait: silent ? null : facts.engine ?? null };
}

const isLiving = (info: SimPokemonInfo | null | undefined): info is SimPokemonInfo => !!info && !info.fainted && info.hp > 0;

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

function playedIn(side: Side, played: PlayedAtPosition | null | undefined, slot: number): PlayedPick | null {
  if (!played) return null;
  return side === 'p1' ? playedOfSlot(played.p1Slots, played.p1, slot) : playedOfSlot(played.p2Slots, played.p2, slot);
}

function damageOf(damage: SideDamage, slot: number) {
  return { dmg: damage.default[slot] ?? [], spread: damage.spread[slot] ?? {}, targets: damage.targets[slot] ?? {} };
}

function chipOf(
  side: Side, slot: number, view: SideView, args: DockModelArgs,
  facts: { forceSwitch: boolean; nobodyLeft: boolean; partnerSwitching: boolean; commanding: boolean; played: PlayedPick | null },
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
    ...chipOf(side, slot, view, args, { forceSwitch, nobodyLeft, partnerSwitching: view.forceSwitches.some(Boolean), commanding, played: pick }),
    foeHp: view.foeHp,
  };
}

function sideSlots(side: Side, args: DockModelArgs, flags: DockModel['flags']): DockSlotModel[] {
  const view = sideView(side, args, flags);
  return view.actives.map((_, slot) => slotModel(side, slot, view, args));
}

export function buildDockModel(args: DockModelArgs): DockModel {
  const { simState, slots } = args;
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
