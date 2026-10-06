import { Dex } from '@pkmn/dex';
import type { PokemonSet } from '@pkmn/sim';
import type { PokemonEvs, SpeedOrderObservation } from '../types.ts';
import { capToBudget, ZERO_EVS } from './ev-budget.ts';
import {
  firstOf, keyOf, physicalAttackerFor, racedWithScarf, secondOf, setOf, speedStat, weakRace, type RaceSide, type ReadOrder, type SolveContext,
} from './fit.ts';
import { raceSpeed } from './race-speed.ts';
import { plausibleFor, scarfAllowed, type SpeedKnowledgeMap } from './scarf.ts';
import { natureOf, type SpreadCandidate } from './ladder.ts';
import { toId } from '../ids.ts';

/**
 * T117 (round 63): an observed move order is a hard limit on the built
 * sets, for both sides. Before the ladder, every component of the order
 * graph that holds a broken order is settled: a plausible spread (round
 * 37's usage camp) yields first, then any legal Speed, then a Choice Scarf
 * on a first mover round 37 allows one. Inside a tier the mon with its own
 * Speed evidence (orders its prior already satisfies) keeps its Speed and
 * the side without it absorbs the change, the second mover on a tie. A
 * repaired order ends strict, a cycle tied. A weak race (a knock-out the
 * victim may have lost to its own negative priority) binds while a legal
 * set fits it and goes first when none does. A component no tier settles
 * keeps its sets. Round 64 (T122): a Speed IV below 31 comes after every
 * legal Speed and before a new Scarf; only a race that cannot end strict
 * may tie; a race reads the forme that raced and a transformed mover's
 * copied Speed, with the Scarf as the simulator rounds it.
 */

type Side = 'p1' | 'p2';
type Sets = { p1: PokemonSet[]; p2: PokemonSet[] };
type StatId = keyof PokemonEvs;
type Tier = 'plausible' | 'legal' | 'slow';

/** One Speed a settled mon may take, with the spread that gives it (and, once asked, its Speed in a battle forme). */
interface Option { stat: number; spread: SpreadCandidate; plausible: boolean; cost: number; formes?: Map<string, number> }

/** A mon of the orders: its set, its prior, and (once asked) the Speeds it may take. */
interface Racer {
  key: string;
  side: Side;
  species: string;
  set: PokemonSet;
  prior: SpreadCandidate;
  stat: number;
  /** The prior as an option. */
  self: Option;
  known: boolean;
  options: Partial<Record<Tier, Option[]>>;
}

interface Race { order: ReadOrder; first: Racer; second: Racer; weak: boolean; broken: boolean }
/** A mover's race Speed for an option: in the forme that raced, with the Scarf it ran with, as the simulator rounds it (round 64). */
type Reading = (option: Option) => number;
/** A race as one solve reads it: each mover's race Speed, whether the priors break it and whether it must end strict. */
interface Bound { first: Racer; second: Racer; firstSpeed: Reading; secondSpeed: Reading; broken: boolean; strict: boolean }

const EV_STEP = 4;
const MAX_IVS: PokemonEvs = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };

const named = (sets: PokemonSet[], species: string) =>
  sets.some(set => toId(set.species) === toId(species) || toId(set.name || '') === toId(species));

/**
 * The set an order's mover raced as: its own species, or the set of the
 * forme a battle-only forme comes from (Dex `battleOnly`). On the same base
 * Speed (Ogerpon's Tera masks) the set's Speed raced; a forme with its own
 * Speed (a Mega after its evolution, Terapagos-Terastal) raced on its base
 * Speed with the set's spread (round 64), so the race keeps the forme.
 */
function racedAs(dex: ReturnType<typeof Dex.forGen>, sets: PokemonSet[], species: string): { species: string; forme?: string } {
  if (named(sets, species)) return { species };
  const forme = dex.species.get(species);
  const origin = [forme.battleOnly ?? []].flat()
    .map(name => dex.species.get(name))
    .find(base => base.exists && named(sets, base.name));
  if (!origin) return { species };
  return origin.baseStats.spe === forme.baseStats.spe ? { species: origin.name } : { species: origin.name, forme: forme.name };
}

/**
 * One mover as the solver reads it: the set whose spread raced (a
 * transformed mover's copied Pokémon, round 64), the forme, and the set
 * whose item ran the race when that is another one.
 */
