import type { RulesDex } from '../rules-dex.ts';
import type { PokemonEvs } from '../types.ts';
import { capToBudget, ZERO_EVS, type EvBudget } from './ev-budget.ts';
import { toId } from '../ids.ts';

/** Where a solved spread comes from: damage lines, a proven move order, the log's maximum HP, or no evidence. */
export type SpreadOrigin = 'damage' | 'order' | 'hp' | 'prior';

/** A solved spread: EVs and nature, with what measured it and the item or IVs the evidence decided. */
export interface SpreadCandidate {
  evs: PokemonEvs;
  nature: string;
  /** What measured the spread; absent reads as 'damage'. */
  origin?: SpreadOrigin;
  /** An item the move-order evidence decided: 'Choice Scarf', or '' for "not the guessed Scarf". */
  item?: string;
  /** Why the item is decided: the move order, a dropped guessed boost item, or a knockout's boost item (`item`). */
  itemReason?: 'moved-first' | 'moved-second' | 'no-boost' | 'boost';
  /** IVs a seen move order needed (a Speed IV below 31 only when no other Speed keeps the order). */
  ivs?: PokemonEvs;
}

/** One rung of the ladder: a legal spread, scored with or without the set's item. */
export interface CandidateRung {
  evs: PokemonEvs;
  nature: string;
  /** '' scores the rung without the set's guessed boost item; a name scores it with that item; undefined: the set's. */
  item?: string;
}

const NATURE_PLUS: Record<string, keyof PokemonEvs> = {
  adamant: 'atk', lonely: 'atk', brave: 'atk', naughty: 'atk',
  modest: 'spa', quiet: 'spa', mild: 'spa', rash: 'spa',
  bold: 'def', impish: 'def', lax: 'def', relaxed: 'def',
  calm: 'spd', careful: 'spd', gentle: 'spd', sassy: 'spd',
  timid: 'spe', jolly: 'spe', hasty: 'spe', naive: 'spe',
};

type RungOption = { evs?: Partial<PokemonEvs>; nature?: string };

function offenseRungs(offenseStat: 'atk' | 'spa', offensePlus: string, max: number, hasAttackerObs: boolean): RungOption[] {
  return hasAttackerObs
    ? [
      { evs: { [offenseStat]: 0 } },
      { evs: { [offenseStat]: max } },
      { evs: { [offenseStat]: max }, nature: offensePlus },
    ]
    : [{}];
}

function bulkRungs(max: number, hasDefenderObs: boolean): RungOption[] {
  return hasDefenderObs
    ? [
      { evs: { hp: 0, def: 0, spd: 0 } },
      { evs: { hp: max, def: 0, spd: 0 } },
      { evs: { hp: max, def: max, spd: 0 } },
      { evs: { hp: max, def: 0, spd: max } },
      { evs: { hp: max, def: max, spd: 0 }, nature: 'Bold' },
      { evs: { hp: max, def: 0, spd: max }, nature: 'Calm' },
    ]
    : [{}];
}

function speedRungs(speedPlus: string, max: number, hasSpeedObs: boolean): RungOption[] {
  return hasSpeedObs
    ? [{}, { evs: { spe: 0 } }, { evs: { spe: max } }, { evs: { spe: max }, nature: speedPlus }]
    : [{}];
}

function measuredStats(offenseStat: 'atk' | 'spa', hasAttackerObs: boolean, hasDefenderObs: boolean, hasSpeedObs: boolean): Set<keyof PokemonEvs> {
  return new Set<keyof PokemonEvs>([
    ...(hasAttackerObs ? [offenseStat as keyof PokemonEvs] : []),
    ...(hasDefenderObs ? (['def', 'spd'] as (keyof PokemonEvs)[]) : []),
    ...(hasSpeedObs ? (['spe'] as (keyof PokemonEvs)[]) : []),
  ]);
}

// null when two options claim a nature or a kept stat's plus nature must stay.
function rungNature(options: RungOption[], keepNature: boolean, priorNature: string): string | null {
  const natures = options.map(option => option.nature).filter((nature): nature is string => !!nature);
  if (natures.length > 1 || (keepNature && natures.length > 0)) return null;
  return natures[0] ?? priorNature;
}

