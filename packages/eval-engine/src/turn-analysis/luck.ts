import { dexOf, toId, type GameRules } from '@fulllifegames/replay-core';
import type { TurnRolls } from '../dice-events.ts';
import type { EvalResult, MatrixCell } from '../types.ts';
import type { PlayedAction, PlayedTurn } from '../played.ts';
import { matchClickedColumn } from './played-match.ts';
import { rulesOfActives } from './rules.ts';
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
const baseSpeciesIn = (rules: GameRules | undefined) => (species: string): string => (rules ? dexOf(rules).species.get(species).baseSpecies : '') || species;

const atLeastRollChance = (chance: number): boolean => Math.round(chance * 100) >= Math.round(ROLL_MIN_CHANCE * 100);

/** The event a played line's KO odds price: its move and the body (singles: the opposing pre-turn active; doubles: the labeled slot's target). */
function pricedEvent(side: Pick<SideAnalysis, 'played'>, defender: string | null | undefined): { move: string; target: string } | null {
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
function oddsFavor(rolls: TurnRolls, key: Side, side: Pick<SideAnalysis, 'played'>, defender: string | null | undefined, rules: GameRules | undefined): Side | null {
  const event = pricedEvent(side, defender);
  const odds = side.played?.koOdds;
  if (!event || !odds) return null;
  const baseSpecies = baseSpeciesIn(rules);
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
  p1: Pick<SideAnalysis, 'played'>,
  p2: Pick<SideAnalysis, 'played'>,
  actives: AnalyzeTurnParams['actives'],
): { p1: boolean; p2: boolean } {
  const rolled = { ...rolls.favored };
  for (const [key, side] of [['p1', p1], ['p2', p2]] as const) {
    const favored = oddsFavor(rolls, key, side, actives?.[other(key)], rulesOfActives(actives));
    if (favored) rolled[favored] = true;
  }
  return rolled;
}

/** The matrix cell of the pair both sides actually clicked (singles; null when either click or the cell is unknown). */
export function playedCellOf(result: EvalResult, played: PlayedTurn | null | undefined): MatrixCell | null {
  const matrix = result.matrix;
  if (!matrix?.cells || !matrix.p1Choices || !matrix.p2Choices) return null;
  const p1 = matchClickedColumn(result, 'p1', played);
  const p2 = matchClickedColumn(result, 'p2', played);
  const row = p1 ? matrix.p1Choices.indexOf(p1.choice) : -1;
  const column = p2 ? matrix.p2Choices.indexOf(p2.choice) : -1;
  return row >= 0 && column >= 0 ? matrix.cells[row]?.[column] ?? null : null;
}

/** Every move the played pair names, both sides, singles and doubles slots (a switch names none). */
export function playedMoveIds(played: PlayedTurn | null | undefined): string[] {
  if (!played) return [];
  const actions: (PlayedAction | null | undefined)[] = [played.p1, played.p2, ...(played.p1Slots ?? []), ...(played.p2Slots ?? [])];
  return actions.filter((action): action is PlayedAction => action?.kind === 'move').map(action => toId(action.name));
}

/**
 * Round 70 (T217): whether any of the moves carries a secondary effect that may or may not happen: a chance under 100 on a
 * status, a stat change or a flinch (Body Slam's paralysis, Scald's burn, Earth Power's drop), read from the Dex. The planner
 * prices the accuracy and the kill range of a hit and nothing else, so such an effect sits in a cell it calls plain.
 */
function rollsUnpricedEffect(moves: readonly string[], rules: GameRules): boolean {
  const dex = dexOf(rules);
  return moves.some(id => {
    const move = dex.moves.get(id);
    return (move.secondaries ?? (move.secondary ? [move.secondary] : [])).some(effect => (effect.chance ?? 100) < 100);
  });
}

/**
 * Round 69 (T178): what the played cell's outcome classes say about the turn when the turn's protocol is missing. A
 * cell with at least two classes, each weighted strictly between 0 and 1, held a real roll. The classes do not say which
 * way it went, so a rolled cell counts for both sides and the residual's direction is not checked. A cell the planner
 * calls plain ("none") or holds in one class has no PRICED roll (round 70, T217; review finding 4 of round 69: the planner
 * prices the accuracy and the kill range of a hit): it rolled nothing unless a move of the pair carries a secondary effect
 * under 100%, which may have rolled and which `moves` names. Undefined where the planner gave no answer (a doubles cell the
 * search did not plan, fail, a result from before the field) and where such an effect leaves the question open: the
 * sentences keep their ungated form.
 */
export function rolledFromCell(
  cell: MatrixCell | null,
  moves: readonly string[] = [],
  rules?: GameRules,
): { p1: boolean; p2: boolean } | undefined {
  if (!cell || (cell.plan !== 'none' && (cell.plan !== 'events' || !cell.classes))) return undefined;
  const real = (cell.classes ?? []).filter(entry => entry.weight > 0 && entry.weight < 1).length >= 2;
  // Round 75 (T160): without the game's generation the secondary effects cannot be read, and the question stays open.
  if (!real && (!rules || rollsUnpricedEffect(moves, rules))) return undefined;
  return { p1: real, p2: real };
}

/**
 * The sides the turn's rolls favored: the protocol's markers and the played odds when the turn has its log, else the classes
 * of the played cell. Undefined where neither answers. The sides enter as their matched played lines, so the sack gates can
 * ask before the side records exist (round 79, hazard sack).
 */
export function turnRolledFor(
  params: AnalyzeTurnParams,
  p1: Pick<SideAnalysis, 'played'>,
  p2: Pick<SideAnalysis, 'played'>,
): { p1: boolean; p2: boolean } | undefined {
  return params.rolls
    ? rolledSides(params.rolls, p1, p2, params.actives)
    : rolledFromCell(playedCellOf(params.result, params.played), playedMoveIds(params.played), rulesOfActives(params.actives));
}

/** The turn's residual has a roll behind it in its own direction; null without the turn's dice or a residual. */
export function chanceRolled(analysis: Pick<TurnAnalysis, 'chanceDelta' | 'rolledFor'>): boolean | null {
  if (!analysis.rolledFor || analysis.chanceDelta === null) return null;
  return analysis.chanceDelta !== 0 && analysis.rolledFor[analysis.chanceDelta > 0 ? 'p1' : 'p2'];
}

/** The game's luck ledger in two parts (p1 perspective): the chance of turns with a roll in its direction, and the rest. */
export interface LuckSplit {
  rolled: number;
  reRead: number;
}

/**
 * The ledger split over the same turns as the report's chanceTotal
 * (resolution turns stay out). Null unless every turn carries its rolls:
 * without the protocol the report keeps the marker anchor's gates.
 */
export function luckSplit(known: TurnAnalysis[], resolution: ReadonlySet<number>): LuckSplit | null {
  if (known.length === 0 || known.some(analysis => analysis.rolledFor === undefined)) return null;
  const split = { rolled: 0, reRead: 0 };
  for (const analysis of known) {
    if (resolution.has(analysis.turn) || analysis.chanceDelta === null) continue;
    if (chanceRolled(analysis)) split.rolled += analysis.chanceDelta;
    else split.reRead += analysis.chanceDelta;
  }
  return split;
}

/** The share of the ledger the rolls must hold, the ledger's way, before the report says the rolls decided it. */
export const ROLLS_CARRY_SHARE = 0.5;

/** The rolls carry the ledger: the rolled part points the ledger's way and holds at least ROLLS_CARRY_SHARE of it. */
export const rollsCarry = (chanceTotal: number, split: LuckSplit): boolean =>
  chanceTotal !== 0 && Math.sign(split.rolled) === Math.sign(chanceTotal) &&
  Math.abs(split.rolled) >= ROLLS_CARRY_SHARE * Math.abs(chanceTotal);

/** The luck claims' marker anchor: the chance ledger summed over the dice-event turns only (resolution excluded). */
export function diceAnchorFor(
  known: TurnAnalysis[],
  diceTurns: ReadonlySet<number> | null,
  resolution: ReadonlySet<number>,
): number | null {
  if (diceTurns === null) return null;
  return known.reduce((sum, analysis) =>
    sum + (diceTurns.has(analysis.turn) && !resolution.has(analysis.turn) ? analysis.chanceDelta ?? 0 : 0), 0);
}