function readMover(
  dex: ReturnType<typeof Dex.forGen>, sets: Sets, side: Side, species: string, copied?: { side: Side; species: string },
): Omit<RaceSide, 'held'> {
  const own = racedAs(dex, sets[side], species);
  if (!copied) return { side, ...own };
  return { ...racedAs(dex, sets[copied.side], copied.species), side: copied.side, holder: { side, species: own.species } };
}

/** The orders with each mover named as the set that raced, the forme when it ran on its own Speed, the holder of a copied race. */
export function readableOrders(orders: SpeedOrderObservation[], sets: Sets, gen: number): ReadOrder[] {
  const dex = Dex.forGen(gen);
  return orders.map(order => {
    const first = readMover(dex, sets, order.firstSide, order.firstSpecies, order.firstCopied);
    const second = readMover(dex, sets, order.secondSide, order.secondSpecies, order.secondCopied);
    return {
      ...order, firstSide: first.side, firstSpecies: first.species, secondSide: second.side, secondSpecies: second.species,
      ...(first.forme ? { firstForme: first.forme } : {}), ...(second.forme ? { secondForme: second.forme } : {}),
      ...(first.holder ? { firstHolder: first.holder } : {}), ...(second.holder ? { secondHolder: second.holder } : {}),
    };
  });
}

/** The prior's nature with its Speed effect lowered, kept neutral and raised; the other stat it moves stays. */
function speedNatures(prior: string, physical: boolean): string[] {
  const nature = Dex.natures.get(prior);
  const name = nature.exists ? nature.name : 'Hardy';
  const plus = nature.plus as StatId | undefined;
  const minus = nature.minus as StatId | undefined;
  const offense: StatId = physical ? 'atk' : 'spa';
  const other: StatId = physical ? 'spa' : 'atk';
  const lowered = minus === 'spe' ? name : natureOf(plus && plus !== 'spe' ? plus : offense, 'spe');
  const neutral = plus === 'spe' ? 'Hardy' : minus === 'spe' ? natureOf(plus ?? offense, other) : name;
  const raised = plus === 'spe' ? name : natureOf('spe', minus && minus !== 'spe' ? minus : other);
  return [...new Set([lowered, neutral, raised])];
}

/** EVs moved; a changed nature costs more than any EV move, so a Speed the prior's nature reaches keeps it. */
function cost(ctx: SolveContext, spread: SpreadCandidate, prior: SpreadCandidate): number {
  const stats = Object.keys(ZERO_EVS) as StatId[];
  return stats.reduce((sum, stat) => sum + Math.abs((spread.evs[stat] ?? 0) - (prior.evs[stat] ?? 0)), 0) +
    (spread.nature === prior.nature ? 0 : 2 * ctx.budget.total + 1);
}

function option(ctx: SolveContext, racer: Racer, spread: SpreadCandidate, plausible: boolean): Option {
  return { stat: speedStat(ctx, racer.side, racer.species, spread), spread, plausible, cost: cost(ctx, spread, racer.prior) };
}

/** The prior and round 37's plausible spreads; a known spread is the only one. */
function plausibleOptions(ctx: SolveContext, knowledge: SpeedKnowledgeMap, racer: Racer): Option[] {
  const prior = option(ctx, racer, racer.prior, true);
  if (racer.known) return [prior];
  const usage = plausibleFor(ctx, racer.side, racer.species, knowledge).map(spread =>
    option(ctx, racer, { evs: capToBudget({ ...ZERO_EVS, ...spread.evs }, new Set(), ctx.budget), nature: spread.nature }, true));
  return [prior, ...usage];
}

/** Every Speed the prior reaches by its Speed EVs and its nature's Speed effect, the cheapest spread per Speed. */
function legalOptions(ctx: SolveContext, racer: Racer): Option[] {
  const cheapest = new Map<number, Option>();
  const physical = physicalAttackerFor(ctx, racer.key);
  const steps = [...new Set([...Array.from({ length: Math.floor(ctx.budget.perStat / EV_STEP) + 1 }, (_, i) => i * EV_STEP), ctx.budget.perStat])];
  for (const nature of speedNatures(racer.prior.nature, physical)) {
    for (const spe of steps) {
      const evs = capToBudget({ ...ZERO_EVS, ...racer.prior.evs, spe }, new Set<StatId>(['spe']), ctx.budget);
      const candidate = option(ctx, racer, { evs, nature }, false);
      const known = cheapest.get(candidate.stat);
      if (!known || candidate.cost < known.cost) cheapest.set(candidate.stat, candidate);
    }
  }
  return [...cheapest.values()];
}

