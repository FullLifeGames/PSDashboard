import { useState } from 'react';
import type { BranchSlotChoice } from '@fulllifegames/eval-engine';
import { useMovePool } from '../../hooks/useSideControlsState';
import type { DiceViews } from '../../hooks/useDiceView';
import { rollsFor } from '../../lib/branch-rolls';
import { pickedChoice, type ChoiceContext } from '../branch/choice-context';
import { TurnDice } from '../branch/DiceChips';
import { DiceTable } from './DiceTable';
import type { DockSlotModel } from './dock-model';
import { ChoicePicker, WhatIfRow, type WhatIfState } from './WhatIfSection';

/**
 * Round 84 (turn dock): the part of the tray behind "Dice · What if": the forced dice of the slot's move and of the turn, the
 * "What if it had…" loader and the list of all choices. The dice of the slot's move are a table (A4), with the dice of the turn
 * under it; the "What if" loader and the list are today's. The pool of moves loads when this section opens.
 */
export function TrayMore({ slot, gen, diceViews, onChoice, onHypotheticalMove }: {
  slot: DockSlotModel;
  gen: number;
  diceViews: DiceViews;
  onChoice: (choice: BranchSlotChoice) => void;
  onHypotheticalMove: (params: { species: string; move: string; replace: string | null }) => void;
}) {
  const { label, moves, switches, species, gimmick, modifiers } = slot;
  const [whatIfMove, setWhatIfMove] = useState('');
  const [whatIfReplace, setWhatIfReplace] = useState<string | null>(null);
  const whatIf: WhatIfState = { whatIfMove, setWhatIfMove, whatIfReplace, setWhatIfReplace };
  const movePool = useMovePool(species, gen);
  const ctx: ChoiceContext = { modifier: gimmick.modifier, modifierAvailable: gimmick.modifierAvailable, moves, modifiers };
  const dice = diceViews.slot(slot.side, slot.slot);
  const onPickChoice = (value: string) => {
    const choice = pickedChoice(value, switches, ctx);
    if (choice) onChoice(choice);
  };
  return (
    <div className="ps-tray-more">
      <div className="ps-tray-block">
        <span className="ps-tray-label">Dice</span>
        {dice
          ? <DiceTable {...dice} label={label} rollsOf={name => rollsFor(name, { moves, dmgResults: slot.dmg, spreadDamageResults: slot.spread, targetDamageResults: slot.targets })} />
          : <span className="ps-tray-hint">Pick a move to see its dice.</span>}
        {diceViews.turn && <TurnDice {...diceViews.turn} />}
      </div>
      {movePool.length > 0 && (
        <div className="ps-tray-block">
          <span className="ps-tray-label">What if</span>
          <div className="ps-custom-choice">
            <WhatIfRow label={label} moves={moves} activeSpecies={species} movePool={movePool} whatIf={whatIf} onHypotheticalMove={onHypotheticalMove} />
          </div>
        </div>
      )}
      <div className="ps-tray-block">
        <span className="ps-tray-label">All choices</span>
        <div className="ps-custom-choice">
          <ChoicePicker label={label} moves={moves} switches={switches} blockedSwitchKeys={slot.blockedSwitchKeys} onPick={onPickChoice} />
        </div>
      </div>
    </div>
  );
}
