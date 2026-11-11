import type { Battle, PRNGSeed } from '@pkmn/sim';
import { positionBattle, type SimPosition } from '../forward-model.ts';
import { BOUNDARY_DRAW_BUDGET, type CellEvent } from '../cell-blend.ts';
import { SEARCH_SEEDS } from '../search/leaf.ts';
import { cellSeeds } from '../search/root-quantile.ts';
import { classChildren, drawChild, median, totalHp, type Draw } from '../search/outcome-children.ts';
import { createMatchupCache } from '../eval-function.ts';
import { battleRuleset } from '../forward/ruleset.ts';
import { drawPair } from '../pair/draw.ts';
import { forkBattle, toPosition } from '../forward/position.ts';
import { applyChoice, resolveForcedSwitches } from '../forward/switches.ts';
import { flipTurn, recordTurn, type FlipTurn } from '../dice/flip.ts';
import { tieName, type ForcedDie } from '../dice/types.ts';
import { boardFacts } from './board-facts.ts';

/**
 * One matrix cell's children for the endgame solver (round 34): chance
 * priced as outcome classes with analytic weights, one representative
 * child per class, and a plain median child where no class plan exists.
 * Round 43: the class path lives in search/outcome-children.ts and draws
 * a class the base seeds never showed on demand (scripted dice) instead
 * of chasing it with probe seeds; `missing` now means the sim refused the
 * class (calc/sim disagreement) or the forced cap was reached. Round 35:
 * `share` keeps the analytic weight for the prover, `plain` marks the
 * median path. Round 89 (#60): every seed is a slot of the cell's own list (`cellSeeds`), the matrix's slots; the base count stays 5.
 */
interface EndgameChild {
  position: SimPosition;
  /** Weight normalized over the drawn classes (the solver's blend). */
  weight: number;
  /** Analytic class weight before that normalization (the prover's mass); 1 on the plain path. */
  share: number;
  ended: boolean;
  /** Group key `${order}:${classKey}` on the class path; absent on the plain path. */
  key?: string;
}
export interface EndgameChildren {
  children: EndgameChild[];
  unpriced: boolean;
  /** True when the plain (median) path ran. */
  plain: boolean;
  /** Plain path only: the draws disagreed on damage, faints, or the end (chance moved the cell). */
  spread: boolean;
  /** Class path: the expected classes no draw showed, with their analytic share (round 35: the prover inherits proofs across dominated classes). */
  missing: { key: string; share: number }[];
  /** Class path: the cell's priced events, in the order the class keys join their outcomes. */
  events: CellEvent[];
}

/**
 * Round 89 (A5f-5, ruling 20): the draws of the plain path for a damaging pair, one table for both game types. A proof books a plain
 * cell only when every draw agrees, so the count is the proof's confidence in the cell's dice. Doubles take five: every doubles
 * cell prices through this path, and A5f-3 measured five draws on the doubles holdouts (+0.1 to +0.2 % forks per family, 20 of 89
 * sampled proofs gone, 1 added, 1 of the 3 proofs for the side that lost its game gone). Singles keep three because nobody has
 * measured another count there, and a singles cell takes the plain path only where the class plan refuses it (a stalling move, an
 * effect without a class). `cellSeeds` holds 16 seeds, so the table stays under that.
 */
export const PLAIN_DRAWS = { singles: 3, doubles: 5 } as const;

/** The draws a damaging pair takes on this battle's plain path. */
export const plainDrawCount = (battle: Battle): number => (battle.gameType === 'singles' ? PLAIN_DRAWS.singles : PLAIN_DRAWS.doubles);

/** Whether either choice names a damaging move (base power, fixed damage, or OHKO). */
function damagingPair(battle: Battle, p1Choice: string, p2Choice: string): boolean {
  return [p1Choice, p2Choice].some(choice => choice.split(',').some(part => {
    const tokens = part.trim().split(' ');
    if (tokens[0] !== 'move') return false;
    const move = battle.dex.moves.get(tokens[1]);
    return move.exists && (move.basePower > 0 || Boolean(move.damage) || Boolean(move.ohko));
  }));
}

