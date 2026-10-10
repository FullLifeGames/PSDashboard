import { Dex } from '@pkmn/dex';
import { toId } from '@fulllifegames/replay-core';
import type { TurnRolls } from '../dice-events.ts';
import type { AnalyzeTurnParams, Side, SideAnalysis, TurnAnalysis } from './types.ts';

/**
 * Round 67 (T22 stage a): the luck ledger in two parts, what the turn rolled
 * and what the engine re-read. The chance residual (scoreAfter minus the
 * played pair's value) holds both: since the tree runs from the first turn,
 * most of it is the next root pricing the position differently from the
 * played cell (649664 t12: the only roll, a 90% High Jump Kick, went the
 * other way). A turn rolled for a side when a protocol dice marker favored
 * it, or when a played line's KO odds came out its way on the body they
 * priced; display only, the attribution and every number stay. Pure, the
 * Dex is data only.
 */

/**
 * A KO roll counts as rolled when the other outcome had at least this
 * chance on the played odds, in the whole percents the cards print: a 90%
 * hit that knocks out counts, a 4% kill range that does not kill is none.
 */
export const ROLL_MIN_CHANCE = 0.1;

const other = (side: Side): Side => (side === 'p1' ? 'p2' : 'p1');

/** Formes of one species are one body (Medicham and Medicham-Mega), read from the Dex. */
const baseSpecies = (species: string): string => Dex.species.get(species).baseSpecies || species;

const atLeastRollChance = (chance: number): boolean => Math.round(chance * 100) >= Math.round(ROLL_MIN_CHANCE * 100);

/** The event a played line's KO odds price: its move and the body (singles: the opposing pre-turn active; doubles: the labeled slot's target). */
function pricedEvent(side: SideAnalysis, defender: string | null | undefined): { move: string; target: string } | null {
  const odds = side.played?.koOdds;
  if (!side.played || !odds) return null;
  if (odds.label) {
    const [move, target] = odds.label.split('→');
    return target ? { move: toId(move), target } : null;
  }
  const move = side.played.choice.match(/^move (\S+)/)?.[1];
  return move && defender ? { move, target: defender } : null;
}

/**
 * The side a played line's KO odds favored, as the protocol shows the event
 * on the body they priced: the knock-out favors the attacker, a hit the body
 * survived favors the body's side, each only when the other outcome was a
 * real chance. Null when the event did not happen (a miss is a marker; a
 * switch-out, a Protect or an unreached body is no roll).
 */
function oddsFavor(rolls: TurnRolls, key: Side, side: SideAnalysis, defender: string | null | undefined): Side | null {
  const event = pricedEvent(side, defender);
  const odds = side.played?.koOdds;
  if (!event || !odds) return null;
  const hit = rolls.hits.find(entry =>
    entry.side === key && entry.move === event.move && baseSpecies(entry.target) === baseSpecies(event.target));
  if (!hit) return null;
  if (hit.ko) return atLeastRollChance(1 - odds.accuracy * odds.killFraction) ? key : null;
  return atLeastRollChance(odds.killFraction) ? other(key) : null;
}

/**
 * The sides the turn's rolls favored: the protocol's dice markers, then each
 * played line's KO odds as they came out. Doubles: an option's odds belong
 * to its labeled slot (round 56), so the partner slot adds no odds-based
 * roll; its markers count like any other.
 */
export function rolledSides(
  rolls: TurnRolls,
  p1: SideAnalysis,
  p2: SideAnalysis,
  actives: AnalyzeTurnParams['actives'],
): { p1: boolean; p2: boolean } {
  const rolled = { ...rolls.favored };
  for (const [key, side] of [['p1', p1], ['p2', p2]] as const) {
    const favored = oddsFavor(rolls, key, side, actives?.[other(key)]);
    if (favored) rolled[favored] = true;
  }
  return rolled;
}

/** The turn's residual has a roll behind it in its own direction; null without the turn's dice or a residual. */
export function chanceRolled(analysis: Pick<TurnAnalysis, 'chanceDelta' | 'rolledFor'>): boolean | null {
  if (!analysis.rolledFor || analysis.chanceDelta === null) return null;
  return analysis.chanceDelta !== 0 && analysis.rolledFor[analysis.chanceDelta > 0 ? 'p1' : 'p2'];
}
