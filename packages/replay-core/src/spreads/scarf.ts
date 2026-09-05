import type { PokemonSet } from '@pkmn/sim';
import type { PokemonEvs } from '../types.ts';
import { keyOf, speedStat, type SolveContext } from './fit.ts';
import { ZERO_EVS } from './ev-budget.ts';
import type { SpreadCandidate } from './ladder.ts';
import { toId } from '../ids.ts';

/**
 * Choice Scarf decisions from move-order evidence (round 37). A mover that
 * cannot reach an observed order at full Speed against every plausible
 * configuration of the second mover holds a Scarf; a guessed Scarf that
 * would make its holder faster than the order allows is dropped. Plausible
 * means: the known spread, else the usage spreads with a real share,
 * thinned to the confident tempo camp; a Scarf only rides on a species
 * that runs Speed-invested spreads.
 */

/** What the solver may assume about one mon's item and Speed. */
export interface SpeedKnowledge {
  /** Item from evidence (revealed, manual) or a sheet: never touched. */
  itemKnown: boolean;
  /** Choice items ruled out by two different moves. */
  scarfRuledOut: boolean;
  /** EVs and nature from evidence or a sheet: the set's Speed is the real one. */
  spreadKnown: boolean;
  /** Usage spreads of the species in the format; empty without usage. */
  spreads: { nature: string; evs: PokemonEvs; probability: number }[];
}
/** Keyed `side:speciesId`. */
export type SpeedKnowledgeMap = Map<string, SpeedKnowledge>;
export type ItemDecision = 'holds' | 'lacks';

/** A usage spread below this share is an oddity, not a configuration to measure against. */
const PLAUSIBLE_SHARE = 0.05;
/** Speed EVs from which a spread counts as tempo-invested. */
const INVESTED_SPE = 200;
/** A tempo camp holding this much of the plausible mass drops the other camp. */
const CONFIDENT_CAMP_SHARE = 0.8;
const SCARF_FACTOR = 1.5;

const NONE: SpeedKnowledge = { itemKnown: false, scarfRuledOut: false, spreadKnown: false, spreads: [] };
const invested = (spread: SpreadCandidate) => (spread.evs.spe ?? 0) >= INVESTED_SPE;

interface Mover {
  key: string;
  side: 'p1' | 'p2';
  species: string;
  set: PokemonSet;
  know: SpeedKnowledge;
  prior: SpreadCandidate;
  plausible: SpreadCandidate[];
}

/** The known spread, else the usage spreads worth 5%, thinned to a camp holding 80% of the mass. */
function plausibleSpreads(know: SpeedKnowledge, prior: SpreadCandidate): SpreadCandidate[] {
  if (know.spreadKnown) return [prior];
  const spreads = know.spreads.filter(spread => spread.probability >= PLAUSIBLE_SHARE);
  if (spreads.length === 0) return [prior];
  const mass = spreads.reduce((sum, spread) => sum + spread.probability, 0);
  const fastMass = spreads.filter(invested).reduce((sum, spread) => sum + spread.probability, 0);
  if (fastMass / mass >= CONFIDENT_CAMP_SHARE) return spreads.filter(invested);
  if (fastMass / mass <= 1 - CONFIDENT_CAMP_SHARE) return spreads.filter(spread => !invested(spread));
  return spreads;
}

function mover(ctx: SolveContext, side: 'p1' | 'p2', species: string, knowledge: SpeedKnowledgeMap): Mover | null {
  const key = keyOf(side, species);
  const set = ctx.sets[side].find(entry => toId(entry.species) === toId(species) || toId(entry.name || '') === toId(species));
  if (!set) return null;
  const know = knowledge.get(key) ?? NONE;
  const prior: SpreadCandidate = { evs: { ...ZERO_EVS, ...set.evs }, nature: set.nature || 'Hardy' };
  return { key, side, species, set, know, prior, plausible: plausibleSpreads(know, prior) };
}

