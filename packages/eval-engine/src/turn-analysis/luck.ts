import { dexOf, toId, type GameRules } from '@fulllifegames/replay-core';
import type { TurnRolls } from '../dice-events.ts';
import type { EvalResult, MatrixCell } from '../types.ts';
import type { PlayedAction, PlayedTurn } from '../played.ts';
import { matchClickedColumn } from './played-match.ts';
import { rulesOfActives } from './rules.ts';
import type { AnalyzeTurnParams, Side, SideAnalysis, TurnAnalysis } from './types.ts';

/** A KO roll counts as rolled when the other outcome had at least this chance, in whole percents as the cards print. */
export const ROLL_MIN_CHANCE = 0.1;

const other = (side: Side): Side => (side === 'p1' ? 'p2' : 'p1');

const baseSpeciesIn = (rules: GameRules | undefined) => (species: string): string => (rules ? dexOf(rules).species.get(species).baseSpecies : '') || species;

const atLeastRollChance = (chance: number): boolean => Math.round(chance * 100) >= Math.round(ROLL_MIN_CHANCE * 100);

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

// A knock-out favors the attacker, a surviving hit the body's side, each only when the other outcome was a real chance;
// null when the event did not happen (a miss is a marker; a switch-out, a Protect or an unreached body is no roll).
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

/** The sides the turn's rolls favored: dice markers, then played KO odds; a doubles partner slot adds no odds roll. */
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

/** The matrix cell of the pair both sides clicked (singles); null when either click or the cell is unknown. */
export function playedCellOf(result: EvalResult, played: PlayedTurn | null | undefined): MatrixCell | null {
  const matrix = result.matrix;
  if (!matrix?.cells || !matrix.p1Choices || !matrix.p2Choices) return null;
  const p1 = matchClickedColumn(result, 'p1', played);
  const p2 = matchClickedColumn(result, 'p2', played);
  const row = p1 ? matrix.p1Choices.indexOf(p1.choice) : -1;
  const column = p2 ? matrix.p2Choices.indexOf(p2.choice) : -1;
  return row >= 0 && column >= 0 ? matrix.cells[row]?.[column] ?? null : null;
}

export function playedMoveIds(played: PlayedTurn | null | undefined): string[] {
  if (!played) return [];
  const actions: (PlayedAction | null | undefined)[] = [played.p1, played.p2, ...(played.p1Slots ?? []), ...(played.p2Slots ?? [])];
  return actions.filter((action): action is PlayedAction => action?.kind === 'move').map(action => toId(action.name));
}

// The planner prices accuracy and kill range only: a secondary effect under 100 % sits in a cell it calls plain.
function rollsUnpricedEffect(moves: readonly string[], rules: GameRules): boolean {
  const dex = dexOf(rules);
  return moves.some(id => {
    const move = dex.moves.get(id);
    return (move.secondaries ?? (move.secondary ? [move.secondary] : [])).some(effect => (effect.chance ?? 100) < 100);
  });
}

/** Without the protocol: two classes weighted strictly between 0 and 1 held a roll, counted for both sides. */
export function rolledFromCell(
  cell: MatrixCell | null,
  moves: readonly string[] = [],
  rules?: GameRules,
): { p1: boolean; p2: boolean } | undefined {
  if (!cell || (cell.plan !== 'none' && (cell.plan !== 'events' || !cell.classes))) return undefined;
  const real = (cell.classes ?? []).filter(entry => entry.weight > 0 && entry.weight < 1).length >= 2;
  if (!real && (!rules || rollsUnpricedEffect(moves, rules))) return undefined;
  return { p1: real, p2: real };
}

/** Protocol markers and played odds, else the played cell's classes; undefined where neither answers. */
export function turnRolledFor(
  params: AnalyzeTurnParams,
  p1: Pick<SideAnalysis, 'played'>,
  p2: Pick<SideAnalysis, 'played'>,
): { p1: boolean; p2: boolean } | undefined {
  return params.rolls
    ? rolledSides(params.rolls, p1, p2, params.actives)
    : rolledFromCell(playedCellOf(params.result, params.played), playedMoveIds(params.played), rulesOfActives(params.actives));
}

/** The residual has a roll behind it in its own direction; null without the turn's dice or a residual. */
export function chanceRolled(analysis: Pick<TurnAnalysis, 'chanceDelta' | 'rolledFor'>): boolean | null {
  if (!analysis.rolledFor || analysis.chanceDelta === null) return null;
  return analysis.chanceDelta !== 0 && analysis.rolledFor[analysis.chanceDelta > 0 ? 'p1' : 'p2'];
}

/** The game's luck ledger from p1's view: the chance of turns with a roll in its direction, and the rest. */
export interface LuckSplit {
  rolled: number;
  reRead: number;
}

/** Over the same turns as the report's chanceTotal; null unless every turn carries its rolls. */
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

export const ROLLS_CARRY_SHARE = 0.5;

export const rollsCarry = (chanceTotal: number, split: LuckSplit): boolean =>
  chanceTotal !== 0 && Math.sign(split.rolled) === Math.sign(chanceTotal) &&
  Math.abs(split.rolled) >= ROLLS_CARRY_SHARE * Math.abs(chanceTotal);

export function diceAnchorFor(
  known: TurnAnalysis[],
  diceTurns: ReadonlySet<number> | null,
  resolution: ReadonlySet<number>,
): number | null {
  if (diceTurns === null) return null;
  return known.reduce((sum, analysis) =>
    sum + (diceTurns.has(analysis.turn) && !resolution.has(analysis.turn) ? analysis.chanceDelta ?? 0 : 0), 0);
}
