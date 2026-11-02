import { useEffect, useMemo, useState } from 'react';
import type { BranchSimState, BranchSlotChoice, BranchSlotModifiers, LiveHit } from '@fulllifegames/eval-engine';
import { computePreviewDamage, EMPTY_SIDE_DAMAGE, type DamagePreviewInputs, type SideDamage } from '../lib/branch-damage';
import { EMPTY_MOVES, EMPTY_SWITCHES } from '../lib/dock-panel';
import { useGimmickToggles, type PendingEdit } from './useSideControlsState';

/**
 * Round 84 (turn dock): the slot views, the gimmick toggles and the damage preview of a position, as the old BranchPanel read them.
 * The toggles live here, not per slot: the preview reads both sides' Tera (T20). With `onEdit` a toggle edits the slot's
 * pending move; without it a toggle arms the slot's next pick.
 */

type Side = 'p1' | 'p2';
type LiveBattle = LiveHit['battle'];

const EMPTY_SLOT_MODIFIERS: BranchSlotModifiers[] = [];
const EMPTY_CHOICES: (BranchSlotChoice | null)[] = [];

/** Per-slot views of the sim state (singles fall back to the single-active fields). */
export function useSlots(simState: BranchSimState | null) {
  const p1ActiveSlots = useMemo(
    () => simState?.p1ActiveSlots ?? (simState?.p1Active ? [simState.p1Active] : []),
    [simState],
  );
  const p2ActiveSlots = useMemo(
    () => simState?.p2ActiveSlots ?? (simState?.p2Active ? [simState.p2Active] : []),
    [simState],
  );
  const p1MovesBySlot = useMemo(
    () => simState?.p1MovesBySlot ?? [simState?.p1Moves ?? EMPTY_MOVES],
    [simState],
  );
  const p2MovesBySlot = useMemo(
    () => simState?.p2MovesBySlot ?? [simState?.p2Moves ?? EMPTY_MOVES],
    [simState],
  );
  const p1SwitchesBySlot = simState?.p1SwitchesBySlot ?? [simState?.p1Switches ?? EMPTY_SWITCHES];
  const p2SwitchesBySlot = simState?.p2SwitchesBySlot ?? [simState?.p2Switches ?? EMPTY_SWITCHES];
  return { p1ActiveSlots, p2ActiveSlots, p1MovesBySlot, p2MovesBySlot, p1SwitchesBySlot, p2SwitchesBySlot };
}

/** The damage preview per side, recomputed whenever the actives, moves, field, gen, armed Tera toggles, or picks change. */
function usePreviewDamage(inputs: DamagePreviewInputs, getBattle: (() => LiveBattle | null) | undefined) {
  const { p1ActiveSlots, p2ActiveSlots, p1MovesBySlot, p2MovesBySlot, fieldState, gen, teraBySlot, choices } = inputs;
  const [damageBySide, setDamageBySide] = useState<{ p1: SideDamage; p2: SideDamage }>({
    p1: EMPTY_SIDE_DAMAGE,
    p2: EMPTY_SIDE_DAMAGE,
  });
  useEffect(() => {
    let cancelled = false;

    async function calculatePreviewDamage() {
      const { calcSingleDamageRange } = await import('../lib/lazy/damage-calc');
      if (cancelled) return;
      setDamageBySide(computePreviewDamage(
        { p1ActiveSlots, p2ActiveSlots, p1MovesBySlot, p2MovesBySlot, fieldState, gen, teraBySlot, choices, battle: getBattle?.() ?? null },
        calcSingleDamageRange,
      ));
    }

    void calculatePreviewDamage();
    return () => {
      cancelled = true;
    };
  }, [p1ActiveSlots, p2ActiveSlots, p1MovesBySlot, p2MovesBySlot, fieldState, gen, teraBySlot, choices, getBattle]);
  return damageBySide;
}

export function useDockPreview(
  simState: BranchSimState | null, gen: number, positionKey: string | undefined, getBattle: (() => LiveBattle | null) | undefined,
  onEdit?: (side: Side, slot: number, choice: BranchSlotChoice) => void,
) {
  const slots = useSlots(simState);
  // Both sides' chosen actions: a gimmick in one slot's pick is the side's for this turn (T124).
  const choices = useMemo(() => ({ p1: simState?.p1Choices ?? EMPTY_CHOICES, p2: simState?.p2Choices ?? EMPTY_CHOICES }), [simState]);
  const { p1ActiveSlots, p2ActiveSlots, p1MovesBySlot, p2MovesBySlot } = slots;
  const edit = useMemo<PendingEdit | undefined>(
    () => (onEdit ? { onEdit, movesBySlot: { p1: p1MovesBySlot, p2: p2MovesBySlot } } : undefined),
    [onEdit, p1MovesBySlot, p2MovesBySlot],
  );
  const { gimmickFor, teraBySlot } = useGimmickToggles(
    simState?.p1ModifiersBySlot ?? EMPTY_SLOT_MODIFIERS,
    simState?.p2ModifiersBySlot ?? EMPTY_SLOT_MODIFIERS,
    positionKey,
    choices,
    edit,
  );
  const fieldState = simState?.field ?? null;
  const damageBySide = usePreviewDamage({ p1ActiveSlots, p2ActiveSlots, p1MovesBySlot, p2MovesBySlot, fieldState, gen, teraBySlot, choices }, getBattle);
  return { slots, gimmickFor, damageBySide };
}
