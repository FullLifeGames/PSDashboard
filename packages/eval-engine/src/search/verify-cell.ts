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
 *
 * Round 64 (T119): one child still stood for its whole outcome, so what the
 * log does not split decided it. VGC 2629703929 t8: the Sleep Powder hit
 * class went deeper through a sleep counter of 3 (−0.17) while a third of
 * its draws wake next turn (0.96); its mean over 18 fresh draws is 0.21.
 * Now an outcome takes the verify pool's natural draws and goes one ply
 * deeper through one child per state they leave, mixed by that state's
 * share of its draws: the simulator draws the lengths and the chances, an
 * outcome whose draws all leave one state prices as before. Against the
 * Monte-Carlo reference on every corpus turn with a verify step (probe
 * docs/perf/probes/2026-10-06-r64/lanes/C): singles cells outside 2.5
 * standard errors 9 → 2 of 177, side verdicts 72 → 73 of 75; doubles
 * cells 51 → 35 of 218, verdicts 42 of 44 before and after.
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

/**
 * Round 64 (T119): how an outcome that goes deeper splits its draws.
 * `split`: 'state' reads every state the simulator keeps on a Pokémon (HP
 * apart), 'counter' only the effects that keep a count (a sleep,
 * confusion, trap, lock, Protect or Encore counter, Toxic's stage).
 * `span`: a state whose one-ply leaves span more than this splits into its
 * lower and upper half (0: never). The states go deeper by descending share
 * until `cover` of the outcome's draws is covered, at most `cap` of them;
 * the rest shift by the deepened states' mean step. `pool`: the natural
 * draws a class or a one-draw cell takes for it.
 */
export interface StateRule {
  split: 'state' | 'counter';
  span: number;
  cover: number;
  cap: number;
  pool: number;
}

/**
 * Doubles reads only the counts: every other split, the leaf span and a
 * 16-draw pool cost doubles 251 sub-searches against 176 before on the
 * twenty timing positions (the bound is +10 % tree time); the counts cost
 * 186. On the doubles corpus cells the full split reads 0.053 off the
 * reference, the counts 0.058, the old step 0.083, with the same verdicts.
 */
export const VERIFY_STATE_RULE: { readonly singles: StateRule; readonly doubles: StateRule } = {
  singles: { split: 'state', span: 0.05, cover: 0.9, cap: 4, pool: VERIFY_PLAIN_DRAWS },
  doubles: { split: 'counter', span: 0, cover: 0.9, cap: 4, pool: 8 },
};

/** The state rule of a position's game type. */
export const stateRuleFor = (position: SimPosition): StateRule =>
  VERIFY_STATE_RULE[positionBattle(position).gameType === 'doubles' ? 'doubles' : 'singles'];

/** One state an outcome's draws leave: its share of the outcome's draws, its representative child, the state's mean leaf. */
export interface StateGroup {
  share: number;
  child: SimPosition;
  leaf: number;
  ended: boolean;
}

/** One outcome of a plain verify cell: its share of the draws, its representative child, the group's mean leaf, and its states where they differ. */
export interface OutcomeGroup {
  share: number;
  child: SimPosition;
  leaf: number;
  ended: boolean;
  groups?: StateGroup[];
}

export interface PlainDraw {
  child: SimPosition;
  log: readonly string[];
  leaf: number;
  ended: boolean;
}

type Drawn = Pick<PlainDraw, 'child' | 'leaf' | 'ended'>;
type BattlePokemon = ReturnType<typeof positionBattle>['sides'][number]['pokemon'][number];

/** The protocol lines that tell outcomes apart: who fell, who missed, who could not act. */
const OUTCOME_LINE = /^\|(faint|-miss|cant)\|/;

const outcomeKey = (draw: PlainDraw): string =>
  `${draw.log.filter(line => OUTCOME_LINE.test(line)).map(line => line.split('|').slice(1, 4).join('|')).join(';')}${draw.ended ? ';end' : ''}`;

/**
 * Fields of an effect state the state key leaves out: the battle's running
 * effect counter, and amounts of HP and damage (a Substitute's HP, Bide's
 * and Counter's damage), which follow the damage roll like the Pokémon's
 * own HP.
 */
const UNREAD = new Set(['effectOrder', 'hp', 'damage', 'totalDamage']);

const counters = (state: Record<string, unknown> | undefined): string => (state
  ? Object.entries(state).filter(([key, value]) => typeof value === 'number' && !UNREAD.has(key))
    .map(([key, value]) => `${key}=${String(value)}`).sort().join(',')
  : '');

/** One Pokémon's state, HP left out: fainted, the status and every volatile with the numbers they keep, the stat stages, the item. */
function pokemonState(pokemon: BattlePokemon): string {
  const volatiles = Object.keys(pokemon.volatiles).sort().map(id => `${id}(${counters(pokemon.volatiles[id])})`).join('+');
  const boosts = Object.entries(pokemon.boosts).filter(([, stage]) => stage !== 0).map(([stat, stage]) => `${stat}${stage}`).join('');
  return `${pokemon.name}:${pokemon.fainted ? 'fnt' : ''}${pokemon.status}(${counters(pokemon.statusState)})/${volatiles}/${boosts}/${pokemon.item}`;
}