/**
 * The Speeds below the set's own Speed IV (round 64, decision 28): no Speed
 * EVs, the prior's nature with its Speed effect lowered, each IV down to 0.
 * A changed IV costs more than a changed nature. Asked only after every
 * legal Speed at the set's IV failed.
 */
function slowOptions(ctx: SolveContext, racer: Racer): Option[] {
  const [lowered] = speedNatures(racer.prior.nature, physicalAttackerFor(ctx, racer.key));
  const evs = capToBudget({ ...ZERO_EVS, ...racer.prior.evs, spe: 0 }, new Set<StatId>(['spe']), ctx.budget);
  const ivs = { ...MAX_IVS, ...racer.set.ivs };
  return Array.from({ length: ivs.spe }, (_, spe) => {
    const entry = option(ctx, racer, { evs, nature: lowered, ivs: { ...ivs, spe } }, false);
    return { ...entry, cost: entry.cost + 4 * ctx.budget.total + 2 };
  });
}

/** The Speeds a racer may take in a tier, slowest first; a known spread keeps its own. */
function domainOf(ctx: SolveContext, knowledge: SpeedKnowledgeMap, racer: Racer, tier: Tier): Option[] {
  const options = racer.options;
  options.plausible ??= plausibleOptions(ctx, knowledge, racer);
  if (tier === 'plausible' || racer.known) return [...options.plausible].sort((a, b) => a.stat - b.stat);
  options.legal ??= legalOptions(ctx, racer);
  if (tier === 'slow') options.slow ??= slowOptions(ctx, racer);
  return [...options.plausible, ...options.legal, ...(tier === 'slow' ? options.slow! : [])].sort((a, b) => a.stat - b.stat);
}

const beats = (first: number, second: number, strict: boolean) => (strict ? first > second : first >= second);

/** An option's Speed stat in a battle forme, asked once per forme. */
function formeStat(ctx: SolveContext, side: Side, species: string, entry: Option, forme: string): number {
  entry.formes ??= new Map();
  let stat = entry.formes.get(forme);
  if (stat === undefined) {
    stat = speedStat(ctx, side, species, entry.spread, forme);
    entry.formes.set(forme, stat);
  }
  return stat;
}

/** Both movers' readings of an order; the Scarf decisions of the moment (a later tier may add one). */
function readings(ctx: SolveContext, order: ReadOrder): [Reading, Reading] {
  const reading = (mover: RaceSide): Reading => {
    const scarf = racedWithScarf(ctx, mover);
    const { side, species, forme } = mover;
    return entry => raceSpeed(ctx.gen.num, forme ? formeStat(ctx, side, species, entry, forme) : entry.stat, scarf);
  };
  return [reading(firstOf(order)), reading(secondOf(order))];
}

/** Bounds consistency: drop every Speed no partner Speed can satisfy; false when a racer has none left. */
function propagate(domains: Map<string, Option[]>, bounds: Bound[]): boolean {
  for (let changed = true; changed;) {
    changed = false;
    for (const bound of bounds) {
      const first = domains.get(bound.first.key)!;
      const second = domains.get(bound.second.key)!;
      const slowest = Math.min(...second.map(entry => bound.secondSpeed(entry)));
      const fastest = Math.max(...first.map(entry => bound.firstSpeed(entry)));
      const keptFirst = first.filter(entry => beats(bound.firstSpeed(entry), slowest, bound.strict));
      const keptSecond = second.filter(entry => beats(fastest, bound.secondSpeed(entry), bound.strict));
      if (keptFirst.length === 0 || keptSecond.length === 0) return false;
      if (keptFirst.length !== first.length || keptSecond.length !== second.length) changed = true;
      domains.set(bound.first.key, keptFirst);
      domains.set(bound.second.key, keptSecond);
    }
  }
  return true;
}