/** The nature raising `plus` and lowering `minus`, from the Dex; neutral when both name one stat. */
export function natureOf(dex: RulesDex, plus: keyof PokemonEvs, minus: keyof PokemonEvs): string {
  if (plus === minus) return 'Hardy';
  return dex.natures.all().find(nature => nature.plus === plus && nature.minus === minus)?.name ?? 'Hardy';
}

// A kept Speed keeps a nature that lowers it: the settled orders may need it.
function slowNature(nature: string | null, ctx: LadderContext): string | null {
  if (!ctx.slowKept || nature === null) return nature;
  const plus = ctx.dex.natures.get(nature).plus as keyof PokemonEvs | undefined;
  return plus && nature !== ctx.priorNature ? natureOf(ctx.dex, plus, 'spe') : ctx.prior.nature;
}

const fixedStats = (fixed: Partial<PokemonEvs>): Set<keyof PokemonEvs> =>
  new Set((Object.keys(fixed) as (keyof PokemonEvs)[]).filter(stat => fixed[stat] !== undefined));

function expressed(evs: PokemonEvs, claimed: Partial<PokemonEvs>, fixed: Partial<PokemonEvs>): boolean {
  return (Object.entries(claimed) as [keyof PokemonEvs, number | undefined][])
    .every(([stat, value]) => !value || fixed[stat] !== undefined || (evs[stat] ?? 0) >= value);
}

function composeRung(
  prior: SpreadCandidate, overrides: Partial<PokemonEvs>, keep: ReadonlySet<keyof PokemonEvs>, budget: EvBudget,
  fixed: Partial<PokemonEvs>,
): PokemonEvs {
  const claimed = { ...overrides, ...fixed };
  const protectedStats = new Set((Object.entries(claimed) as [keyof PokemonEvs, number][])
    .filter(([, value]) => (value ?? 0) > 0)
    .map(([stat]) => stat));
  const kept = new Set([...keep].filter(stat => claimed[stat] === undefined && (prior.evs[stat] ?? 0) > 0));
  return capToBudget({ ...ZERO_EVS, ...prior.evs, ...claimed }, protectedStats, budget, kept, fixedStats(fixed));
}

interface LadderContext {
  dex: RulesDex;
  prior: SpreadCandidate;
  budget: EvBudget;
  fixed: Partial<PokemonEvs>;
  keep: ReadonlySet<keyof PokemonEvs>;
  offenseStat: 'atk' | 'spa';
  priorPlus: keyof PokemonEvs | undefined;
  priorNature: string;
  slowKept: boolean;
}

// A kept stat keeps its plus nature: another nature would lower the very stat the evidence cannot measure.
const keepsNature = (keep: ReadonlySet<keyof PokemonEvs>, priorPlus: keyof PokemonEvs | undefined): boolean =>
  priorPlus !== undefined && keep.has(priorPlus);

// A second prior rung lets a kept Speed give way to a kept offense when both do not fit beside the fixed stats.
function priorRungs(ctx: LadderContext): CandidateRung[] {
  const { prior, keep, fixed, budget } = ctx;
  const evs = { ...ZERO_EVS, ...prior.evs, ...fixed };
  const kept = new Set([...keep].filter(stat => fixed[stat] === undefined && (prior.evs[stat] ?? 0) > 0));
  const first: CandidateRung = { evs: capToBudget(evs, new Set(), budget, kept, fixedStats(fixed)), nature: prior.nature };
  const offenseShaved = (first.evs[ctx.offenseStat] ?? 0) < (prior.evs[ctx.offenseStat] ?? 0);
  if (!kept.has(ctx.offenseStat) || !kept.has('spe') || !offenseShaved) return [first];
  const released = new Set([...kept].filter(stat => stat !== 'spe'));
  return [first, {
    evs: capToBudget(evs, new Set(), budget, released, fixedStats(fixed)),
    nature: ctx.priorPlus === 'spe' ? 'Hardy' : prior.nature,
  }];
}

// The offense nature of the seen hit class opens beside the kept Speed EVs; bestRung prices the orders it may break.
function heldTempoNature(ctx: LadderContext, options: RungOption[]): string | null {
  const natures = options.map(option => option.nature).filter((nature): nature is string => !!nature);
  const offenseNature = options[0]?.nature;
  return ctx.priorPlus === 'spe' && ctx.keep.has('spe') && offenseNature && natures.length === 1 ? offenseNature : null;
}

