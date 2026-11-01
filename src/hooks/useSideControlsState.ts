import { useCallback, useEffect, useMemo, useState } from 'react';
import type { BranchSlotChoice, BranchSlotModifiers, BranchMoveModifier, BranchMoveOption } from '@fulllifegames/eval-engine';
import { toId } from '@fulllifegames/replay-core';
import { gimmickApplies } from '../lib/dock-seed';

/** Legal move pool for "What if it had …" — loaded lazily per active species. */
export function useMovePool(activeSpecies: string, gen: number): string[] {
  const key = `${activeSpecies}:${gen}`;
  // A species change drops the previous pool in the same render (the old
  // effect cleared it one commit later); the async load fills the new key.
  const [loaded, setLoaded] = useState<{ key: string; pool: string[] }>({ key, pool: [] });
  useEffect(() => {
    let alive = true;
    if (!activeSpecies) return;
    void import('../lib/pokemon-options')
      .then(options => options.getMovePool(activeSpecies, gen))
      .then(pool => {
        if (alive) setLoaded({ key, pool });
      });
    return () => {
      alive = false;
    };
  }, [activeSpecies, gen, key]);
  return loaded.key === key ? loaded.pool : [];
}

type Side = 'p1' | 'p2';
type ArmedGimmicks = Record<Side, (BranchMoveModifier | null)[]>;

const NONE_ARMED: ArmedGimmicks = { p1: [], p2: [] };
const NO_SLOT_MODIFIERS: BranchSlotModifiers = { teraType: null, canMegaEvo: false, canUltraBurst: false, zMoves: [] };

/** The gimmicks other slots of the side hold this turn, each with the holder's slot label ("P1A"). */
type HeldGimmicks = Partial<Record<BranchMoveModifier, string>>;

/** One slot's gimmick toggle as the Fight face reads it; `heldBy` names the partner that holds a gimmick this turn. */
export function gimmickView(
  modifiers: BranchSlotModifiers,
  modifier: BranchMoveModifier | null,
  toggle: (kind: BranchMoveModifier) => void,
  heldBy: HeldGimmicks = {},
) {
  const hasZMoves = modifiers.zMoves.some(Boolean);
  const hasAnyModifier = !!modifiers.teraType || modifiers.canMegaEvo || modifiers.canUltraBurst || hasZMoves;
  // A gimmick a partner holds this turn never rides on this slot's next pick.
  const modifierAvailable = !!modifier && gimmickApplies(modifier, modifiers) && !heldBy[modifier];
  return { modifier, modifierAvailable, hasZMoves, hasAnyModifier, toggle, heldBy };
}

export type Gimmick = ReturnType<typeof gimmickView>;

/** Each side's pending choices, as the picker state holds them (live tip or draft). */
type PendingChoices = Record<Side, (BranchSlotChoice | null)[]>;

const NO_PENDING: PendingChoices = { p1: [], p2: [] };

/**
 * The gimmicks the other slots of a side hold this turn: what a slot's
 * pending choice carries once it has one, else its armed toggle (a switch or
 * a plain move picked after arming frees the gimmick). The simulator takes
 * each gimmick once per side choice (Side.chooseMove: "You can only
 * Terastallize once per battle", the same for Mega Evolution, Ultra Burst and
 * Z-Moves) while the request offers it to every slot, so the panel holds the
 * kind for the other slots, as Showdown's own client does (T124;
 * test/ui/hooks/gimmickOncePerSide.spec.tsx checks it against the simulator).
 */
function heldByPartners(side: Side, slot: number, armed: ArmedGimmicks, pending: PendingChoices): HeldGimmicks {
  const held: HeldGimmicks = {};
  const slots = Math.max(armed[side].length, pending[side].length);
  for (let other = 0; other < slots; other++) {
    if (other === slot) continue;
    const pick = pending[side][other];
    const kind = pick ? (pick.kind === 'move' ? pick.modifier : null) : armed[side][other];
    if (kind) held[kind] = `${side.toUpperCase()}${String.fromCharCode(65 + other)}`;
  }
  return held;
}

const keepApplying = (armed: (BranchMoveModifier | null)[], modifiers: BranchSlotModifiers[]) =>
  armed.map((kind, slot) => (kind && gimmickApplies(kind, modifiers[slot]) ? kind : null));

/**
 * A slot's gimmick as the panel reads it. Where picks are editable (round 84), a slot with a move pick shows the modifier the
 * pick carries; elsewhere, and on a slot without a move pick, its armed toggle.
 */
function modifierOf(
  pick: BranchSlotChoice | null | undefined, armed: BranchMoveModifier | null | undefined, editable: boolean,
): BranchMoveModifier | null {
  if (editable && pick?.kind === 'move') return pick.modifier ?? null;
  return armed ?? null;
}

const teraOf = (
  armed: (BranchMoveModifier | null)[], modifiers: BranchSlotModifiers[], picks: (BranchSlotChoice | null)[], editable: boolean,
) => modifiers.map((slotModifiers, slot) => (modifierOf(picks[slot], armed[slot], editable) === 'terastallize' ? slotModifiers.teraType : null));