/** A plausible spread first, then the Speed nearest the prior, then the smallest change. */
const preference = (racer: Racer) => (a: Option, b: Option) =>
  Number(b.plausible) - Number(a.plausible) || Math.abs(a.stat - racer.stat) - Math.abs(b.stat - racer.stat) || a.cost - b.cost;

/** Fix the racers one by one in keeping order, each at its most preferred Speed the others can still meet. */
function fix(start: Map<string, Option[]>, bounds: Bound[], racers: Racer[]): Map<string, Option> | null {
  let domains = start;
  for (const racer of racers) {
    const next = [...domains.get(racer.key)!].sort(preference(racer))
      .map(candidate => new Map(domains).set(racer.key, [candidate]))
      .find(trial => propagate(trial, bounds));
    if (!next) return null;
    domains = next;
  }
  return new Map([...domains].map(([key, options]) => [key, options[0]]));
}

/**
 * Who keeps its Speed first: a known spread, then the mon with more own
 * Speed evidence (decision 20: the orders its prior already satisfies, so
 * the replay measured it elsewhere), then a first mover (the second mover
 * yields on a tie, as the defensive Great Tusk of the decision does).
 */
function keepingOrder(racers: Racer[], bounds: Bound[]): Racer[] {
  const evidence = (racer: Racer) => bounds.filter(bound => !bound.broken && (bound.first === racer || bound.second === racer)).length;
  const yielding = (racer: Racer) => bounds.filter(bound => bound.broken && bound.second === racer).length;
  return [...racers].sort((a, b) => Number(b.known) - Number(a.known) || evidence(b) - evidence(a) ||
    yielding(a) - yielding(b) || a.key.localeCompare(b.key));
}

/** The races inside a cycle of orders (both directions seen): only a tie explains them. */
function cyclic(races: Race[]): Set<Race> {
  const next = new Map<Racer, Racer[]>();
  for (const race of races) next.set(race.first, [...(next.get(race.first) ?? []), race.second]);
  const reaches = (from: Racer, to: Racer) => {
    const seen = new Set([from]);
    for (const queue = [from]; queue.length > 0;) {
      const at = queue.pop()!;
      if (at === to) return true;
      for (const step of next.get(at) ?? []) {
        if (seen.has(step)) continue;
        seen.add(step);
        queue.push(step);
      }
    }
    return false;
  };
  return new Set(races.filter(race => reaches(race.second, race.first)));
}

/**
 * One tier's settling. Every race ends strict (the first mover faster, no
 * coin flip on an order the log showed) unless its priors tie it or it sits
 * in a cycle of orders. When that fails, only the races that cannot end
 * strict may tie (round 64): each other race stays strict while the rest
 * still settles, the repaired ones first, then in turn order.
 */
function solve(ctx: SolveContext, knowledge: SpeedKnowledgeMap, racers: Racer[], races: Race[], tier: Tier): Map<string, Option> | null {
  const loops = cyclic(races);
  const strict = races.map(race => {
    const { first, second, broken } = race;
    const [firstSpeed, secondSpeed] = readings(ctx, race.order);
    const tied = firstSpeed(first.self) === secondSpeed(second.self);
    return { first, second, broken, firstSpeed, secondSpeed, strict: !tied && !loops.has(race) };
  });
  const attempt = (bounds: Bound[]) => {
    const domains = new Map(racers.map(racer => [racer.key, domainOf(ctx, knowledge, racer, tier)]));
    return propagate(domains, bounds) ? fix(domains, bounds, keepingOrder(racers, bounds)) : null;
  };
  const settled = attempt(strict);
  if (settled) return settled;
  const bounds = strict.map(bound => ({ ...bound, strict: false }));
  const keeping = races.map((race, index) => ({ race, index })).filter(({ index }) => strict[index].strict)
    .sort((a, b) => Number(b.race.broken) - Number(a.race.broken) || a.race.order.turn - b.race.order.turn);
  for (const { index } of keeping) {
    bounds[index] = strict[index];
    if (!attempt(bounds)) bounds[index] = { ...strict[index], strict: false };
  }
  return attempt(bounds);
}

