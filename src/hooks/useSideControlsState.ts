import { useEffect, useState } from 'react';
import type { BranchSlotModifiers } from '../lib/branch-engine';
import type { BranchMoveModifier } from '../lib/branch-choices';

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

/** The battle gimmick toggle (Tera/Mega/Ultra/Z) and whether it applies to the current active. */
export function useGimmick(modifiers: BranchSlotModifiers) {
  const [modifier, setModifier] = useState<BranchMoveModifier | null>(null);
  const hasZMoves = modifiers.zMoves.some(Boolean);
  const hasAnyModifier = !!modifiers.teraType || modifiers.canMegaEvo || modifiers.canUltraBurst || hasZMoves;
  const modifierAvailable =
    (modifier === 'terastallize' && !!modifiers.teraType) ||
    (modifier === 'mega' && modifiers.canMegaEvo) ||
    (modifier === 'ultra' && modifiers.canUltraBurst) ||
    (modifier === 'zmove' && hasZMoves);
  // The toggle is local component state — once the gimmick is spent (or the
  // active Pokémon changed and can't use it), it must not silently stick to
  // future move choices ("Thundurus can't Terastallize" after an earlier Tera).
  if (modifier && !modifierAvailable) setModifier(null);
  const toggle = (kind: BranchMoveModifier) => setModifier(current => (current === kind ? null : kind));
  return { modifier, modifierAvailable, hasZMoves, hasAnyModifier, toggle };
}

export type Gimmick = ReturnType<typeof useGimmick>;
