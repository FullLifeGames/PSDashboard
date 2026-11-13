import type { Battle } from '@pkmn/sim';
import { sideIndex } from '@fulllifegames/replay-core';
import type { CellEvent } from '../cell-blend.ts';
import { splitOutcome } from '../search/secondary-classes.ts';
import type { EndgameChildren } from './children.ts';
import { positionBattle } from '../forward-model.ts';
import type { Side } from './prover-order.ts';
import { foeReadsStages } from './stage-readers.ts';
import { stageReading } from './board-facts.ts';

/**
 * Round 88 (T336, #72): a class in which a secondary effect fired inherits the proof of the class in which it did not, when the
 * effect only helps the side that moved. Round 86 (T305) made every secondary a class of its own (`hit-nokill+boosts:spd`), so the
 * proof split a 10 percent Special Defense drop into a second position at every turn and a twelve-turn chain needed 163 cells.
 *
 * The rule reads what the cell realized, never a name: the class draws are real simulator positions, so the fired child and the
 * unfired child of one cell differ by exactly what the effect did in this position. The effect only helps the mover when the two
 * positions are the same except that the mover's stats are higher and the foe's are lower (the boosts that landed), and no Speed
 * stage moved (Trick Room, Gyro Ball and Electro Ball turn a slower foe into a gain for it). A reaction shows as a difference of
 * another kind: Defiant, Competitive and Contrary move a stage the other way, Mirror Armor moves the user's stage, Eject Pack and
 * White Herb use up the item, Mirror Herb and Opportunist copy the gain, a Clear Body that blocks the drop leaves nothing to
 * compare. Any such difference and the classes keep their own proofs, as before.
 *
 * The rule holds for one turn of realized state; a later move of the foe can read the stages it moved. So the fired class takes nothing
 * over while a living body of the foe's side (the bench too) can click a move the simulator shows to read or move stages: Foul Play,
 * Punishment, Psych Up, Spectral Thief, Topsy-Turvy, the Swap moves (stage-readers.ts, a census played on a twin battle per move).
 */

/** A class key `${order}:${outcomes}` split at its first colon (an effect id holds one itself: `hit-nokill+boosts:spd`). */
export function splitClassKey(key: string): { order: string; outcomes: string[] } | null {
  const cut = key.indexOf(':');
  return cut < 0 ? null : { order: key.slice(0, cut), outcomes: key.slice(cut + 1).split('|') };
}

/**
 * Whether the fired position is the unfired one with the mover's stat stages up and the foe's down and nothing else changed, no
 * Speed stage among them. Reads two battles, writes neither (the specs hold it with `fingerprint`).
 */
export function onlyHelpsMover(unfired: Battle, fired: Battle, mover: Side): boolean {
  const before = stageReading(unfired);
  const after = stageReading(fired);
  if (before.rest !== after.rest) return false;
  const own = sideIndex(mover);
  return before.boosts.every((bodies, side) => bodies.every((was, body) => {
    const now = after.boosts[side][body];
    return [...new Set([...Object.keys(was), ...Object.keys(now)])].every(stat => {
      const change = (now[stat] ?? 0) - (was[stat] ?? 0);
      if (stat === 'spe') return change === 0;
      return side === own ? change >= 0 : change <= 0;
    });
  }));
}

/** The effects a class outcome names, read against the entries of the event it belongs to. */
const tokensOf = (outcome: string, event: CellEvent): string[] => splitOutcome(outcome, event.secondary).tokens;

/**
 * For each child of a class cell, the index of the child whose proof it takes over, or -1 when it is proven on its own. A child
 * takes over the proof of a drawn sibling of the same order that differs in the mover's one event only: the sibling is a hit that
 * does not kill with fewer of the effects, and the realized positions say the extra effects only helped the mover. Plain cells and
 * a cell with a child that has no class key (the plain path) take nothing over. The relation follows strictly fewer effects, so
 * the chain of sources ends.
 */
export function helpedSources(cell: Pick<EndgameChildren, 'children' | 'events'>, side: Side): number[] {
  const sources = cell.children.map(() => -1);
  const parsed = cell.children.map(child => (child.key === undefined ? null : splitClassKey(child.key)));
  cell.children.forEach((child, index) => {
    const mine = parsed[index];
    if (!mine || mine.outcomes.length !== cell.events.length) return;
    let best = -1;
    let fewest = Infinity;
    cell.children.forEach((sibling, other) => {
      const theirs = parsed[other];
      if (other === index || !theirs || theirs.order !== mine.order || theirs.outcomes.length !== mine.outcomes.length) return;
      const differing = mine.outcomes.flatMap((outcome, at) => (outcome === theirs.outcomes[at] ? [] : [at]));
      if (differing.length !== 1) return;
      const event = cell.events[differing[0]];
      if (event.side !== side) return;
      const [fired, plain] = [splitOutcome(mine.outcomes[differing[0]], event.secondary), splitOutcome(theirs.outcomes[differing[0]], event.secondary)];
      const extra = tokensOf(mine.outcomes[differing[0]], event).filter(token => !tokensOf(theirs.outcomes[differing[0]], event).includes(token));
      if (fired.base !== 'hit-nokill' || plain.base !== 'hit-nokill' || extra.length === 0 || extra.length !== fired.tokens.length - plain.tokens.length) return;
      if (plain.tokens.length >= fewest) return;
      const firedBattle = positionBattle(child.position);
      if (foeReadsStages(firedBattle, side) || !onlyHelpsMover(positionBattle(sibling.position), firedBattle, side)) return;
      [best, fewest] = [other, plain.tokens.length];
    });
    sources[index] = best;
  });
  for (let index = 0; index < sources.length; index++) {
    for (let hops = 0; sources[index] >= 0 && sources[sources[index]] >= 0 && hops < sources.length; hops++) sources[index] = sources[sources[index]];
  }
  return sources;
}
