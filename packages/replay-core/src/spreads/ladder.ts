import type { RulesDex } from '../rules-dex.ts';
import type { PokemonEvs } from '../types.ts';
import { capToBudget, ZERO_EVS, type EvBudget } from './ev-budget.ts';
import { toId } from '../ids.ts';

/** Where a solved spread comes from: damage lines fitted it, a proven move order decided it, the log's maximum HP set its HP inside the guess, or no evidence measured it. */
export type SpreadOrigin = 'damage' | 'order' | 'hp' | 'prior';

/** A solved spread: EVs and nature, with what measured it and the item or IVs the evidence decided. */
export interface SpreadCandidate {
  evs: PokemonEvs;
  nature: string;
  /** What measured the spread; absent reads as 'damage'. */
  origin?: SpreadOrigin;
  /** An item the move-order evidence decided: 'Choice Scarf', or '' for "not the guessed Scarf". */
  item?: string;
  /**
   * Why the item is decided: the move order, the damage lines dropped a guessed boost item, or a knockout no spread reaches that a
   * usage-listed boost item does ('boost': `item` names it).
   */
  itemReason?: 'moved-first' | 'moved-second' | 'no-boost' | 'boost';
  /** IVs a seen move order needed (a Speed IV below 31 only when no other Speed keeps the order). */
  ivs?: PokemonEvs;
}

/** One rung of the ladder: a legal spread, scored with or without the set's item. */
export interface CandidateRung {
  evs: PokemonEvs;
  nature: string;
  /** '' scores the rung without the set's guessed boost item; a name scores it with that item; undefined keeps the set's item. */
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

/** The rung's nature from its option natures; null when two options claim a nature or when a kept stat's plus nature must stay. */
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

/**
 * A kept Speed keeps a nature that lowers it (the settled orders may need it): a rung's plus nature takes Speed as its minus, a rung
 * without one keeps the prior's nature.
 */
function slowNature(nature: string | null, ctx: LadderContext): string | null {
  if (!ctx.slowKept || nature === null) return nature;
  const plus = ctx.dex.natures.get(nature).plus as keyof PokemonEvs | undefined;
  return plus && nature !== ctx.priorNature ? natureOf(ctx.dex, plus, 'spe') : ctx.prior.nature;
}

const fixedStats = (fixed: Partial<PokemonEvs>): Set<keyof PokemonEvs> =>
  new Set((Object.keys(fixed) as (keyof PokemonEvs)[]).filter(stat => fixed[stat] !== undefined));

/** Every positive claim of the rung survived the budget in full (fixed stats override their claims). */
function expressed(evs: PokemonEvs, claimed: Partial<PokemonEvs>, fixed: Partial<PokemonEvs>): boolean {
  return (Object.entries(claimed) as [keyof PokemonEvs, number | undefined][])
    .every(([stat, value]) => !value || fixed[stat] !== undefined || (evs[stat] ?? 0) >= value);
}

/**
 * One rung's legal spread: the prior with the rung's overrides, rung-claimed stats protected, prior carry-overs giving way first, kept
 * prior stats last (capToBudget); a fixed stat overrides the rung's claim on it and is never shaved.
 */
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
  /** Speed is kept and the prior's nature lowers it. */
  slowKept: boolean;
}

/**
 * A kept stat keeps its plus nature too: a bulk or offense nature would
 * lower the very stat the evidence cannot measure.
 */
const keepsNature = (keep: ReadonlySet<keyof PokemonEvs>, priorPlus: keyof PokemonEvs | undefined): boolean =>
  priorPlus !== undefined && keep.has(priorPlus);

/**
 * The prior rung: the prior legalized around the same kept and fixed stats as the composed ones. When a kept offense and a kept Speed
 * do not both fit beside the fixed stats, the kept order shaves the offense; a second prior rung lets the Speed give way instead, its
 * speed nature neutralized. Knock-out lower bounds and move orders decide between them; at equal error the prior's nature wins (priorDistance).
 */
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

/**
 * A kept Speed keeps its plus nature, which would block every rung with a nature of its own, and a Jolly attacker stayed 10 % short of
 * the hits it dealt. The offense nature of the seen hit class (Adamant for physical lines, Modest for special) opens beside the kept
 * Speed EVs; bestRung prices the order the neutral Speed may no longer win, so the tempo gives way only when the fit error falls and every
 * observed order still holds. A bulk nature never opens, and a kept offense keeps its nature.
 */