/** The last tier: a Scarf on one first mover of a broken race round 37 allows, with any legal Speed. */
function withScarf(ctx: SolveContext, knowledge: SpeedKnowledgeMap, racers: Racer[], races: Race[]): Map<string, Option> | null {
  // A copied race's item is its holder's, never the copied Pokémon's.
  for (const racer of new Set(races.filter(race => race.broken && !race.order.firstHolder).map(race => race.first))) {
    if (ctx.scarf.has(racer.key) || !scarfAllowed(ctx, racer.side, racer.species, knowledge)) continue;
    ctx.scarf.set(racer.key, 'holds');
    const settled = solve(ctx, knowledge, racers, races, 'legal');
    if (settled) return settled;
    ctx.scarf.delete(racer.key);
  }
  return null;
}

/**
 * The tiers in order; the weak races go before a Speed IV below 31 does
 * (a weak race may be no race, so it asks for nothing), and both before a
 * new Scarf.
 */
function settleComponent(ctx: SolveContext, knowledge: SpeedKnowledgeMap, racers: Racer[], races: Race[]): Map<string, Option> | null {
  const strong = races.filter(race => !race.weak);
  return solve(ctx, knowledge, racers, races, 'plausible') ??
    solve(ctx, knowledge, racers, races, 'legal') ??
    (strong.length < races.length ? solve(ctx, knowledge, racers, strong, 'legal') : null) ??
    solve(ctx, knowledge, racers, strong, 'slow') ??
    withScarf(ctx, knowledge, racers, strong);
}

/** The races grouped by the mons they share. */
function components(races: Race[]): Race[][] {
  const parent = new Map<string, string>();
  const find = (key: string): string => {
    const up = parent.get(key) ?? key;
    return up === key ? key : find(up);
  };
  for (const race of races) parent.set(find(race.first.key), find(race.second.key));
  const groups = new Map<string, Race[]>();
  for (const race of races) groups.set(find(race.first.key), [...(groups.get(find(race.first.key)) ?? []), race]);
  return [...groups.values()];
}

function racerFor(ctx: SolveContext, knowledge: SpeedKnowledgeMap, side: Side, species: string): Racer {
  const set = setOf(ctx, side, species)!;
  const prior: SpreadCandidate = { evs: { ...ZERO_EVS, ...set.evs }, nature: set.nature || 'Hardy' };
  const key = keyOf(side, species);
  const stat = speedStat(ctx, side, species, prior);
  return {
    key, side, species, set, prior, stat, self: { stat, spread: prior, plausible: true, cost: 0 },
    known: knowledge.get(key)?.spreadKnown ?? false, options: {},
  };
}

/**
 * The solve's sets with every order holding (T117): the sets themselves
 * when no order breaks, else copies whose settled mons carry the new
 * spread. A Scarf the last tier adds lands in `ctx.scarf`.
 */
export function settledSets(ctx: SolveContext, knowledge: SpeedKnowledgeMap): Sets {
  const racers = new Map<string, Racer>();
  const racer = (side: Side, species: string) => {
    const key = keyOf(side, species);
    if (!racers.has(key)) racers.set(key, racerFor(ctx, knowledge, side, species));
    return racers.get(key)!;
  };
  const races: Race[] = ctx.speedOrders.map(order => {
    const first = racer(order.firstSide, order.firstSpecies);
    const second = racer(order.secondSide, order.secondSpecies);
    const [firstSpeed, secondSpeed] = readings(ctx, order);
    const broken = !beats(firstSpeed(first.self), secondSpeed(second.self), false);
    return { order, first, second, weak: weakRace(ctx, order), broken };
  });
  const spreads = new Map<PokemonSet, SpreadCandidate>();
  for (const component of components(races)) {
    if (!component.some(race => race.broken)) continue;
    const members = [...new Set(component.flatMap(race => [race.first, race.second]))];
    const settled = settleComponent(ctx, knowledge, members, component);
    for (const member of members) {
      const chosen = settled?.get(member.key);
      if (chosen && chosen.cost > 0) spreads.set(member.set, chosen.spread);
    }
  }
  if (spreads.size === 0) return ctx.sets;
  const apply = (set: PokemonSet) => {
    const spread = spreads.get(set);
    return spread ? { ...set, evs: spread.evs, nature: spread.nature, ...(spread.ivs ? { ivs: spread.ivs } : {}) } : set;
  };
  return { p1: ctx.sets.p1.map(apply), p2: ctx.sets.p2.map(apply) };
}