/** One group of plain draws: its median child, whether the draws disagree on faints or the end (unpriced) or on damage (spread). */
function plainGroup(draws: Draw[]): { draws: Draw[]; pick: Draw; index: number; unpriced: boolean; spread: boolean } {
  const unpriced = draws.some(draw => draw.fainted !== draws[0].fainted || draw.ended !== draws[0].ended);
  const pick = median(draws);
  return { draws, pick, index: draws.indexOf(pick), unpriced, spread: unpriced || draws.some(draw => draw.measure !== draws[0].measure) };
}

/**
 * Round 67 (T114): whether a doubles pair's first draw shuffled a speed tie
 * among its move actions, read off the pair plan's recording dice. Singles
 * pairs price their ties on the class path (outcome-children.ts speedTie).
 */
function doublesTie(root: SimPosition, battle: Battle, p1Choice: string, p2Choice: string): boolean {
  if (battle.gameType === 'singles') return false;
  return drawPair(root, p1Choice, p2Choice, cellSeeds(root, p1Choice, p2Choice)[0], new Map(), createMatchupCache(battleRuleset(battle))).records
    .some(record => record.kind === 'tie');
}

/** One cell's turn on a seed: the choices, then the forced switches, as `advancePositionWithLog` plays them (the dice module's `FlipTurn`). */
function cellTurn(root: SimPosition, p1Choice: string, p2Choice: string, seed: PRNGSeed, ties?: readonly ForcedDie[]): FlipTurn {
  return {
    fork: () => forkBattle(root, seed),
    play: battle => {
      applyChoice(battle, 'p1', p1Choice);
      applyChoice(battle, 'p2', p2Choice);
      resolveForcedSwitches(battle, seed, { p1: p1Choice.split(' > ')[1], p2: p2Choice.split(' > ')[1] });
    },
    ties,
  };
}

/** What one group of plain draws prices as: children with the simulator's own chances, or nothing (unpriced). */
interface PricedGroup { children: { position: SimPosition; share: number; ended: boolean }[]; unpriced: boolean; spread: boolean }

/**
 * Round 89 (A6-2, ruling 24, #145): a plain group counts as certain only for the dice it cannot price, the roll facts (the damage roll,
 * the crit, the hit count). The median draw's turn is recorded and each chance die it drew, with a chance strictly between 0 and 1,
 * is played once the other way (`dice/flip.ts`, the other dice held to the recorded answers). A flip that changes the board facts
 * (`endgame/board-facts.ts`: the memo key without the roll fields and the turn's bookkeeping) is a child whose share is the simulator's
 * own chance of that answer (`randomChance(33, 100)`, one in three for a second Protect), and the recorded turn keeps the product of
 * the chances it drew. Two dice turned together are not played: their share leaves the mass, as a missing class does on the class
 * path. A flip that changes nothing is dropped. Every draw of the group must land on the facts of one child: a draw that lands on
 * none (a damage roll that decides a Berry, Moody's pick, a sleep's length, a random target) leaves a die no child prices, and the
 * group is unpriced, as a split of the faints is. Round 89 (A6-3a): so is a group whose turn drew one die more than once (a contact
 * proc on each hit of a two-hit move, a secondary on each hit): the recorder lists it under `repeated`, and no single chance prices it.
 */
function pricedGroup(turn: FlipTurn, draws: Draw[], spread: boolean): PricedGroup {
  const recorded = recordTurn(turn);
  const base = boardFacts(recorded.battle);
  const deciding = recorded.dice.flatMap(die => {
    const flipped = flipTurn(turn, recorded, die);
    return flipped.took && boardFacts(flipped.battle) !== base ? [{ die, battle: flipped.battle }] : [];
  });
  const held = deciding.reduce((product, entry) => product * entry.die.held, 1);
  const children = [{ position: toPosition(recorded.battle), share: held, ended: recorded.battle.ended }];
  for (const { die, battle } of deciding) children.push({ position: toPosition(battle), share: (held / die.held) * die.other, ended: battle.ended });
  const facts = new Set([base, ...deciding.map(entry => boardFacts(entry.battle))]);
  const unexplained = draws.some(draw => !facts.has(boardFacts(positionBattle(draw.position))));
  // Round 89 (A6-3a, ruling 27.2): a die the turn drew more than once has no single price (the flip turns every draw of it), so no proof runs through the group
  return { children, unpriced: unexplained || recorded.repeated.length > 0, spread: spread || deciding.length > 0 };
}

