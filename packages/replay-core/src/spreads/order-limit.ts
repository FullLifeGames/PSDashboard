import type { RulesDex } from '../rules-dex.ts';
import { dexOfCalc } from '../rules-dex.ts';
import type { PokemonSet } from '@pkmn/sim';
import type { PokemonEvs, SpeedOrderObservation } from '../types.ts';
import { capToBudget, evStep, evsOfSet, onBudgetScale, ZERO_EVS } from './ev-budget.ts';
import {
  firstOf, keyOf, physicalAttackerFor, racedWithScarf, secondOf, setOf, speedStat, weakRace, type RaceSide, type ReadOrder, type SolveContext,
} from './fit.ts';
import { raceSpeed } from './race-speed.ts';
import { originIn } from './battle-forme.ts';
import { plausibleFor, scarfAllowed, type SpeedKnowledgeMap } from './scarf.ts';
import { natureOf, type SpreadCandidate } from './ladder.ts';


type Side = 'p1' | 'p2';
type Sets = { p1: PokemonSet[]; p2: PokemonSet[] };
type StatId = keyof PokemonEvs;
type Tier = 'plausible' | 'restored' | 'legal' | 'slow';

interface Option { stat: number; spread: SpreadCandidate; plausible: boolean; cost: number; formes?: Map<string, number> }

interface Racer {
  key: string;
  side: Side;
  species: string;
  set: PokemonSet;
  prior: SpreadCandidate;
  stat: number;
  self: Option;
  known: boolean;
  options: Partial<Record<Tier, Option[]>>;
}

interface Race { order: ReadOrder; first: Racer; second: Racer; weak: boolean; broken: boolean }
type Reading = (option: Option) => number;
interface Bound { first: Racer; second: Racer; firstSpeed: Reading; secondSpeed: Reading; broken: boolean; strict: boolean }

const MAX_IVS: PokemonEvs = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };
const IV_COST = 1;

const lowSpeedIv = (ctx: SolveContext, racer: Racer): boolean => !ctx.budget.statPoints && (racer.set.ivs?.spe ?? 31) < 31;

const restoredIvs = (racer: Racer): PokemonEvs => ({ ...MAX_IVS, ...racer.set.ivs, spe: 31 });

// A forme on the same base Speed (Ogerpon's Tera masks) raced on the set's Speed; one with its own Speed (a Mega,
// Terapagos-Terastal) raced on its base Speed with the set's spread, so the race keeps the forme.
function racedAs(dex: RulesDex, sets: PokemonSet[], species: string): { species: string; forme?: string } {
  const origin = originIn(dex, sets, species);
  if (!origin) return { species };
  const forme = dex.species.get(species);
  const base = dex.species.get(origin);
  return base.baseStats.spe === forme.baseStats.spe ? { species: base.name } : { species: base.name, forme: forme.name };
}

function readMover(
  dex: RulesDex, sets: Sets, side: Side, species: string, copied?: { side: Side; species: string },
): Omit<RaceSide, 'held'> {
  const own = racedAs(dex, sets[side], species);
  if (!copied) return { side, ...own };
  return { ...racedAs(dex, sets[copied.side], copied.species), side: copied.side, holder: { side, species: own.species } };
}

