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
 * A class in which a secondary effect fired inherits the proof of the class in which it did not, when the effect only helps the side that
 * moved (without it a 10 percent Special Defense drop splits every turn into a second position). The rule reads what the cell realized,
 * never a name: the two class positions differ by exactly what the effect did. It only helps the mover when the positions are the same
 * except that the mover's stats are higher and the foe's lower, and no Speed stage moved (Trick Room, Gyro Ball and Electro Ball turn
 * a slower foe into a gain for it). A reaction shows as another difference (Defiant, Competitive, Contrary, Mirror Armor, Eject Pack, White
 * Herb, Mirror Herb, Opportunist, a Clear Body that blocks the drop) and the classes keep their own proofs. The rule holds for one turn of
 * realized state, so the fired class takes nothing over while a living body of the foe's side (the bench too) can click a move that reads
 * or moves stages (`stage-readers.ts`).
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
 * For each child of a class cell, the index of the child whose proof it takes over, or -1 when it is proven on its own. A child takes
 * over a drawn sibling of the same order that differs in the mover's one event only: a hit that does not kill with fewer of the effects,
 * where the realized positions say the extra effects only helped the mover. Plain cells take nothing over; the relation follows strictly
 * fewer effects, so the chain of sources ends.
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
