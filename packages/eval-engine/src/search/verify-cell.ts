import type { PRNGSeed } from '@pkmn/sim';
import type { MatchupCache } from '../eval-function.ts';
import { advancePositionWithLog, positionBattle, type SimPosition } from '../forward-model.ts';
import { PROBE_SEEDS } from '../cell-blend.ts';
import type { EvalCellValue } from '../types.ts';
import { leafValue, SEARCH_SEEDS } from './leaf.ts';

/**
 * Round 63 (T16): the verify step prices a cell at one depth. A blend cell
 * (the singles class plan, the doubles pair plan) goes one ply deeper per
 * open class through the class's own first draw and keeps the plan
 * weights; a cell without a plan draws VERIFY_PLAIN_DRAWS natural seeds,
 * groups them by outcome (who fell, who missed, who could not act) and
 * goes one ply deeper per group, mixed by draw share. Before, only the
 * first draw went deeper: the second fixed seed misses in 21 of 22 cells
 * with a miss chance and the first never does (round 62), so the first
 * draw decided notes that 40 fresh draws do not carry, and a plain mean
 * over three fixed seeds weighed a 10 % miss a third. Measured on ten
 * corpus scenes against a Monte-Carlo reference (40 fresh draws, each one
 * ply deeper): 18 of 20 side verdicts agree, against 13 before; splitting
 * classes further or deepening every rare outcome bought no verdict and up
 * to twice the sub-searches (probe docs/perf/probes/2026-10-05-r63/lanes/C).
 */

/** Natural draws of a plain verify cell wherever the sampler wants more than one. */
export const VERIFY_PLAIN_DRAWS = 16;
/** Their seeds, fixed and never randomized: the search seeds, then the probe seeds (the doubles fallback's eight first). */
export const VERIFY_PLAIN_SEEDS: readonly PRNGSeed[] = [...SEARCH_SEEDS, ...PROBE_SEEDS];
/**
 * Outcomes go deeper by descending weight until this share of the cell's
 * open weight is covered; the rarer rest takes its one-ply value shifted by
 * the deepened outcomes' weighted mean step, so no cell mixes depths.
 * Doubles goes deeper through the heaviest outcome only: a doubles
 * sub-search costs about three singles ones (0.25 s against 0.09 s), and
 * the doubles tree-time bound of round 63 (+20 % on twenty bank positions)
 * leaves room for one per verified cell once the played row and the pair
 * plan's boundary cells join the verify set (T78). On the 54 doubles corpus
 * sides the verdicts agree with the Monte-Carlo reference 49 times, against
 * 50 at 90 % and 43 before. Singles keeps 90 %: with the heaviest outcome
 * only, 655336 t26 p2's full-paralysis note comes back (0.12 against the
 * reference's 0.05).
 */
export const VERIFY_DEEPEN_COVER = { singles: 0.9, doubles: 0 } as const;

/** One outcome of a plain verify cell: its share of the draws, its representative child, the group's mean leaf. */
export interface OutcomeGroup {
  share: number;
  child: SimPosition;
  leaf: number;
  ended: boolean;
}

export interface PlainDraw {
  child: SimPosition;
  log: readonly string[];
  leaf: number;
  ended: boolean;
}

/** The protocol lines that tell outcomes apart: who fell, who missed, who could not act. */
const OUTCOME_LINE = /^\|(faint|-miss|cant)\|/;

const outcomeKey = (draw: PlainDraw): string =>
  `${draw.log.filter(line => OUTCOME_LINE.test(line)).map(line => line.split('|').slice(1, 4).join('|')).join(';')}${draw.ended ? ';end' : ''}`;

export function drawPlain(root: SimPosition, p1Choice: string, p2Choice: string, seed: PRNGSeed, matchupCache: MatchupCache): PlainDraw {
  const { child, log } = advancePositionWithLog(root, p1Choice, p2Choice, seed);
  const battle = positionBattle(child);
  return { child, log, leaf: leafValue(battle, matchupCache), ended: battle.ended };
}

/**
 * The draws grouped by outcome, in order of first appearance; each group's
 * representative is the draw whose leaf sits nearest the group's mean
 * (ties keep the earliest).
 */
export function outcomeGroups(draws: readonly PlainDraw[]): OutcomeGroup[] {
  const groups = new Map<string, PlainDraw[]>();
  for (const draw of draws) {
    const key = outcomeKey(draw);
    groups.set(key, [...(groups.get(key) ?? []), draw]);
  }
  return [...groups.values()].map(list => {
    const mean = list.reduce((sum, draw) => sum + draw.leaf, 0) / list.length;
    let pick = list[0];
    for (const draw of list) if (Math.abs(draw.leaf - mean) < Math.abs(pick.leaf - mean)) pick = draw;
    return { share: list.length / draws.length, child: pick.child, leaf: mean, ended: list.every(draw => draw.ended) };
  });
}

/** What a sampled cell hands the verify step: its first child, the blend's class children (each class's first draw), a plain cell's outcome groups. */
export interface VerifyDraws {
  firstChild: SimPosition;
  classChildren?: ReadonlyMap<string, SimPosition>;
  outcomes?: OutcomeGroup[];
}

export interface Outcome {
  weight: number;
  child: SimPosition;
  leaf: number;
  ended: boolean;
}

/**
 * The outcomes one ply deeper: ended ones keep their leaf; open ones go
 * deeper by descending weight (ties keep list order) until `cover` of the
 * open weight is covered (the heaviest always), and the rest take their
 * leaf shifted by the deepened ones' weighted mean step.
 */
export function deeperValues(outcomes: readonly Outcome[], deepen: (child: SimPosition) => number, cover: number): number[] {
  const values = outcomes.map(outcome => outcome.leaf);
  const open = outcomes.map((outcome, index) => ({ outcome, index })).filter(entry => !entry.outcome.ended)
    .sort((a, b) => b.outcome.weight - a.outcome.weight || a.index - b.index);
  const target = cover * open.reduce((sum, entry) => sum + entry.outcome.weight, 0);
  let covered = 0;
  let step = 0;
  const rest: number[] = [];
  for (const { outcome, index } of open) {
    if (covered > 0 && covered >= target - 1e-12) {
      rest.push(index);
      continue;
    }
    values[index] = deepen(outcome.child);
    step += outcome.weight * (values[index] - outcome.leaf);
    covered += outcome.weight;
  }
  for (const index of rest) values[index] = outcomes[index].leaf + step / covered;
  return values;
}

/**
 * One ply deeper per outcome: every open class of a blend carries its own
 * draw's deeper value (ended classes keep their exact leaves); a plain
 * cell carries its groups' deeper values mixed by share, or its one child's.
 * `cover` is the game type's VERIFY_DEEPEN_COVER.
 */
export function deepenVerifiedCell(
  value: EvalCellValue, draws: VerifyDraws, deepen: (child: SimPosition) => number, cover: number,
): void {
  if (value.blend) {
    const open = value.blend.classes.filter(cls => !cls.ended && draws.classChildren?.has(cls.key));
    const values = deeperValues(open.map(cls => ({
      weight: cls.weight, child: draws.classChildren!.get(cls.key)!, leaf: cls.leafSum / cls.count, ended: false,
    })), deepen, cover);
    open.forEach((cls, index) => { cls.deepened = values[index]; });
    return;
  }
  const groups = draws.outcomes ?? [{ share: 1, child: draws.firstChild, leaf: value.value, ended: value.ended }];
  const values = deeperValues(groups.map(group => ({ ...group, weight: group.share })), deepen, cover);
  value.deepened = groups.reduce((sum, group, index) => sum + group.share * values[index], 0);
}