function heldTempoNature(ctx: LadderContext, options: RungOption[]): string | null {
  const natures = options.map(option => option.nature).filter((nature): nature is string => !!nature);
  const offenseNature = options[0]?.nature;
  return ctx.priorPlus === 'spe' && ctx.keep.has('spe') && offenseNature && natures.length === 1 ? offenseNature : null;
}

/**
 * One combination's rung, composed beside the kept stats and offered only when the budget expresses every claim: a shaved claim would
 * leave its nature standing on nothing ("Calm 252 HP / 4 SpD / 252 Spe" once Speed stays kept). When it cannot, the released form is
 * the fallback; the prior rung stands behind both.
 */
function offeredRung(ctx: LadderContext, options: RungOption[]): CandidateRung | null {
  const claimed: Partial<PokemonEvs> = Object.assign({}, ...options.map(option => option.evs ?? {}));
  const evs = composeRung(ctx.prior, claimed, ctx.keep, ctx.budget, ctx.fixed);
  if (expressed(evs, claimed, ctx.fixed)) {
    const nature = slowNature(rungNature(options, keepsNature(ctx.keep, ctx.priorPlus), ctx.priorNature) ?? heldTempoNature(ctx, options), ctx);
    return nature === null ? null : { evs, nature };
  }
  return releasedRung(ctx, options, claimed, evs);
}

/**
 * A kept Speed gives way to an offense claim the budget cannot express beside it: a satisfied order measures nothing downward while
 * clean damage lines measure the offense, and with the log's HP fixed only one of the two fits, so the measured one wins the room. The
 * released Speed loses its plus nature, which frees the offense-plus rung. A bulk claim never releases Speed (a 252-HP rung must not
 * strip it), and a kept offense never gives way. bestRung decides between the released body and the 0-offense rungs; its order check
 * prices a released body that no longer moves first.
 */
function releasedRung(ctx: LadderContext, options: RungOption[], claimed: Partial<PokemonEvs>, kept: PokemonEvs): CandidateRung | null {
  const offenseStarved = (kept[ctx.offenseStat] ?? 0) < (claimed[ctx.offenseStat] ?? 0);
  if (!ctx.keep.has('spe') || !offenseStarved) return null;
  const released = new Set([...ctx.keep].filter(stat => stat !== 'spe'));
  const nature = rungNature(options, keepsNature(released, ctx.priorPlus), ctx.priorPlus === 'spe' ? 'Hardy' : ctx.priorNature);
  if (nature === null) return null;
  const evs = composeRung(ctx.prior, claimed, released, ctx.budget, ctx.fixed);
  return expressed(evs, claimed, ctx.fixed) ? { evs, nature } : null;
}

/**
 * A Speed no move order measures keeps the prior: damage carries no Speed information, yet the budget gave the prior's Speed EVs to an
 * offense or bulk claim for a fit-error difference of 0.00004 to 0.00024. The EVs are fixed like the log's HP, a claim the budget cannot
 * express beside them is not offered, and the Speed is kept for the nature policy. A Speed a satisfied or unrepairable order kept already
 * (`keep`) stays releasable by a measured offense.
 */
function unmeasuredTempo(prior: SpreadCandidate, hasSpeedObs: boolean, keep: ReadonlySet<keyof PokemonEvs>): boolean {
  return !hasSpeedObs && !keep.has('spe') && (prior.evs.spe ?? 0) > 0;
}

/**
 * The discrete ladder: offense {0, max, max + nature} × bulk {uninvested, max HP, max HP + max Def or SpD, + nature} × Speed {kept, 0, max,
 * max + nature}, plus the prior rung. Offense-plus and bulk-plus natures conflict (a nature boosts one stat), so those combinations are
 * skipped. Every rung inherits the prior and overrides only what the observations can measure: offense with attacker observations, bulk
 * with defender observations, Speed only under a move order (damage carries no Speed information). A prior nature is neutralized to Hardy
 * only when it boosts a measured stat the rung claims uninvested. `keep` names prior stats the evidence cannot measure at all (an offense
 * seen only in knock-outs, a Speed no rung can bring in line with the observed order): they keep the prior's value and give way last in
 * the budget, after the rung's claims; a kept Speed gives way to an offense claim the budget cannot express beside it, a kept offense
 * never gives way. `fixed` stats (the log's HP) override a rung's claim on them.
 */
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
