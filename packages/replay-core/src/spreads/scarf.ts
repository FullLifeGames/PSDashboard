import { dexOfCalc } from '../rules-dex.ts';
import type { PokemonSet } from '@pkmn/sim';
import type { PokemonEvs } from '../types.ts';
import { firstOf, keyOf, secondOf, speedStat, weakRace, type RaceSide, type ReadOrder, type SolveContext } from './fit.ts';
import { evsOfSet, onBudgetScale, statPointsOfEv, ZERO_EVS, type EvBudget } from './ev-budget.ts';
import { raceSpeed } from './race-speed.ts';
import type { SpreadCandidate } from './ladder.ts';
import { toId } from '../ids.ts';

/** What the solver may assume about one mon's item and Speed. */
export interface SpeedKnowledge {
  /** Item from evidence (revealed, manual) or a sheet: never touched. */
  itemKnown: boolean;
  /** Choice items ruled out by two different moves. */
  scarfRuledOut: boolean;
  /** EVs and nature from evidence or a sheet: the set's Speed is the real one. */
  spreadKnown: boolean;
  spreads: { nature: string; evs: PokemonEvs; probability: number }[];
  /** The items the species' usage lists, in usage order, that the log does not refute; absent or empty: none. */
  itemOffers?: readonly string[];
  /** The format's Item Clause: at most this many Pokémon of a team hold one item. Absent: no clause (a Custom Game). */
  itemLimit?: number;
}
/** Keyed `side:speciesId`. */
export type SpeedKnowledgeMap = Map<string, SpeedKnowledge>;
export type ItemDecision = 'holds' | 'lacks';

const PLAUSIBLE_SHARE = 0.05;
// Speed EVs from which a spread counts as tempo-invested; 25 Stat Points give the same Speed.
const INVESTED_SPE = 200;
const CONFIDENT_CAMP_SHARE = 0.8;

const NONE: SpeedKnowledge = { itemKnown: false, scarfRuledOut: false, spreadKnown: false, spreads: [] };
const investedFrom = (budget: EvBudget) => (budget.statPoints ? statPointsOfEv(INVESTED_SPE) : INVESTED_SPE);

interface Mover {
  key: string;
  side: 'p1' | 'p2';
  species: string;
  set: PokemonSet;
  know: SpeedKnowledge;
  prior: SpreadCandidate;
  plausible: SpreadCandidate[];
  invested: (spread: SpreadCandidate) => boolean;
  forme?: string;
}

// A Scarlet/Violet usage spread in a Champions build reads as its Stat Points.
function plausibleSpreads(know: SpeedKnowledge, prior: SpreadCandidate, budget: EvBudget, invested: Mover['invested']): SpreadCandidate[] {
  if (know.spreadKnown) return [prior];
  const spreads = know.spreads.filter(spread => spread.probability >= PLAUSIBLE_SHARE)
    .map(spread => ({ ...spread, evs: onBudgetScale({ ...ZERO_EVS, ...spread.evs }, budget) }));
  if (spreads.length === 0) return [prior];
  const mass = spreads.reduce((sum, spread) => sum + spread.probability, 0);
  const fastMass = spreads.filter(invested).reduce((sum, spread) => sum + spread.probability, 0);
  if (fastMass / mass >= CONFIDENT_CAMP_SHARE) return spreads.filter(invested);
  if (fastMass / mass <= 1 - CONFIDENT_CAMP_SHARE) return spreads.filter(spread => !invested(spread));
  return spreads;
}

function mover(ctx: SolveContext, side: 'p1' | 'p2', species: string, knowledge: SpeedKnowledgeMap, forme?: string): Mover | null {
  const key = keyOf(side, species);
  const set = ctx.sets[side].find(entry => toId(entry.species) === toId(species) || toId(entry.name || '') === toId(species));
  if (!set) return null;
  const know = knowledge.get(key) ?? NONE;
  const prior: SpreadCandidate = { evs: evsOfSet(set.evs, ctx.budget), nature: set.nature || 'Hardy' };
  const threshold = investedFrom(ctx.budget);
  const invested = (spread: SpreadCandidate) => (spread.evs.spe ?? 0) >= threshold;
  return { key, side, species, set, know, prior, plausible: plausibleSpreads(know, prior, ctx.budget, invested), invested, forme };
}

const speeds = (ctx: SolveContext, m: Mover, spreads: SpreadCandidate[]) =>
  spreads.map(spread => speedStat(ctx, m.side, m.species, spread, m.forme)).filter(speed => speed > 0);

