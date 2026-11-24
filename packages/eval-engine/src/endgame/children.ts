import type { Battle, PRNGSeed } from '@pkmn/sim';
import { positionBattle, type SimPosition } from '../forward-model.ts';
import { BOUNDARY_DRAW_BUDGET, type CellEvent } from '../cell-blend.ts';
import { BASE_DRAWS } from '../search/leaf.ts';
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

/** One matrix cell's child for the endgame solver: a class representative with an analytic weight, or a median. */
export interface EndgameChild {
  position: SimPosition;
  /** Weight normalized over the drawn classes (the solver's blend). */
  weight: number;
  /** Analytic class weight before that normalization (the prover's mass); 1 on the plain path. */
  share: number;
  ended: boolean;
  /** Group key `${order}:${classKey}` on the class path; absent on the plain path. */
  key?: string;
  /** Plain path: the child of a chance die turned the other way for its price; the lazy pass leaves it aside. */
  turned?: true;
}
export interface EndgameChildren {
  children: EndgameChild[];
  unpriced: boolean;
  plain: boolean;
  spread: boolean;
  /** Class path: the expected classes no draw showed, with their analytic share. */
  missing: { key: string; share: number }[];
  /** Class path: the cell's priced events, in the order the class keys join their outcomes. */
  events: CellEvent[];
  /** On an unpriced plain cell: its children read through the recorded dice; null when they explain no draw. */
  delaySplit?: () => EndgameChild[] | null;
}

/** The draws of the plain path for a damaging pair; the count is the proof's confidence (`cellSeeds` holds 16). */
export const PLAIN_DRAWS = { singles: 3, doubles: 5 } as const;

export const plainDrawCount = (battle: Battle): number => (battle.gameType === 'singles' ? PLAIN_DRAWS.singles : PLAIN_DRAWS.doubles);

function damagingPair(battle: Battle, p1Choice: string, p2Choice: string): boolean {
  return [p1Choice, p2Choice].some(choice => choice.split(',').some(part => {
    const tokens = part.trim().split(' ');
    if (tokens[0] !== 'move') return false;
    const move = battle.dex.moves.get(tokens[1]);
    return move.exists && (move.basePower > 0 || Boolean(move.damage) || Boolean(move.ohko));
  }));
}

function plainGroup(draws: Draw[]): { draws: Draw[]; pick: Draw; index: number; unpriced: boolean; spread: boolean } {
  const unpriced = draws.some(draw => draw.fainted !== draws[0].fainted || draw.ended !== draws[0].ended);
  const pick = median(draws);
  return { draws, pick, index: draws.indexOf(pick), unpriced, spread: unpriced || draws.some(draw => draw.measure !== draws[0].measure) };
}

function doublesTie(root: SimPosition, battle: Battle, p1Choice: string, p2Choice: string): boolean {
  if (battle.gameType === 'singles') return false;
  return drawPair(root, p1Choice, p2Choice, cellSeeds(root, p1Choice, p2Choice)[0], new Map(), createMatchupCache(battleRuleset(battle))).records
    .some(record => record.kind === 'tie');
}

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

interface PricedGroup { children: { position: SimPosition; share: number; ended: boolean; turned?: true }[]; unpriced: boolean; spread: boolean }

// Only the dice the group cannot price stay certain (damage roll, crit, hit count); each other chance die flips once.
// A die drawn more than once, or a draw that lands on no child's facts, leaves the group unpriced.
function pricedGroup(turn: FlipTurn, draws: Draw[], spread: boolean): PricedGroup {
  const recorded = recordTurn(turn);
  const base = boardFacts(recorded.battle);
  const deciding = recorded.dice.flatMap(die => {
    const flipped = flipTurn(turn, recorded, die);
    return flipped.took && boardFacts(flipped.battle) !== base ? [{ die, battle: flipped.battle, drawn: flipped.drawn }] : [];
  });
  const held = deciding.reduce((product, entry) => product * entry.die.held, 1);
  const children: PricedGroup['children'] = [{ position: toPosition(recorded.battle), share: held, ended: recorded.battle.ended }];
  // A flipped branch is worth its die's other answer times the chances of the other deciding dice it drew again.
  const flippedShare = (entry: (typeof deciding)[number]): number =>
    deciding.reduce((product, other) => (other !== entry && entry.drawn.has(other.die.key) ? product * other.die.held : product), entry.die.other);
  for (const entry of deciding) children.push({ position: toPosition(entry.battle), share: flippedShare(entry), ended: entry.battle.ended, turned: true });
  const facts = new Set([base, ...deciding.map(entry => boardFacts(entry.battle))]);
  const unexplained = draws.some(draw => !facts.has(boardFacts(positionBattle(draw.position))));
  return { children, unpriced: unexplained || recorded.repeated.length > 0, spread: spread || deciding.length > 0 };
}