/** Round 84 (turn dock), C4: where an edit of a pending move goes, and the moves a Z toggle checks. */
export interface PendingEdit {
  onEdit: (side: Side, slot: number, choice: BranchSlotChoice) => void;
  movesBySlot?: Partial<Record<Side, BranchMoveOption[][]>>;
}

/** The pending move with the toggle applied (or released), or null when this slot's toggle may not change it. */
function editedPick(
  pick: Extract<BranchSlotChoice, { kind: 'move' }>, kind: BranchMoveModifier, modifiers: BranchSlotModifiers | undefined,
  moves: BranchMoveOption[] | undefined, heldBy: HeldGimmicks,
): BranchSlotChoice | null {
  if (pick.modifier === kind) {
    const plain = { ...pick };
    delete plain.modifier;
    return plain;
  }
  if (heldBy[kind] || !gimmickApplies(kind, modifiers)) return null;
  // A Z toggle only applies to moves that actually have a Z option.
  if (kind === 'zmove' && !modifiers?.zMoves[(moves ?? []).findIndex(option => toId(option.name) === pick.moveId)]) return null;
  return { ...pick, modifier: kind };
}

/**
 * The armed gimmicks of one position. A new position key starts every slot
 * unarmed, the way the draft choices clear on navigation: an armed Tera must
 * not ride along to another turn and silently change its numbers (T124).
 */
function useArmedAt(positionKey: string | undefined) {
  const [state, setState] = useState<{ key: string | undefined; armed: ArmedGimmicks }>({ key: positionKey, armed: NONE_ARMED });
  const moved = state.key !== positionKey;
  if (moved) setState({ key: positionKey, armed: NONE_ARMED });
  const setArmed = useCallback((update: (current: ArmedGimmicks) => ArmedGimmicks) =>
    setState(current => ({ key: current.key, armed: update(current.armed) })), []);
  return { armed: moved ? NONE_ARMED : state.armed, setArmed };
}

/**
 * The battle gimmick toggles (Tera/Mega/Ultra/Z) of every active slot of
 * both sides, held by the panel so the damage preview reads them: an armed
 * Tera toggle gives `teraBySlot` the type the Pokémon would take (T20).
 * `positionKey` names the viewed position; the toggles belong to it.
 * `pending` holds each side's chosen actions: a gimmick one slot holds,
 * armed or chosen, stays out of reach for the side's other slots (T124).
 */
export function useGimmickToggles(
  p1Modifiers: BranchSlotModifiers[],
  p2Modifiers: BranchSlotModifiers[],
  positionKey?: string,
  pending: PendingChoices = NO_PENDING,
  edit?: PendingEdit,
) {
  const { armed, setArmed } = useArmedAt(positionKey);
  // Once a gimmick is spent (or the active Pokémon changed and can't use
  // it), it must not silently stick to future move choices ("Thundurus
  // can't Terastallize" after an earlier Tera).
  const kept = { p1: keepApplying(armed.p1, p1Modifiers), p2: keepApplying(armed.p2, p2Modifiers) };
  const spent = (side: Side) => kept[side].some((kind, slot) => kind !== (armed[side][slot] ?? null));
  if (spent('p1') || spent('p2')) setArmed(() => kept);
  const toggle = useCallback((side: Side, slot: number, kind: BranchMoveModifier) => {
    const pick = pending[side][slot];
    if (edit && pick?.kind === 'move') {
      // Round 84, C4: a slot with a move pick (the seed or the user's) takes the gimmick into that pick.
      const modifiers = (side === 'p1' ? p1Modifiers : p2Modifiers)[slot];
      const next = editedPick(pick, kind, modifiers, edit.movesBySlot?.[side]?.[slot], heldByPartners(side, slot, armed, pending));
      if (next) edit.onEdit(side, slot, next);
      return;
    }
    setArmed(current => {
      const arming = current[side][slot] !== kind;
      if (arming && heldByPartners(side, slot, current, pending)[kind]) return current;
      // Arming takes the kind from a partner whose pick no longer carries it, so it cannot ride on that slot's next pick.
      const next = current[side].map(held => (arming && held === kind ? null : held));
      next[slot] = arming ? kind : null;
      return { ...current, [side]: next };
    });
  }, [setArmed, pending, edit, armed, p1Modifiers, p2Modifiers]);
  const teraBySlot = useMemo(
    () => ({ p1: teraOf(armed.p1, p1Modifiers, pending.p1, !!edit), p2: teraOf(armed.p2, p2Modifiers, pending.p2, !!edit) }),
    [armed, p1Modifiers, p2Modifiers, pending, edit],
  );
  const gimmickFor = (side: Side, slot: number): Gimmick => gimmickView(
    (side === 'p1' ? p1Modifiers : p2Modifiers)[slot] ?? NO_SLOT_MODIFIERS,
    modifierOf(pending[side][slot], armed[side][slot], !!edit),
    kind => toggle(side, slot, kind),
    heldByPartners(side, slot, armed, pending),
  );
  return { gimmickFor, teraBySlot };
}
