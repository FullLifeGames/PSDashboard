import { dieKey, dieLabel, type DieName, type DieOffer, type DieWords, type ForcedDie } from '@fulllifegames/eval-engine';
import { TURN_KINDS, captionOf, chipGroups, pullNotes, resultWord } from '../../lib/branch-dice';
import type { StepDamage } from '../../lib/branch-rolls';
import { RollSelect } from './RollSelect';

/**
 * Round 82 (forced dice), step A7a: the chips of Advanced. A chip is one result of one die; a click forces it, a second click
 * on the same chip gives the die back to the seed. A chip carries no chance (decision 14a): the result line after Execute names
 * the chance the simulator used. A die the simulator draws for a rule the panel cannot see in advance stays set and shows up
 * in the list below the chips, so the user can always clear what the turn will force.
 */

const sameResult = (a: ForcedDie['result'], b: ForcedDie['result']): boolean => JSON.stringify(a) === JSON.stringify(b);

interface DieRowProps {
  offer: DieOffer;
  dice: readonly ForcedDie[];
  logged: readonly ForcedDie[];
  words: DieWords;
  /** The group names a target: the caption does too. */
  target?: string;
  /** The caption names the move (the end of the turn mixes dice of several moves). */
  withMove?: boolean;
  /** The calculator's damage for each step of the roll, for the damage roll select. */
  rollsOf?: (name: DieName) => StepDamage | undefined;
  onToggle: (die: ForcedDie) => void;
}

function Chip({ die, set, logMark, words, onToggle }: { die: ForcedDie; set: boolean; logMark: boolean; words: DieWords; onToggle: (die: ForcedDie) => void }) {
  return (
    <button
      type="button"
      className={`ps-dice-chip${set ? ' ps-dice-chip-set' : ''}${logMark ? ' ps-dice-chip-log' : ''}`}
      aria-pressed={set}
      title={dieLabel(die, words)}
      onClick={() => onToggle(die)}
    >
      {resultWord(die, words)}{logMark ? ' · log' : ''}
    </button>
  );
}

/** A crit the user forced on the target the die names. */
const critForced = (dice: readonly ForcedDie[], name: DieName): boolean =>
  dice.some(die => die.name.kind === 'crit' && die.name.slot === name.slot && die.name.moveId === name.moveId && die.name.targetSlot === name.targetSlot && 'happens' in die.result && die.result.happens);

function DieRow({ offer, dice, logged, words, target, withMove, rollsOf, onToggle }: DieRowProps) {
  const key = dieKey(offer.name);
  const held = dice.find(die => dieKey(die.name) === key);
  const seen = logged.find(die => dieKey(die.name) === key);
  const caption = captionOf(offer.name, words);
  const label = [
    caption,
    withMove && offer.name.moveId ? `of ${words.move(offer.name.moveId)}` : '',
    target ? `against ${words.slot(target)}` : '',
  ].filter(Boolean).join(' ');
  return (
    <div className="ps-dice-row" role="group" aria-label={label}>
      <span className="ps-dice-caption">{caption}</span>
      {offer.name.kind === 'damage-roll' ? <RollSelect offer={offer} held={held} label={label} words={words} rolls={rollsOf?.(offer.name)} crit={critForced(dice, offer.name)} onToggle={onToggle} /> : offer.results.map(result => {
        const die: ForcedDie = { name: offer.name, result };
        return (
          <Chip
            key={JSON.stringify(result)}
            die={die}
            set={!!held && sameResult(held.result, result)}
            logMark={!!seen && sameResult(seen.result, result)}
            words={words}
            onToggle={onToggle}
          />
        );
      })}
    </div>
  );
}

/** Dice the user has set that the panel does not offer now: chips that read as set, and clear on a click. */
function StrayDice({ dice, words, onToggle }: { dice: readonly ForcedDie[]; words: DieWords; onToggle: (die: ForcedDie) => void }) {
  if (dice.length === 0) return null;
  return (
    <div className="ps-dice-row" role="group" aria-label="Forced dice the move no longer offers">
      {dice.map(die => <Chip key={dieKey(die.name)} die={die} set logMark={false} words={words} onToggle={onToggle} />)}
    </div>
  );
}