function maxSpeed(ctx: SolveContext, m: Mover): number {
  if (m.know.spreadKnown) return speedStat(ctx, m.side, m.species, m.prior, m.forme);
  return speedStat(ctx, m.side, m.species, { evs: { ...m.prior.evs, spe: ctx.budget.perStat }, nature: 'Jolly' }, m.forme);
}

const floor = (ctx: SolveContext, m: Mover) => Math.min(...speeds(ctx, m, m.plausible));

function investedFloor(ctx: SolveContext, m: Mover): number {
  const fast = speeds(ctx, m, m.plausible.filter(m.invested));
  return fast.length > 0 ? Math.min(...fast) : speedStat(ctx, m.side, m.species, m.prior, m.forme);
}

const tempoSpecies = (m: Mover) => (m.know.spreads.length === 0 && !m.know.spreadKnown) || m.plausible.some(m.invested);

function scarfInAllowed(m: Mover): boolean {
  return !m.know.itemKnown && !m.know.scarfRuledOut && toId(m.set.item ?? '') !== 'choicescarf' && tempoSpecies(m);
}

const racedAs = (ctx: SolveContext, mover: RaceSide, stat: number, scarf: boolean) =>
  raceSpeed(dexOfCalc(ctx.gen), stat, scarf, mover.speed, mover.pick);

function scarfIn(ctx: SolveContext, order: ReadOrder, first: Mover, max: number, ref: number): [string, ItemDecision] | null {
  return scarfInAllowed(first) && racedAs(ctx, firstOf(order), max, true) >= ref ? [first.key, 'holds'] : null;
}

function decideAgainstGuessedScarf(ctx: SolveContext, order: ReadOrder, first: Mover, second: Mover, max: number): [string, ItemDecision] | null {
  const scarfRef = racedAs(ctx, secondOf(order), investedFloor(ctx, second), true);
  const fastest = racedAs(ctx, firstOf(order), max, false);
  if (fastest >= scarfRef) return null;
  if (racedAs(ctx, secondOf(order), floor(ctx, second), false) <= fastest) return [second.key, 'lacks'];
  return scarfIn(ctx, order, first, max, scarfRef);
}

// A race read with the Scarf a mover held that turn decides nothing about that mover's set item.
function decide(ctx: SolveContext, order: ReadOrder, first: Mover, second: Mover): [string, ItemDecision] | null {
  const max = maxSpeed(ctx, first);
  if (max === 0 || order.firstScarf !== undefined || toId(first.set.item ?? '') === 'choicescarf') return null;
  const secondScarf = order.secondScarf ?? toId(second.set.item ?? '') === 'choicescarf';
  if (secondScarf && order.secondScarf === undefined && !second.know.itemKnown) return decideAgainstGuessedScarf(ctx, order, first, second, max);
  const ref = racedAs(ctx, secondOf(order), floor(ctx, second), secondScarf);
  return racedAs(ctx, firstOf(order), max, false) >= ref ? null : scarfIn(ctx, order, first, max, ref);
}

// A weak race never earns an item (the settling drops it first), nor does a copied race: its Speed is the copied one's.
/** One pass over the orders before the ladder; the first decision per mon stands. */
export function decideScarfs(ctx: SolveContext, knowledge: SpeedKnowledgeMap): Map<string, ItemDecision> {
  const decisions = new Map<string, ItemDecision>();
  for (const order of ctx.speedOrders) {
    if (weakRace(ctx, order) || order.firstHolder || order.secondHolder) continue;
    const first = mover(ctx, order.firstSide, order.firstSpecies, knowledge, order.firstForme);
    const second = mover(ctx, order.secondSide, order.secondSpecies, knowledge, order.secondForme);
    if (!first || !second) continue;
    const decision = decide(ctx, order, first, second);
    if (decision && !decisions.has(decision[0])) decisions.set(decision[0], decision[1]);
  }
  return decisions;
}

/** The spreads that count as plausible for one mon: the known spread, else its usage camp. */
export function plausibleFor(ctx: SolveContext, side: 'p1' | 'p2', species: string, knowledge: SpeedKnowledgeMap): SpreadCandidate[] {
  return mover(ctx, side, species, knowledge)?.plausible ?? [];
}

/** The rule for a Scarf the solver may give a first mover, asked after any legal Speed. */
export function scarfAllowed(ctx: SolveContext, side: 'p1' | 'p2', species: string, knowledge: SpeedKnowledgeMap): boolean {
  const m = mover(ctx, side, species, knowledge);
  return !!m && scarfInAllowed(m);
}
