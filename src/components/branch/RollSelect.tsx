import type { DieOffer, DieWords, ForcedDie } from '@fulllifegames/eval-engine';
import { resultWord } from '../../lib/branch-dice';
import type { StepDamage } from '../../lib/branch-rolls';


const percentOf = (damage: number, maxhp: number): number => (maxhp > 0 ? Math.round(damage / maxhp * 1000) / 10 : 0);

export interface RollSelectProps {
  offer: DieOffer;
  held: ForcedDie | undefined;
  label: string;
  words: DieWords;
  /** The calculator's damage for each step; absent where the calculator gives none (a fixed damage). */
  rolls: StepDamage | undefined;
  crit: boolean;
  onToggle: (die: ForcedDie) => void;
}

function stepText(offer: DieOffer, step: number, words: DieWords, rolls: StepDamage | undefined): string {
  const word = resultWord({ name: offer.name, result: { step } }, words);
  const damage = rolls?.damage[step];
  if (damage === undefined) return word;
  return `${word} · ${percentOf(damage, rolls!.maxhp)}%${damage >= rolls!.hp ? ' · KO' : ''}`;
}

const lowestKo = (rolls: StepDamage | undefined): number | null => {
  const index = rolls ? rolls.damage.findIndex(damage => damage >= rolls.hp) : -1;
  return index < 0 ? null : index;
};

export function RollSelect({ offer, held, label, words, rolls, crit, onToggle }: RollSelectProps) {
  const steps = offer.results.flatMap(result => ('step' in result ? [result.step] : []));
  const value = held && 'step' in held.result ? String(held.result.step) : '';
  const set = (step: number) => onToggle({ name: offer.name, result: { step } });
  const ko = lowestKo(rolls);
  const shortcuts: [string, number | null][] = [['Min', steps[0] ?? null], ['Max', steps.at(-1) ?? null], ['Lowest KO roll', ko]];
  return (
    <>
      <select
        className="ps-input ps-dice-select"
        aria-label={label}
        value={value}
        onChange={event => {
          const step = steps.find(candidate => String(candidate) === event.target.value);
          if (step !== undefined) set(step);
          else if (held) onToggle(held);
        }}
      >
        <option value="">As rolled</option>
        {steps.map(step => <option key={step} value={String(step)}>{stepText(offer, step, words, rolls)}</option>)}
      </select>
      {shortcuts.flatMap(([text, step]) => (step === null ? [] : [(
        <button
          key={text}
          type="button"
          className={`ps-dice-chip${value === String(step) ? ' ps-dice-chip-set' : ''}`}
          aria-pressed={value === String(step)}
          onClick={() => set(step)}
        >
          {text}
        </button>
      )]))}
      {crit && <div className="ps-dice-note">The damages show a crit.</div>}
    </>
  );
}
