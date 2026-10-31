import { useCallback, useMemo } from 'react';
import { dieKey, type BranchSlotChoice, type ForcedDie, type LiveHit } from '@fulllifegames/eval-engine';
import type { BranchSimState } from './useBranch';
import { useDiceOffers } from './useDiceOffers';
import { TURN_KINDS, toggleDie, withDice } from '../lib/branch-dice';
import type { SlotDiceProps, TurnDiceProps } from '../components/branch/DiceChips';

/**
 * Round 82 (forced dice), step A7a: what the panel hands to the chips. Each die rides on the choice of its own slot (ADR 0001):
 * the dice of a move on the move's slot, the dice of the turn (a speed tie, a first mover, the end of the turn) on the choice of
 * the slot the die names. A click edits that choice and sends it through the panel's `onSetChoice`, so a new move or target for
 * the slot, which sends a fresh choice, gives its dice back to the seed.
 */

export type SlotDiceView = Omit<SlotDiceProps, 'label'>;
type Side = 'p1' | 'p2';

const sideOf = (slot: string): Side => (slot[1] === '1' ? 'p1' : 'p2');
const indexOf = (slot: string): number => (slot[2] === 'a' ? 0 : 1);
const slotNameOf = (side: Side, index: number): string => `${side}${String.fromCharCode(97 + index)}`;

export interface DiceViews {
  slot(side: Side, index: number): SlotDiceView | undefined;
  turn: Omit<TurnDiceProps, 'dice'> & { dice: ForcedDie[] } | null;
}

export function useDiceViews(args: {
  advanced: boolean;
  stale: boolean | undefined;
  simState: BranchSimState | null;
  getBattle: (() => LiveHit['battle'] | null) | undefined;
  onSetChoice: (side: Side, choice: BranchSlotChoice, activeSlot?: number) => void;
}): DiceViews {
  const { advanced, stale, simState, getBattle, onSetChoice } = args;
  const view = useDiceOffers({ enabled: advanced && !stale, simState, getBattle });
  const choiceAt = useCallback((side: Side, index: number): BranchSlotChoice | null =>
    (side === 'p1' ? simState?.p1Choices : simState?.p2Choices)?.[index] ?? null, [simState]);
  const toggleOn = useCallback((slot: string, die: ForcedDie) => {
    const side = sideOf(slot);
    const index = indexOf(slot);
    const choice = choiceAt(side, index);
    if (choice) onSetChoice(side, withDice(choice, toggleDie(choice.dice ?? [], die)), index);
  }, [choiceAt, onSetChoice]);
  return useMemo(() => {
    if (!view) return { slot: () => undefined, turn: null };
    const turnKeys = new Set(view.turn.map(offer => dieKey(offer.name)));
    const isTurnDie = (die: ForcedDie) => TURN_KINDS.has(die.name.kind) || turnKeys.has(dieKey(die.name));
    const allDice = [simState?.p1Choices ?? [], simState?.p2Choices ?? []].flat().flatMap(choice => choice?.dice ?? []);
    return {
      slot(side, index) {
        const choice = choiceAt(side, index);
        const slot = slotNameOf(side, index);
        if (choice?.kind !== 'move' || !view.bySlot[slot]) return undefined;
        return {
          offers: view.bySlot[slot], dice: (choice.dice ?? []).filter(die => !isTurnDie(die)), logged: view.logged,
          words: view.words, onToggle: die => toggleOn(slot, die),
        };
      },
      turn: {
        offers: view.turn, dice: allDice.filter(isTurnDie), logged: view.logged, words: view.words,
        onToggle: die => toggleOn(die.name.slot, die),
      },
    };
  }, [view, simState, choiceAt, toggleOn]);
}