export interface SlotDiceProps {
  /** The dice the engine offers for the slot's chosen move; null while the panel asks. */
  offers: DieOffer[] | null;
  /** The slot choice's forced dice that belong to the move. */
  dice: readonly ForcedDie[];
  /** What the log shows for this turn (first turn of a branch). */
  logged: readonly ForcedDie[];
  words: DieWords;
  label: string;
  /** The calculator's damage for each step of the roll of a die's target (the preview computes it for the chosen move). */
  rollsOf?: (name: DieName) => StepDamage | undefined;
  /** The panel edits the slot choice: a die is set, replaced or cleared there. */
  onToggle: (die: ForcedDie) => void;
}

/** The dice of one slot's chosen move: one set of chips per target of a spread move. */
export function SlotDice({ offers, dice, logged, words, label, rollsOf, onToggle }: SlotDiceProps) {
  if (offers === null) return null;
  const offered = new Set(offers.map(offer => dieKey(offer.name)));
  const stray = dice.filter(die => !offered.has(dieKey(die.name)));
  if (offers.length === 0 && stray.length === 0) return null;
  return (
    <div className="ps-dice" role="group" aria-label={`Dice for ${label}`}>
      {chipGroups(offers).map(group => (
        <div key={group.key} className="ps-dice-set">
          {group.offers.map(offer => (
            <DieRow key={dieKey(offer.name)} offer={offer} dice={dice} logged={logged} words={words} target={group.target} rollsOf={rollsOf} onToggle={onToggle} />
          ))}
        </div>
      ))}
      {pullNotes(dice, offers, words).map(note => <div key={note} className="ps-dice-note">{note}</div>)}
      <StrayDice dice={stray} words={words} onToggle={onToggle} />
    </div>
  );
}

export interface TurnDiceProps {
  offers: DieOffer[];
  /** The turn-wide dice set on any slot's choice. */
  dice: readonly ForcedDie[];
  logged: readonly ForcedDie[];
  words: DieWords;
  /** The die goes to the choice of its own slot, which toggles it. */
  onToggle: (die: ForcedDie) => void;
}

const END = 'end-of-turn';

/** Shown in Advanced where the position is only approximated: the offers need the simulator's battle, which the exact position brings (round 82, step A7b). */
export const DICE_WAIT_NOTE = 'Dice need the exact position. They appear once it is ready.';

const SHARED_ROLL_NOTE = 'The game draws this die once per turn for every holder on the field, so a chip here applies to all of them.';

/** The dice of the turn: the order of the actions, then one "End of turn" row per Pokémon. */
export function TurnDice({ offers, dice, logged, words, onToggle }: TurnDiceProps) {
  const order = offers.filter(offer => offer.name.kind === 'speed-tie' || offer.name.kind === 'move-first');
  const end = offers.filter(offer => !TURN_KINDS.has(offer.name.kind) || offer.name.kind === END);
  const offered = new Set(offers.map(offer => dieKey(offer.name)));
  const stray = dice.filter(die => !offered.has(dieKey(die.name)));
  if (offers.length === 0 && stray.length === 0) return null;
  const holders = [...new Set(end.map(offer => offer.name.slot))];
  // a first mover with no chance of its own is the die the game draws once per turn for every holder (Gens 2 and 3)
  const sharedRoll = order.some(offer => offer.name.kind === 'move-first' && offer.chance === undefined);
  return (
    <div className="ps-dice ps-dice-turn" role="group" aria-label="Dice of the turn">
      {order.length > 0 && (
        <div className="ps-dice-set" role="group" aria-label="Move order">
          <div className="ps-dice-heading">Move order</div>
          {order.map(offer => <DieRow key={dieKey(offer.name)} offer={offer} dice={dice} logged={logged} words={words} onToggle={onToggle} />)}
          {sharedRoll && <div className="ps-dice-note">{SHARED_ROLL_NOTE}</div>}
        </div>
      )}
      {holders.map(holder => (
        <div key={holder} className="ps-dice-set" role="group" aria-label={`End of turn for ${words.slot(holder)}`}>
          <div className="ps-dice-heading">End of turn for {words.slot(holder)}</div>
          {end.filter(offer => offer.name.slot === holder).map(offer => (
            <DieRow key={dieKey(offer.name)} offer={offer} dice={dice} logged={logged} words={words} withMove onToggle={onToggle} />
          ))}
        </div>
      ))}
      <StrayDice dice={stray} words={words} onToggle={onToggle} />
    </div>
  );
}