// Offered only when the budget expresses every claim: a shaved claim would leave its nature standing on nothing.
function offeredRung(ctx: LadderContext, options: RungOption[]): CandidateRung | null {
  const claimed: Partial<PokemonEvs> = Object.assign({}, ...options.map(option => option.evs ?? {}));
  const evs = composeRung(ctx.prior, claimed, ctx.keep, ctx.budget, ctx.fixed);
  if (expressed(evs, claimed, ctx.fixed)) {
    const nature = slowNature(rungNature(options, keepsNature(ctx.keep, ctx.priorPlus), ctx.priorNature) ?? heldTempoNature(ctx, options), ctx);
    return nature === null ? null : { evs, nature };
  }
  return releasedRung(ctx, options, claimed, evs);
}

// A kept Speed gives way to an offense claim the budget cannot express beside it, never to a bulk claim;
// a kept offense never gives way. bestRung prices a released body that no longer moves first.
function releasedRung(ctx: LadderContext, options: RungOption[], claimed: Partial<PokemonEvs>, kept: PokemonEvs): CandidateRung | null {
  const offenseStarved = (kept[ctx.offenseStat] ?? 0) < (claimed[ctx.offenseStat] ?? 0);
  if (!ctx.keep.has('spe') || !offenseStarved) return null;
  const released = new Set([...ctx.keep].filter(stat => stat !== 'spe'));
  const nature = rungNature(options, keepsNature(released, ctx.priorPlus), ctx.priorPlus === 'spe' ? 'Hardy' : ctx.priorNature);
  if (nature === null) return null;
  const evs = composeRung(ctx.prior, claimed, released, ctx.budget, ctx.fixed);
  return expressed(evs, claimed, ctx.fixed) ? { evs, nature } : null;
}

// A Speed no move order measures keeps the prior: damage carries no Speed information.
function unmeasuredTempo(prior: SpreadCandidate, hasSpeedObs: boolean, keep: ReadonlySet<keyof PokemonEvs>): boolean {
  return !hasSpeedObs && !keep.has('spe') && (prior.evs.spe ?? 0) > 0;
}

/** The discrete ladder: offense, bulk and Speed combinations beside the prior rung, each inheriting the prior. */
export function candidateLadder(
  dex: RulesDex,
  prior: SpreadCandidate,
  physicalAttacker: boolean,
  hasAttackerObs: boolean,
  hasDefenderObs: boolean,
  hasSpeedObs: boolean,
  budget: EvBudget,
  keep: ReadonlySet<keyof PokemonEvs> = new Set(),
  fixed: Partial<PokemonEvs> = {},
): CandidateRung[] {
  const held = unmeasuredTempo(prior, hasSpeedObs, keep);
  const keptAll = held ? new Set([...keep, 'spe' as const]) : keep;
  const fixedAll = held ? { ...fixed, spe: prior.evs.spe } : fixed;
  const max = budget.perStat;
  const offenseStat = physicalAttacker ? 'atk' : 'spa';
  const offense = offenseRungs(offenseStat, physicalAttacker ? 'Adamant' : 'Modest', max, hasAttackerObs);
  const bulk = bulkRungs(max, hasDefenderObs);
  const speed = speedRungs(physicalAttacker ? 'Jolly' : 'Timid', max, hasSpeedObs);

  const measured = measuredStats(offenseStat, hasAttackerObs, hasDefenderObs, hasSpeedObs);
  const priorPlus = NATURE_PLUS[toId(prior.nature)];
  const ctx: LadderContext = {
    dex, prior, budget, fixed: fixedAll, keep: keptAll, offenseStat, priorPlus,
    priorNature: priorPlus && measured.has(priorPlus) ? 'Hardy' : prior.nature,
    slowKept: keptAll.has('spe') && dex.natures.get(prior.nature).minus === 'spe',
  };
  const rungs = priorRungs(ctx);
  for (const o of offense) {
    for (const b of bulk) {
      for (const s of speed) {
        const rung = offeredRung(ctx, [o, b, s]);
        if (rung) rungs.push(rung);
      }
    }
  }
  return rungs;
}