/** The pairs a speed tie holds to one side going first: every cross pair of the slots a natural turn tied. */
function heldTies(tied: string[][], first: 'p1' | 'p2'): ForcedDie[] {
  const dice = new Map<string, ForcedDie>();
  for (const slots of tied) {
    for (const a of slots.filter(slot => slot.startsWith(first))) {
      for (const b of slots.filter(slot => !slot.startsWith(first))) dice.set(`${a}|${b}`, { name: tieName(a, b), result: { first: a } });
    }
  }
  return [...dice.values()];
}

/**
 * The plain path: the median of `PLAIN_DRAWS` draws (three in singles, five in doubles) for damaging pairs, one draw
 * otherwise. Round 67 (T114): a doubles pair whose order a speed tie decides
 * prices each order as a child of half the weight (the scripted dice put one
 * side's move actions first): the fixed draws resolved doubles-ohko-tie
 * alike, and the prover proved a coin flip with mass 1. Round 89 (A6-2): inside each order (or the one order of a pair without a
 * tie) the group prices its chance dice (`pricedGroup`); a group whose draws split the faints or the end stays unpriced as before.
 */
function plainChildren(root: SimPosition, battle: Battle, rootHp: number, p1Choice: string, p2Choice: string): EndgameChildren {
  const count = damagingPair(battle, p1Choice, p2Choice) ? plainDrawCount(battle) : 1;
  const seeds = cellSeeds(root, p1Choice, p2Choice).slice(0, count);
  // the tie path draws on a natural turn's ties; a pair whose recorded turn names no tie to hold plays as a pair without one
  const tied = doublesTie(root, battle, p1Choice, p2Choice) ? recordTurn(cellTurn(root, p1Choice, p2Choice, seeds[0])).ties : [];
  if (tied.length > 0) {
    const orders = (['p1', 'p2'] as const).map(first => {
      const group = plainGroup(seeds.map(seed => drawChild(root, rootHp, p1Choice, p2Choice, seed, { scripts: new Map([[`${first}:tie`, { first }]]) })));
      if (group.unpriced) return { children: [{ position: group.pick.position, share: 1, ended: group.pick.ended }], unpriced: true, spread: true };
      return pricedGroup(cellTurn(root, p1Choice, p2Choice, seeds[group.index], heldTies(tied, first)), group.draws, group.spread);
    });
    const children = orders.flatMap(order => {
      const total = order.children.reduce((sum, child) => sum + child.share, 0);
      return order.children.map(child => ({ position: child.position, weight: (0.5 * child.share) / total, share: 0.5 * child.share, ended: child.ended }));
    });
    return { children, unpriced: orders.some(order => order.unpriced), plain: true, spread: orders.some(order => order.spread), missing: [], events: [] };
  }
  const group = plainGroup(seeds.map(seed => drawChild(root, rootHp, p1Choice, p2Choice, seed)));
  const { pick, unpriced, spread } = group;
  if (unpriced) return { children: [{ position: pick.position, weight: 1, share: 1, ended: pick.ended }], unpriced, plain: true, spread, missing: [], events: [] };
  const priced = pricedGroup(cellTurn(root, p1Choice, p2Choice, seeds[group.index]), group.draws, spread);
  const total = priced.children.reduce((sum, child) => sum + child.share, 0);
  const children = priced.children.map(child => ({ position: child.position, weight: child.share / total, share: child.share, ended: child.ended }));
  return { children, unpriced: priced.unpriced, plain: true, spread: priced.spread, missing: [], events: [] };
}

/**
 * `drawBudget` caps the forced draws a class cell may take for classes the
 * base seeds never showed (the root blend's BOUNDARY_DRAW_BUDGET by
 * default; the prover passes less and leaves rare classes open).
 */
export function endgameChildren(root: SimPosition, p1Choice: string, p2Choice: string, drawBudget = BOUNDARY_DRAW_BUDGET): EndgameChildren {
  const battle = positionBattle(root);
  const classes = classChildren(root, p1Choice, p2Choice, { baseSeeds: cellSeeds(root, p1Choice, p2Choice).slice(0, SEARCH_SEEDS.length), forcedCap: drawBudget });
  if (classes) {
    const children = classes.children.map(child => ({ position: child.position, weight: child.weight, share: child.share, ended: child.ended, key: child.key }));
    return { children, unpriced: classes.missing.length > 0, plain: false, spread: false, missing: classes.missing, events: classes.events };
  }
  return plainChildren(root, battle, totalHp(battle), p1Choice, p2Choice);
}