function heldTies(tied: string[][], first: 'p1' | 'p2'): ForcedDie[] {
  const dice = new Map<string, ForcedDie>();
  for (const slots of tied) {
    for (const a of slots.filter(slot => slot.startsWith(first))) {
      for (const b of slots.filter(slot => !slot.startsWith(first))) dice.set(`${a}|${b}`, { name: tieName(a, b), result: { first: a } });
    }
  }
  return [...dice.values()];
}

type Group = ReturnType<typeof plainGroup>;
type Raw = PricedGroup['children'];

const weighed = (children: Raw, scale = 1): EndgameChild[] => {
  const total = children.reduce((sum, child) => sum + child.share, 0);
  return children.map(child => ({ position: child.position, weight: (scale * child.share) / total, share: scale * child.share, ended: child.ended, ...(child.turned ? { turned: true as const } : {}) }));
};

function splitOf(turnAt: (seed: PRNGSeed) => FlipTurn, seeds: PRNGSeed[], group: Group): Raw | null {
  const open = group.draws.findIndex(draw => !draw.ended);
  const priced = pricedGroup(turnAt(seeds[open >= 0 ? open : group.index]), group.draws, true);
  return priced.unpriced ? null : priced.children;
}

const once = <T>(read: () => T): (() => T) => {
  let answer: { value: T } | null = null;
  return () => (answer ??= { value: read() }).value;
};

// Each speed-tie order is a child of half the weight: fixed draws resolve the tie alike and would prove a coin flip.
function plainChildren(root: SimPosition, battle: Battle, rootHp: number, p1Choice: string, p2Choice: string): EndgameChildren {
  const count = damagingPair(battle, p1Choice, p2Choice) ? plainDrawCount(battle) : 1;
  const seeds = cellSeeds(root, p1Choice, p2Choice).slice(0, count);
  const tied = doublesTie(root, battle, p1Choice, p2Choice) ? recordTurn(cellTurn(root, p1Choice, p2Choice, seeds[0])).ties : [];
  if (tied.length > 0) {
    const orders = (['p1', 'p2'] as const).map(first => {
      const turnAt = (seed: PRNGSeed) => cellTurn(root, p1Choice, p2Choice, seed, heldTies(tied, first));
      const group = plainGroup(seeds.map(seed => drawChild(root, rootHp, p1Choice, p2Choice, seed, { scripts: new Map([[`${first}:tie`, { first }]]) })));
      if (group.unpriced) return { children: [{ position: group.pick.position, share: 1, ended: group.pick.ended }], unpriced: true, spread: true, split: once(() => splitOf(turnAt, seeds, group)) };
      const priced = pricedGroup(turnAt(seeds[group.index]), group.draws, group.spread);
      return { ...priced, split: () => (priced.unpriced ? null : priced.children) };
    });
    const delaySplit = once(() => {
      const parts = orders.map(order => order.split());
      return parts.some(part => part === null) ? null : parts.flatMap(part => weighed(part!, 0.5));
    });
    return { children: orders.flatMap(order => weighed(order.children, 0.5)), unpriced: orders.some(order => order.unpriced), plain: true, spread: orders.some(order => order.spread), missing: [], events: [], ...(orders.some(order => order.unpriced) ? { delaySplit } : {}) };
  }
  const group = plainGroup(seeds.map(seed => drawChild(root, rootHp, p1Choice, p2Choice, seed)));
  const { pick, unpriced, spread } = group;
  const turnAt = (seed: PRNGSeed) => cellTurn(root, p1Choice, p2Choice, seed);
  if (unpriced) return { children: [{ position: pick.position, weight: 1, share: 1, ended: pick.ended }], unpriced, plain: true, spread, missing: [], events: [], delaySplit: once(() => { const split = splitOf(turnAt, seeds, group); return split && weighed(split); }) };
  const priced = pricedGroup(turnAt(seeds[group.index]), group.draws, spread);
  return { children: weighed(priced.children), unpriced: priced.unpriced, plain: true, spread: priced.spread, missing: [], events: [] };
}

/** The children of one matrix cell; `drawBudget` caps the forced draws for classes the base seeds never showed. */
export function endgameChildren(root: SimPosition, p1Choice: string, p2Choice: string, drawBudget = BOUNDARY_DRAW_BUDGET): EndgameChildren {
  const battle = positionBattle(root);
  const classes = classChildren(root, p1Choice, p2Choice, { baseSeeds: cellSeeds(root, p1Choice, p2Choice).slice(0, BASE_DRAWS), forcedCap: drawBudget });
  if (classes) {
    const children = classes.children.map(child => ({ position: child.position, weight: child.weight, share: child.share, ended: child.ended, key: child.key }));
    return { children, unpriced: classes.missing.length > 0, plain: false, spread: false, missing: classes.missing, events: classes.events };
  }
  return plainChildren(root, battle, totalHp(battle), p1Choice, p2Choice);
}
