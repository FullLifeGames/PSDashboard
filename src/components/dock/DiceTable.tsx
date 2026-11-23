import { Fragment, type CSSProperties } from 'react';
import { dieKey, type DieName, type DieOffer, type DieWords, type ForcedDie } from '@fulllifegames/eval-engine';
import { captionOf, diceTable, pullNotes, targetHeading } from '../../lib/branch-dice';
import type { StepDamage } from '../../lib/branch-rolls';
import { DieRow, StrayDice } from '../branch/DiceChips';

/**
 * The dice of a slot's chosen move: a column is a target, a row a kind of die, so a spread move reads the same die across its targets.
 * A set die the move no longer offers stays below the table, one click from clear.
 */

export interface DiceTableProps {
  /** The dice the engine offers for the slot's chosen move; null while the dock asks. */
  offers: DieOffer[] | null;
  dice: readonly ForcedDie[];
  /** What the log shows for this turn (first turn of a branch). */
  logged: readonly ForcedDie[];
  words: DieWords;
  label: string;
  rollsOf?: (name: DieName) => StepDamage | undefined;
  onToggle: (die: ForcedDie) => void;
}

export function DiceTable({ offers, dice, logged, words, label, rollsOf, onToggle }: DiceTableProps) {
  if (offers === null) return null;
  const offered = new Set(offers.map(offer => dieKey(offer.name)));
  const stray = dice.filter(die => !offered.has(dieKey(die.name)));
  if (offers.length === 0 && stray.length === 0) return null;
  const { heads, rows, shared } = diceTable(offers);
  const row = { dice, logged, words, rollsOf, onToggle };
  return (
    <div className="ps-dice ps-dice-table" role="group" aria-label={`Dice for ${label}`} style={{ '--dice-cols': Math.max(heads.length, 1) } as CSSProperties}>
      {heads.length > 0 && <span className="ps-dice-corner" />}
      {heads.map(head => <div key={head} className="ps-dice-heading">{targetHeading(head, words)}</div>)}
      {rows.map(({ key, cells }) => {
        const first = cells.find((cell): cell is DieOffer => cell !== null)!;
        return (
          <Fragment key={key}>
            <span className="ps-dice-caption">{captionOf(first.name, words)}</span>
            {cells.map((cell, index) => cell
              ? <DieRow key={dieKey(cell.name)} offer={cell} {...row} cell="cell" target={heads.length > 0 ? heads[index] : undefined} />
              : <span key={heads[index]} className="ps-dice-gap" />)}
          </Fragment>
        );
      })}
      {shared.map(offer => (
        <Fragment key={dieKey(offer.name)}>
          <span className="ps-dice-caption">{captionOf(offer.name, words)}</span>
          <DieRow offer={offer} {...row} cell="shared" />
        </Fragment>
      ))}
      {pullNotes(dice, offers, words).map(note => <div key={note} className="ps-dice-note ps-dice-wide">{note}</div>)}
      {stray.length > 0 && <div className="ps-dice-wide"><StrayDice dice={stray} words={words} onToggle={onToggle} /></div>}
    </div>
  );
}