const speeds = (ctx: SolveContext, m: Mover, spreads: SpreadCandidate[]) =>
  spreads.map(spread => speedStat(ctx, m.side, m.species, spread)).filter(speed => speed > 0);

/** Full Speed without a Scarf: the known spread's own, else max Speed EVs with a plus nature. */
function maxSpeed(ctx: SolveContext, m: Mover): number {
  if (m.know.spreadKnown) return speedStat(ctx, m.side, m.species, m.prior);
  return speedStat(ctx, m.side, m.species, { evs: { ...m.prior.evs, spe: ctx.budget.perStat }, nature: 'Jolly' });
}

/** The slowest plausible configuration without an item. */
const floor = (ctx: SolveContext, m: Mover) => Math.min(...speeds(ctx, m, m.plausible));

/** The slowest Speed-invested plausible configuration, else the prior: the spreads a Scarf rides on. */
function investedFloor(ctx: SolveContext, m: Mover): number {
  const fast = speeds(ctx, m, m.plausible.filter(invested));
  return fast.length > 0 ? Math.min(...fast) : speedStat(ctx, m.side, m.species, m.prior);
}

/** A Scarf rides on a tempo species: some plausible spread invests in Speed (a known spread decides for itself). */
const tempoSpecies = (m: Mover) => (m.know.spreads.length === 0 && !m.know.spreadKnown) || m.plausible.some(invested);

function scarfInAllowed(m: Mover): boolean {
  return !m.know.itemKnown && !m.know.scarfRuledOut && toId(m.set.item ?? '') !== 'choicescarf' && tempoSpecies(m);
}

/** Scarf-in for the first mover when allowed and the Scarf closes the gap to `ref`. */
function scarfIn(first: Mover, max: number, ref: number): [string, ItemDecision] | null {
  return scarfInAllowed(first) && max * SCARF_FACTOR >= ref ? [first.key, 'holds'] : null;
}

/**
 * The second mover carries a guessed Scarf: reachable against its Scarfed
 * tempo spreads means nothing; a floor the first mover reaches drops the
 * Scarf; otherwise the first mover may hold one instead.
 */
function decideAgainstGuessedScarf(ctx: SolveContext, first: Mover, second: Mover, max: number): [string, ItemDecision] | null {
  const scarfRef = investedFloor(ctx, second) * SCARF_FACTOR;
  if (max >= scarfRef) return null;
  if (floor(ctx, second) <= max) return [second.key, 'lacks'];
  return scarfIn(first, max, scarfRef);
}

/** One order's decision: [key, decision], or null when the order is reachable or unexplained. */
function decide(ctx: SolveContext, first: Mover, second: Mover): [string, ItemDecision] | null {
  const max = maxSpeed(ctx, first);
  // A first mover already carrying a Scarf is the ladder's business.
  if (max === 0 || toId(first.set.item ?? '') === 'choicescarf') return null;
  const secondScarf = toId(second.set.item ?? '') === 'choicescarf';
  if (secondScarf && !second.know.itemKnown) return decideAgainstGuessedScarf(ctx, first, second, max);
  const ref = floor(ctx, second) * (secondScarf ? SCARF_FACTOR : 1);
  return max >= ref ? null : scarfIn(first, max, ref);
}

/** One pass over the orders before the ladder; the first decision per mon stands. */
export function decideScarfs(ctx: SolveContext, knowledge: SpeedKnowledgeMap): Map<string, ItemDecision> {
  const decisions = new Map<string, ItemDecision>();
  for (const order of ctx.speedOrders) {
    const first = mover(ctx, order.firstSide, order.firstSpecies, knowledge);
    const second = mover(ctx, order.secondSide, order.secondSpecies, knowledge);
    if (!first || !second) continue;
    const decision = decide(ctx, first, second);
    if (decision && !decisions.has(decision[0])) decisions.set(decision[0], decision[1]);
  }
  return decisions;
}
