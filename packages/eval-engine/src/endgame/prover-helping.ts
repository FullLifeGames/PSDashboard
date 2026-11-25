import type { Battle } from '@pkmn/sim';
import { sideIndex } from '@fulllifegames/replay-core';
import type { CellEvent } from '../cell-blend.ts';
import { splitOutcome } from '../search/secondary-classes.ts';
import type { EndgameChildren } from './children.ts';
import { positionBattle } from '../forward-model.ts';
import type { Side } from './prover-order.ts';
import { foeReadsStages } from './stage-readers.ts';
import { stageReading } from './board-facts.ts';

// A secondary that only helps the mover takes the proof of the class without it; read from realized state, no names.

/** A class key `${order}:${outcomes}` split at the first colon (an effect id holds one: `hit-nokill+boosts:spd`). */
export function splitClassKey(key: string): { order: string; outcomes: string[] } | null {
  const cut = key.indexOf(':');
  return cut < 0 ? null : { order: key.slice(0, cut), outcomes: key.slice(cut + 1).split('|') };
}

/** The fired position is the unfired one with the mover's stages up, the foe's down, no Speed stage, nothing else. */
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

const tokensOf = (outcome: string, event: CellEvent): string[] => splitOutcome(outcome, event.secondary).tokens;

/** Per child, the index of the child whose proof it takes over, or -1 when proven on its own; plain cells take none. */
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