/** One Pokémon's counts: the status and the volatiles that keep a number, with it. */
function pokemonCounts(pokemon: BattlePokemon): string {
  const status = counters(pokemon.statusState) ? `${pokemon.status}(${counters(pokemon.statusState)})` : '';
  const volatiles = Object.keys(pokemon.volatiles).sort().filter(id => counters(pokemon.volatiles[id]))
    .map(id => `${id}(${counters(pokemon.volatiles[id])})`).join('+');
  return `${pokemon.name}:${status}/${volatiles}`;
}

/** Every side's actives by slot and its bench by name (not by the order the simulator keeps it in). */
function sidesKey(child: SimPosition, read: (pokemon: BattlePokemon) => string): string {
  return positionBattle(child).sides.map(side => {
    const active = side.active.map(pokemon => (pokemon ? read(pokemon) : '-')).join(',');
    const bench = side.pokemon.filter(pokemon => !side.active.includes(pokemon)).map(read).sort().join(',');
    return `${active};${bench}`;
  }).join('|');
}

/**
 * Round 64 (T119): the state a child leaves on every Pokémon, HP left out:
 * who stands in which slot, fainted, the status and the numbers its state
 * keeps (the sleep counter), every volatile and the numbers its state keeps
 * (the confusion counter, trap and lock lengths), the stat stages, the item.
 * Read off the simulator's battle, no list of moves or effects.
 */
export const stateKey = (child: SimPosition): string => sidesKey(child, pokemonState);

/** Round 64 (T119): only the counts a child's Pokémon keep (the doubles split). */
export const counterKey = (child: SimPosition): string => sidesKey(child, pokemonCounts);

/** The first draw of a group: a class keeps its own child as the representative of its state. */
export const firstDraw = <T extends Drawn>(list: readonly T[]): T => list[0];

/** The draw whose leaf sits nearest the mean (ties keep the earliest): a plain group's representative. */
export function nearestMean<T extends Drawn>(list: readonly T[], mean: number): T {
  let pick = list[0];
  for (const draw of list) if (Math.abs(draw.leaf - mean) < Math.abs(pick.leaf - mean)) pick = draw;
  return pick;
}

type Choose<T> = (list: readonly T[], mean: number) => T;

/** A state whose leaves span more than the rule's span: its lower and upper half, each represented nearest its mean. */
function spanHalves<T extends Drawn>(list: T[], pick: Choose<T>, span: number): { list: T[]; choose: Choose<T> }[] {
  const leaves = list.map(draw => draw.leaf);
  if (span <= 0 || list.length < 2 || Math.max(...leaves) - Math.min(...leaves) <= span) return [{ list, choose: pick }];
  const sorted = [...list].sort((a, b) => a.leaf - b.leaf);
  const half = Math.floor(sorted.length / 2);
  return [{ list: sorted.slice(0, half), choose: nearestMean }, { list: sorted.slice(half), choose: nearestMean }];
}

/**
 * Round 64 (T119): an outcome's draws grouped by the state they leave (the
 * game type's split and span), in order of first appearance, with `pick`
 * naming each group's representative; undefined where they all leave one.
 */
export function stateGroups<T extends Drawn>(draws: readonly T[], pick: Choose<T>): StateGroup[] | undefined {
  if (draws.length < 2) return undefined;
  const rule = stateRuleFor(draws[0].child);
  const key = rule.split === 'counter' ? counterKey : stateKey;
  const groups = new Map<string, T[]>();
  for (const draw of draws) {
    const state = key(draw.child);
    groups.set(state, [...(groups.get(state) ?? []), draw]);
  }
  const lists = [...groups.values()].flatMap(list => spanHalves(list, pick, rule.span));
  if (lists.length < 2) return undefined;
  return lists.map(({ list, choose }) => {
    const mean = list.reduce((sum, draw) => sum + draw.leaf, 0) / list.length;
    return { share: list.length / draws.length, child: choose(list, mean).child, leaf: mean, ended: list.every(draw => draw.ended) };
  });
}

export function drawPlain(root: SimPosition, p1Choice: string, p2Choice: string, seed: PRNGSeed, matchupCache: MatchupCache): PlainDraw {
  const { child, log } = advancePositionWithLog(root, p1Choice, p2Choice, seed);
  const battle = positionBattle(child);
  return { child, log, leaf: leafValue(battle, matchupCache), ended: battle.ended };
}

/**
 * The draws grouped by outcome, in order of first appearance; each group's
 * representative is the draw whose leaf sits nearest the group's mean
 * (ties keep the earliest). Round 64 (T119): a group whose draws leave
 * different states carries them.
 */
