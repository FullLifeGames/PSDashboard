import { Fragment, type CSSProperties } from 'react';
import { dieKey, type DieName, type DieOffer, type DieWords, type ForcedDie } from '@fulllifegames/eval-engine';
import { captionOf, diceTable, pullNotes, targetHeading } from '../../lib/branch-dice';
import type { StepDamage } from '../../lib/branch-rolls';
import { DieRow, StrayDice } from '../branch/DiceChips';

/**
 * Round 84 (turn dock), step A4: the dice of a slot's chosen move as a table. A column is a target of the move, a row a kind of
 * die (Hit, Crit, Damage roll with its select, each secondary effect), so a spread move reads across: the same die on every
 * target in one row. Round 83 (the user, 01.11.2026: "which hit you're controlling is not really defined") named the sets of
 * chips by their target; the head of a column does it now, with the slot and the name, so two bodies of one species stay
 * apart. A move with one target is one column without a head. A die the user forced is pressed, the result the log shows
 * carries "log", and a die set that the move no longer offers stays below the table, one click from clear.
 */

export interface DiceTableProps {
  /** The dice the engine offers for the slot's chosen move; null while the dock asks. */
  offers: DieOffer[] | null;
  /** The slot choice's forced dice that belong to the move. */
  dice: readonly ForcedDie[];
  /** What the log shows for this turn (first turn of a branch). */
  logged: readonly ForcedDie[];
  words: DieWords;
  label: string;
  /** The calculator's damage for each step of the roll of a die's target (the preview computes it for the chosen move). */
  rollsOf?: (name: DieName) => StepDamage | undefined;
  /** The dock edits the slot choice: a die is set, replaced or cleared there. */
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
