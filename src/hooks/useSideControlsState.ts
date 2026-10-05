import { useCallback, useEffect, useMemo, useState } from 'react';
import type { BranchSlotModifiers, BranchMoveModifier } from '@fulllifegames/eval-engine';

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

/** Whether a gimmick still applies to a slot's active Pokémon. */
function gimmickApplies(kind: BranchMoveModifier, modifiers: BranchSlotModifiers | undefined): boolean {
  if (!modifiers) return false;
  if (kind === 'terastallize') return !!modifiers.teraType;
  if (kind === 'mega') return modifiers.canMegaEvo;
  if (kind === 'ultra') return modifiers.canUltraBurst;
  return modifiers.zMoves.some(Boolean);
}

/** One slot's gimmick toggle as the Fight face reads it. */
export function gimmickView(modifiers: BranchSlotModifiers, modifier: BranchMoveModifier | null, toggle: (kind: BranchMoveModifier) => void) {
  const hasZMoves = modifiers.zMoves.some(Boolean);
  const hasAnyModifier = !!modifiers.teraType || modifiers.canMegaEvo || modifiers.canUltraBurst || hasZMoves;
  const modifierAvailable = !!modifier && gimmickApplies(modifier, modifiers);
  return { modifier, modifierAvailable, hasZMoves, hasAnyModifier, toggle };
}

export type Gimmick = ReturnType<typeof gimmickView>;

const keepApplying = (armed: (BranchMoveModifier | null)[], modifiers: BranchSlotModifiers[]) =>
  armed.map((kind, slot) => (kind && gimmickApplies(kind, modifiers[slot]) ? kind : null));

const teraOf = (armed: (BranchMoveModifier | null)[], modifiers: BranchSlotModifiers[]) =>
  modifiers.map((slotModifiers, slot) => (armed[slot] === 'terastallize' ? slotModifiers.teraType : null));

/**
 * The battle gimmick toggles (Tera/Mega/Ultra/Z) of every active slot of
 * both sides, held by the panel so the damage preview reads them: an armed
 * Tera toggle gives `teraBySlot` the type the Pokémon would take (T20).
 */
export function useGimmickToggles(p1Modifiers: BranchSlotModifiers[], p2Modifiers: BranchSlotModifiers[]) {
  const [armed, setArmed] = useState<ArmedGimmicks>(NONE_ARMED);
  // Once a gimmick is spent (or the active Pokémon changed and can't use
  // it), it must not silently stick to future move choices ("Thundurus
  // can't Terastallize" after an earlier Tera).
  const kept = { p1: keepApplying(armed.p1, p1Modifiers), p2: keepApplying(armed.p2, p2Modifiers) };
  const spent = (side: Side) => kept[side].some((kind, slot) => kind !== (armed[side][slot] ?? null));
  if (spent('p1') || spent('p2')) setArmed(kept);
  const toggle = useCallback((side: Side, slot: number, kind: BranchMoveModifier) => setArmed(current => {
    const next = [...current[side]];
    next[slot] = next[slot] === kind ? null : kind;
    return { ...current, [side]: next };
  }), []);
  const teraBySlot = useMemo(
    () => ({ p1: teraOf(armed.p1, p1Modifiers), p2: teraOf(armed.p2, p2Modifiers) }),
    [armed, p1Modifiers, p2Modifiers],
  );
  const gimmickFor = (side: Side, slot: number): Gimmick => gimmickView(
    (side === 'p1' ? p1Modifiers : p2Modifiers)[slot] ?? NO_SLOT_MODIFIERS,
    armed[side][slot] ?? null,
    kind => toggle(side, slot, kind),
  );
  return { gimmickFor, teraBySlot };
}