export function outcomeGroups(draws: readonly PlainDraw[]): OutcomeGroup[] {
  const groups = new Map<string, PlainDraw[]>();
  for (const draw of draws) {
    const key = outcomeKey(draw);
    groups.set(key, [...(groups.get(key) ?? []), draw]);
  }
  return [...groups.values()].map(list => {
    const mean = list.reduce((sum, draw) => sum + draw.leaf, 0) / list.length;
    const states = stateGroups(list, nearestMean);
    return {
      share: list.length / draws.length, child: nearestMean(list, mean).child, leaf: mean, ended: list.every(draw => draw.ended),
      ...(states ? { groups: states } : {}),
    };
  });
}

/**
 * What a sampled cell hands the verify step: its first child, the blend's
 * class children (each class's first draw) and, since round 64, the states
 * of the classes whose draws differ; a plain cell's outcome groups.
 */
export interface VerifyDraws {
  firstChild: SimPosition;
  classChildren?: ReadonlyMap<string, SimPosition>;
  classGroups?: ReadonlyMap<string, StateGroup[]>;
  outcomes?: OutcomeGroup[];
}

export interface Outcome {
  weight: number;
  child: SimPosition;
  leaf: number;
  ended: boolean;
  /** Round 64: the states the outcome's draws leave, where they differ. */
  groups?: readonly StateGroup[];
}

/**
 * The outcomes one ply deeper: ended ones keep their leaf; open ones go
 * deeper by descending weight (ties keep list order) until `cover` of the
 * open weight is covered (the heaviest always) and at most `cap` of them,
 * and the rest take their leaf shifted by the deepened ones' weighted mean
 * step. An outcome with states goes deeper through them under `states`.
 */
export function deeperValues(
  outcomes: readonly Outcome[], deepen: (child: SimPosition) => number, cover: number, cap = Number.POSITIVE_INFINITY,
  states: StateRule = VERIFY_STATE_RULE.singles,
): number[] {
  const values = outcomes.map(outcome => outcome.leaf);
  const open = outcomes.map((outcome, index) => ({ outcome, index })).filter(entry => !entry.outcome.ended)
    .sort((a, b) => b.outcome.weight - a.outcome.weight || a.index - b.index);
  const target = cover * open.reduce((sum, entry) => sum + entry.outcome.weight, 0);
  let covered = 0;
  let step = 0;
  let taken = 0;
  const rest: number[] = [];
  for (const { outcome, index } of open) {
    if ((covered > 0 && covered >= target - 1e-12) || taken >= cap) {
      rest.push(index);
      continue;
    }
    const deeper = outcome.groups ? deeperStates(outcome.groups, deepen, states) : { value: deepen(outcome.child), leaf: outcome.leaf };
    values[index] = deeper.value;
    step += outcome.weight * (deeper.value - deeper.leaf);
    covered += outcome.weight;
    taken += 1;
  }
  for (const index of rest) values[index] = outcomes[index].leaf + step / covered;
  return values;
}

/**
 * Round 64 (T119): an outcome's states one ply deeper under the rule's
 * cover and cap, mixed by share; its step counts from its states' own leaves.
 */
function deeperStates(groups: readonly StateGroup[], deepen: (child: SimPosition) => number, rule: StateRule): { value: number; leaf: number } {
  const values = deeperValues(groups.map(group => ({ weight: group.share, child: group.child, leaf: group.leaf, ended: group.ended })),
    deepen, rule.cover, rule.cap, rule);
  return {
    value: groups.reduce((sum, group, index) => sum + group.share * values[index], 0),
    leaf: groups.reduce((sum, group) => sum + group.share * group.leaf, 0),
  };
}

/**
 * One ply deeper per outcome: every open class of a blend carries its own
 * deeper value (ended classes keep their exact leaves); a plain cell
 * carries its groups' deeper values mixed by share, or its one child's.
 * `cover` is the game type's VERIFY_DEEPEN_COVER. Round 64: an outcome
 * whose draws leave different states goes deeper through each of them.
 */
export function deepenVerifiedCell(
  value: EvalCellValue, draws: VerifyDraws, deepen: (child: SimPosition) => number, cover: number,
): void {
  const states = stateRuleFor(draws.firstChild);
  if (value.blend) {
    const open = value.blend.classes.filter(cls => !cls.ended && draws.classChildren?.has(cls.key));
    const values = deeperValues(open.map(cls => {
      const groups = draws.classGroups?.get(cls.key);
      return { weight: cls.weight, child: draws.classChildren!.get(cls.key)!, leaf: cls.leafSum / cls.count, ended: false, ...(groups ? { groups } : {}) };
    }), deepen, cover, Number.POSITIVE_INFINITY, states);
    open.forEach((cls, index) => { cls.deepened = values[index]; });
    return;
  }
  const groups = draws.outcomes ?? [{ share: 1, child: draws.firstChild, leaf: value.value, ended: value.ended }];
  const values = deeperValues(groups.map(group => ({ ...group, weight: group.share })), deepen, cover, Number.POSITIVE_INFINITY, states);
  value.deepened = groups.reduce((sum, group, index) => sum + group.share * values[index], 0);
}