/** The orders with each mover named as the set that raced, plus its forme and the holder of a copied race. */
export function readableOrders(orders: SpeedOrderObservation[], sets: Sets, dex: RulesDex): ReadOrder[] {
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

function speedNatures(dex: RulesDex, prior: string, physical: boolean): string[] {
  const nature = dex.natures.get(prior);
  const name = nature.exists ? nature.name : 'Hardy';
  const plus = nature.plus as StatId | undefined;
  const minus = nature.minus as StatId | undefined;
  const offense: StatId = physical ? 'atk' : 'spa';
  const other: StatId = physical ? 'spa' : 'atk';
  const lowered = minus === 'spe' ? name : natureOf(dex, plus && plus !== 'spe' ? plus : offense, 'spe');
  const neutral = plus === 'spe' ? 'Hardy' : minus === 'spe' ? natureOf(dex, plus ?? offense, other) : name;
  const raised = plus === 'spe' ? name : natureOf(dex, 'spe', minus && minus !== 'spe' ? minus : other);
  return [...new Set([lowered, neutral, raised])];
}

function cost(ctx: SolveContext, spread: SpreadCandidate, prior: SpreadCandidate): number {
  const stats = Object.keys(ZERO_EVS) as StatId[];
  return stats.reduce((sum, stat) => sum + Math.abs((spread.evs[stat] ?? 0) - (prior.evs[stat] ?? 0)), 0) +
    (spread.nature === prior.nature ? 0 : 2 * ctx.budget.total + 1);
}

function option(ctx: SolveContext, racer: Racer, spread: SpreadCandidate, plausible: boolean): Option {
  return { stat: speedStat(ctx, racer.side, racer.species, spread), spread, plausible, cost: cost(ctx, spread, racer.prior) };
}

function plausibleOptions(ctx: SolveContext, knowledge: SpeedKnowledgeMap, racer: Racer): Option[] {
  const prior = option(ctx, racer, racer.prior, true);
  if (racer.known) return [prior];
  const usage = plausibleFor(ctx, racer.side, racer.species, knowledge).map(spread =>
    option(ctx, racer, { evs: capToBudget(onBudgetScale({ ...ZERO_EVS, ...spread.evs }, ctx.budget), new Set(), ctx.budget), nature: spread.nature }, true));
  return [prior, ...usage];
}

function legalOptions(ctx: SolveContext, racer: Racer): Option[] {
  const cheapest = new Map<number, Option>();
  const physical = physicalAttackerFor(ctx, racer.key);
  const step = evStep(ctx.budget);
  const steps = [...new Set([...Array.from({ length: Math.floor(ctx.budget.perStat / step) + 1 }, (_, i) => i * step), ctx.budget.perStat])];
  const restored = lowSpeedIv(ctx, racer);
  for (const nature of speedNatures(dexOfCalc(ctx.gen), racer.prior.nature, physical)) {
    for (const spe of steps) {
      const evs = capToBudget({ ...ZERO_EVS, ...racer.prior.evs, spe }, new Set<StatId>(['spe']), ctx.budget);
      const candidate = restored
        ? { ...option(ctx, racer, { evs, nature, ivs: restoredIvs(racer) }, false), cost: cost(ctx, { evs, nature }, racer.prior) + IV_COST }
        : option(ctx, racer, { evs, nature }, false);
      const known = cheapest.get(candidate.stat);
      if (!known || candidate.cost < known.cost) cheapest.set(candidate.stat, candidate);
    }
  }
  return [...cheapest.values()];
}

// Asked only after every legal Speed at the set's IV failed; Champions has no IVs to lower (statModify reads none).
function slowOptions(ctx: SolveContext, racer: Racer): Option[] {
  if (ctx.budget.statPoints) return [];
  const [lowered] = speedNatures(dexOfCalc(ctx.gen), racer.prior.nature, physicalAttackerFor(ctx, racer.key));
  const evs = capToBudget({ ...ZERO_EVS, ...racer.prior.evs, spe: 0 }, new Set<StatId>(['spe']), ctx.budget);
  const ivs = { ...MAX_IVS, ...racer.set.ivs };
  return Array.from({ length: ivs.spe }, (_, spe) => {
    const entry = option(ctx, racer, { evs, nature: lowered, ivs: { ...ivs, spe } }, false);
    return { ...entry, cost: entry.cost + 4 * ctx.budget.total + 2 };
  });
}

function restoredOptions(ctx: SolveContext, racer: Racer): Option[] {
  if (!lowSpeedIv(ctx, racer)) return [];
  const entry = option(ctx, racer, { ...racer.prior, ivs: restoredIvs(racer) }, false);
  return [{ ...entry, cost: entry.cost + IV_COST }];
}

function domainOf(ctx: SolveContext, knowledge: SpeedKnowledgeMap, racer: Racer, tier: Tier): Option[] {
  const options = racer.options;
  options.plausible ??= plausibleOptions(ctx, knowledge, racer);
  if (tier === 'plausible' || racer.known) return [...options.plausible].sort((a, b) => a.stat - b.stat);
  if (tier === 'restored') return [...options.plausible, ...(options.restored ??= restoredOptions(ctx, racer))].sort((a, b) => a.stat - b.stat);
  options.legal ??= legalOptions(ctx, racer);
  if (tier === 'slow') options.slow ??= slowOptions(ctx, racer);
  return [...options.plausible, ...options.legal, ...(tier === 'slow' ? options.slow! : [])].sort((a, b) => a.stat - b.stat);
}

const beats = (first: number, second: number, strict: boolean) => (strict ? first > second : first >= second);

function formeStat(ctx: SolveContext, side: Side, species: string, entry: Option, forme: string): number {
  entry.formes ??= new Map();
  let stat = entry.formes.get(forme);
  if (stat === undefined) {
    stat = speedStat(ctx, side, species, entry.spread, forme);
    entry.formes.set(forme, stat);
  }
  return stat;
}

// A later tier may add a Scarf decision, so the readings take the decisions of the moment.
function readings(ctx: SolveContext, order: ReadOrder): [Reading, Reading] {
  const reading = (mover: RaceSide): Reading => {
    const scarf = racedWithScarf(ctx, mover);
    const { side, species, forme, speed, pick } = mover;
    return entry => raceSpeed(dexOfCalc(ctx.gen), forme ? formeStat(ctx, side, species, entry, forme) : entry.stat, scarf, speed, pick);
  };
  return [reading(firstOf(order)), reading(secondOf(order))];
}

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

const preference = (racer: Racer) => (a: Option, b: Option) =>
  Number(b.plausible) - Number(a.plausible) || Math.abs(a.stat - racer.stat) - Math.abs(b.stat - racer.stat) || a.cost - b.cost;

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

function keepingOrder(racers: Racer[], bounds: Bound[]): Racer[] {
  const evidence = (racer: Racer) => bounds.filter(bound => !bound.broken && (bound.first === racer || bound.second === racer)).length;
  const yielding = (racer: Racer) => bounds.filter(bound => bound.broken && bound.second === racer).length;
  return [...racers].sort((a, b) => Number(b.known) - Number(a.known) || evidence(b) - evidence(a) ||
    yielding(a) - yielding(b) || a.key.localeCompare(b.key));
}

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

function settleComponent(ctx: SolveContext, knowledge: SpeedKnowledgeMap, racers: Racer[], races: Race[]): Map<string, Option> | null {
  const strong = races.filter(race => !race.weak);
  return solve(ctx, knowledge, racers, races, 'plausible') ??
    solve(ctx, knowledge, racers, races, 'restored') ??
    solve(ctx, knowledge, racers, races, 'legal') ??
    (strong.length < races.length ? solve(ctx, knowledge, racers, strong, 'legal') : null) ??
    solve(ctx, knowledge, racers, strong, 'slow') ??
    withScarf(ctx, knowledge, racers, strong);
}

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
  const prior: SpreadCandidate = { evs: evsOfSet(set.evs, ctx.budget), nature: set.nature || 'Hardy' };
  const key = keyOf(side, species);
  const stat = speedStat(ctx, side, species, prior);
  return {
    key, side, species, set, prior, stat, self: { stat, spread: prior, plausible: true, cost: 0 },
    known: knowledge.get(key)?.spreadKnown ?? false, options: {},
  };
}

/** The solve's sets with every order holding; a Scarf the last tier adds lands in `ctx.scarf`. */
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
