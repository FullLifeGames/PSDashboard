import type { BranchMoveOption, BranchSwitchOption } from '../../hooks/useBranch';
import {
  type BranchSlotModifiers, type DamageResult, type BranchSlotChoice,
} from '@fulllifegames/eval-engine';
import type { SpreadTargetDamage } from '../../lib/branch-damage';
import type { Gimmick } from '../../hooks/useSideControlsState';
import { ModifierRow } from '../dock/GimmickRow';
import { ChoicePicker, WhatIfRow, type WhatIfState } from '../dock/WhatIfSection';
import { MoveBtn } from './ChoiceButtons';
import { SlotDice, type SlotDiceProps } from './DiceChips';
import { rollsFor } from '../../lib/branch-rolls';
import { moveChoiceFor, pickedChoice, type ChoiceContext } from './choice-context';
import type { PlayedPick } from './SideControls';
import { toId } from '@fulllifegames/replay-core';

export type { WhatIfState };

export interface FightSectionProps {
  label: string;
  activeSpecies: string;
  moves: BranchMoveOption[];
  switches: BranchSwitchOption[];
  pending: BranchSlotChoice | null;
  blockedSwitchKeys: Set<string>;
  modifiers: BranchSlotModifiers;
  dmgResults: DamageResult[];
  spreadDamageResults: Record<number, SpreadTargetDamage[]>;
  targetDamageResults: Record<string, DamageResult | undefined>;
  advanced: boolean;
  played?: PlayedPick | null;
  /** The chips of the slot's chosen move (Advanced, round 82); absent where the panel has no battle to ask. */
  dice?: Omit<SlotDiceProps, 'label'>;
  gimmick: Gimmick;
  movePool: string[];
  whatIf: WhatIfState;
  onChoice: (choice: BranchSlotChoice) => void;
  onHypotheticalMove: (params: { species: string; move: string; replace: string | null }) => void;
}

function MoveGrid({ moves, advanced, dmgResults, spreadDamageResults, targetDamageResults, modifiers, pending, played, ctx, onChoice }: Pick<FightSectionProps,
  'moves' | 'advanced' | 'dmgResults' | 'spreadDamageResults' | 'targetDamageResults' | 'modifiers' | 'pending' | 'played' | 'onChoice'>
  & { ctx: ChoiceContext }) {
  const playedMoveKey = played?.kind === 'move' ? toId(played.name) : null;
  return (
    <div className={`ps-movegrid${advanced ? '' : ' ps-movegrid-compact'}`}>
      {moves.map((m, i) => (
        <MoveBtn
          key={m.slot}
          move={m}
          dmg={dmgResults[i]}
          spreadDamage={spreadDamageResults[m.slot]}
          zMoveName={ctx.modifier === 'zmove' ? modifiers.zMoves[m.slot - 1] ?? null : null}
          targetDamage={Object.fromEntries(
            m.targetOptions.map(target => [
              target.targetLoc,
              targetDamageResults[`${m.slot}:${target.targetLoc}`],
            ]),
          )}
          pendingChoice={pending}
          wasPlayed={playedMoveKey !== null && toId(m.name) === playedMoveKey}
          compact={!advanced}
          teraArmed={ctx.modifier === 'terastallize'}
          onClick={(targetLoc) => onChoice(moveChoiceFor(m, targetLoc, ctx))}
        />
      ))}
    </div>
  );
}

/** The Fight face of one side: gimmick toggles, the move grid, and the Advanced power tools. */
export function FightSection(props: FightSectionProps) {
  const { label, moves, switches, blockedSwitchKeys, modifiers, advanced, gimmick, movePool, onChoice } = props;
  const ctx: ChoiceContext = { modifier: gimmick.modifier, modifierAvailable: gimmick.modifierAvailable, moves, modifiers };
  const onPickChoice = (value: string) => {
    const choice = pickedChoice(value, switches, ctx);
    if (choice) onChoice(choice);
  };
  return (
    <>
      {gimmick.hasAnyModifier && <ModifierRow label={label} modifiers={modifiers} gimmick={gimmick} />}
      <MoveGrid
        moves={moves}
        advanced={advanced}
        dmgResults={props.dmgResults}
        spreadDamageResults={props.spreadDamageResults}
        targetDamageResults={props.targetDamageResults}
        modifiers={modifiers}
        pending={props.pending}
        played={props.played}
        ctx={ctx}
        onChoice={onChoice}
      />
      {advanced && props.dice && (
        <SlotDice
          {...props.dice} label={label}
          rollsOf={name => rollsFor(name, { moves, dmgResults: props.dmgResults, spreadDamageResults: props.spreadDamageResults, targetDamageResults: props.targetDamageResults })}
        />
      )}
      {advanced && (
      <div className="ps-custom-choice">
        <ChoicePicker label={label} moves={moves} switches={switches} blockedSwitchKeys={blockedSwitchKeys} onPick={onPickChoice} />
        {/* Shares the picker's row — a second row pushed Execute Turn below the fold. */}
        {movePool.length > 0 && (
          <WhatIfRow
            label={label}
            moves={moves}
            activeSpecies={props.activeSpecies}
            movePool={movePool}
            whatIf={props.whatIf}
            onHypotheticalMove={props.onHypotheticalMove}
          />
        )}
      </div>
      )}
    </>
  );
}
