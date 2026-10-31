import type { Battle } from '@pkmn/sim';
import { applied, otherwise, parts, slotOfIdent, type Witness } from './report-lines.ts';
import type { ReportInput } from './report.ts';
import type { DieReport } from './types.ts';

/**
 * Round 82 (forced dice), step A4: the witnesses of the dice an ability or an item draws: the procs of a hit (a contact
 * ability, Cursed Body, Poison Touch, Toxic Chain, Effect Spore, the Focus Band) and the end of the turn (Shed Skin, Harvest,
 * Healer, the Gen 2 thaw). Each reads the lines between the die's draw and the next draw of any die; the protocol writes the
 * effect with the ability's or the item's own name (`[from] ability: Static`, `-activate|...|item: Focus Band`), a thaw as a
 * `-curestatus` of the holder.
 *
 * - yes: a line shows the effect; none is `blocked` (the draw ran and said yes, and a rule of the target stopped it: immunity,
 *   a status it already has, a hit that was not lethal).
 * - no: no line shows it; a line that does is `no-chance`.
 * - a result that is a status word (Effect Spore): the status the effect's line names equals the word.
 */

/** The kinds whose lines end at the next draw, not at the next action. */
export const SPAN_KINDS: ReadonlySet<string> = new Set(['ability-proc', 'item-proc', 'end-of-turn']);

/** The label the protocol writes for the effect, read from the battle's own Dex: `ability: Static`, `item: Focus Band`, or null for a condition. */
function labelOf(battle: Battle, id: string): string | null {
  const ability = battle.dex.abilities.get(id);
  if (ability.exists) return `ability: ${ability.name}`;
  const item = battle.dex.items.get(id);
  return item.exists ? `item: ${item.name}` : null;
}

/**
 * The lines that show the effect: its label in a line, a `-status` line (the sleep of Gens 3 and 4 is written without the ability's
 * label, and the window holds no other die's lines), or, for a condition, the `-curestatus` of the holder.
 */
function shownBy(w: Witness, battle: Battle): string[] {
  const { slot, effectId = '' } = w.die.name;
  const id = effectId.replace(/:option$/, '');
  const label = labelOf(battle, id);
  return w.action.filter(line => parts(line)[1] === '-status' || (label ? line.includes(label) : parts(line)[1] === '-curestatus' && slotOfIdent(parts(line)[2]) === slot && parts(line)[3] === id));
}

/** The status the effect's line names (`|-status|p1a: X|par|[from] ability: Static`), or null. */
const statusOf = (lines: readonly string[]): string | null => {
  const line = lines.find(candidate => parts(candidate)[1] === '-status');
  return line ? parts(line)[3] : null;
};

export function procReport(w: Witness, battle: Battle): DieReport {
  const { result } = w.die;
  const shown = shownBy(w, battle);
  const id = w.die.name.effectId?.replace(/:option$/, '') ?? '';
  if ('option' in result) {
    const word = statusOf(shown);
    if (word === result.option) return applied(w);
    return otherwise(w, 'blocked', word ? `${id} gave ${word}, not ${result.option}` : `no status of ${id} followed the draw: a rule of the target stopped it`);
  }
  const happens = 'happens' in result && result.happens;
  if (happens) {
    return shown.length > 0 ? applied(w) : otherwise(w, 'blocked', `the draw said yes but no line of ${id} followed: a rule of the target or the hit stopped it`);
  }
  return shown.length === 0 ? applied(w) : otherwise(w, 'no-chance', `${id} showed although the die said no`);
}

/** Why a die of the end of the turn was never drawn: the holder had nothing for the effect to do this turn. */
export function endNoDraw(input: ReportInput): DieReport {
  const { die } = input;
  const { slot, effectId = '', targetSlot } = die.name;
  const named = labelOf(input.battle, effectId)?.replace(/^\w+: /, '') ?? effectId;
  return { die, took: 'no-draw', reason: `the simulator drew no end-of-turn die of ${named} for ${slot}${targetSlot ? ` and ${targetSlot}` : ''} this turn: nothing for it to do` };
}
