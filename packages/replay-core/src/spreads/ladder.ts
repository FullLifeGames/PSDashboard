import type { PokemonEvs } from '../types.ts';
import { capToBudget, ZERO_EVS, type EvBudget } from './ev-budget.ts';
import { toId } from '../ids.ts';

export interface SpreadCandidate {
  evs: PokemonEvs;
  nature: string;
  /** An item the move-order evidence decided (round 37): 'Choice Scarf', or '' for "not the guessed Scarf". */
  item?: string;
  itemReason?: 'moved-first' | 'moved-second';
}

export interface CandidateRung {
  evs: PokemonEvs;
  nature: string;
}

/** The stat a nature boosts — for deciding whether a rung must neutralize it. */
const NATURE_PLUS: Record<string, keyof PokemonEvs> = {
  adamant: 'atk', lonely: 'atk', brave: 'atk', naughty: 'atk',
  modest: 'spa', quiet: 'spa', mild: 'spa', rash: 'spa',
  bold: 'def', impish: 'def', lax: 'def', relaxed: 'def',
  calm: 'spd', careful: 'spd', gentle: 'spd', sassy: 'spd',
  timid: 'spe', jolly: 'spe', hasty: 'spe', naive: 'spe',
};

/**
 * The discrete ladder: offense {0, 252, 252+nature} × bulk {uninvested,
 * 252 HP, 252 HP + 252 Def(/SpD), +nature}. Offense-plus and bulk-plus
 * natures conflict (a nature boosts one stat), so those combinations are
 * skipped.
 *
 * Every rung INHERITS the prior and overrides only the dimensions the mon's
 * observations can actually measure: offense only with attacker
 * observations, bulk only with defender observations, and Speed never —
 * damage carries no Speed information, so a rung must not strip Speed EVs
 * or a speed nature the usage prior claims. A prior nature is neutralized
 * to Hardy only when it boosts a measured stat the rung claims uninvested.
 *
 * `keep` names prior stats the evidence cannot measure at all (an offense
 * seen only in knock-outs, a Speed no rung can bring in line with the
 * observed order): they stay at the prior's value and give way last in
 * the budget, after the rung's own claims (573756: the 0-Atk sweeper). A
 * kept Speed gives way to an offense claim the budget cannot express
 * beside it (round 41); a kept offense never gives way.
 */
type RungOption = { evs?: Partial<PokemonEvs>; nature?: string };

/** Offense {0, max, max + nature} — only with attacker observations. */
function offenseRungs(offenseStat: 'atk' | 'spa', offensePlus: string, max: number, hasAttackerObs: boolean): RungOption[] {
  return hasAttackerObs
    ? [
      { evs: { [offenseStat]: 0 } },
      { evs: { [offenseStat]: max } },
      { evs: { [offenseStat]: max }, nature: offensePlus },
    ]
    : [{}];
}

/** Bulk {uninvested, max HP, max HP + max Def(/SpD), + nature} — only with defender observations. */
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

/**
 * Speed rungs exist only under move-order evidence — Speed was never a
 * solved axis before (priors carried it); the observed order now is.
 */
function speedRungs(speedPlus: string, max: number, hasSpeedObs: boolean): RungOption[] {
  return hasSpeedObs
    ? [{}, { evs: { spe: 0 } }, { evs: { spe: max } }, { evs: { spe: max }, nature: speedPlus }]
    : [{}];
}

/** The stats the mon's observations can actually measure. */
function measuredStats(offenseStat: 'atk' | 'spa', hasAttackerObs: boolean, hasDefenderObs: boolean, hasSpeedObs: boolean): Set<keyof PokemonEvs> {
  return new Set<keyof PokemonEvs>([
    ...(hasAttackerObs ? [offenseStat as keyof PokemonEvs] : []),
    ...(hasDefenderObs ? (['def', 'spd'] as (keyof PokemonEvs)[]) : []),
    ...(hasSpeedObs ? (['spe'] as (keyof PokemonEvs)[]) : []),
  ]);
}

/**
 * The rung's nature from its option natures; null when two options claim a
 * nature (they conflict) or when a kept stat's plus nature must stay.
 */
function rungNature(options: RungOption[], keepNature: boolean, priorNature: string): string | null {
  const natures = options.map(option => option.nature).filter((nature): nature is string => !!nature);
  if (natures.length > 1 || (keepNature && natures.length > 0)) return null;
  return natures[0] ?? priorNature;
}

/** The stats a measurement fixed (round 40: HP from the log's maximum HP). */
const fixedStats = (fixed: Partial<PokemonEvs>): Set<keyof PokemonEvs> =>
  new Set((Object.keys(fixed) as (keyof PokemonEvs)[]).filter(stat => fixed[stat] !== undefined));

/** Every positive claim of the rung survived the budget in full (fixed stats override their claims). */
function expressed(evs: PokemonEvs, claimed: Partial<PokemonEvs>, fixed: Partial<PokemonEvs>): boolean {
  return (Object.entries(claimed) as [keyof PokemonEvs, number | undefined][])
    .every(([stat, value]) => !value || fixed[stat] !== undefined || (evs[stat] ?? 0) >= value);
}

/**
 * One rung's legal spread: the prior with the rung's overrides, rung-claimed
 * stats protected, prior carry-overs giving way first, kept prior stats
 * last (capToBudget). A fixed stat overrides the rung's claim on it and is
 * never shaved.
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

/** What every rung of one ladder shares. */
interface LadderContext {
  prior: SpreadCandidate;
  budget: EvBudget;
  fixed: Partial<PokemonEvs>;
  keep: ReadonlySet<keyof PokemonEvs>;
  offenseStat: 'atk' | 'spa';
  priorPlus: keyof PokemonEvs | undefined;
  priorNature: string;
}

/**
 * A kept stat keeps its plus nature too: a bulk or offense nature would
 * lower the very stat the evidence cannot measure.
 */
const keepsNature = (keep: ReadonlySet<keyof PokemonEvs>, priorPlus: keyof PokemonEvs | undefined): boolean =>
  priorPlus !== undefined && keep.has(priorPlus);

/**
 * The prior rung: the prior legalized around the same kept and fixed stats
 * as the composed ones (with the log's HP in place its carry-overs give way
 * in the same order). Every rung is LEGALIZED before scoring. Round 41:
 * when a kept offense and a kept Speed do not both fit beside the fixed
 * stats, the kept order shaves the offense; a second prior rung lets the
 * Speed give way instead, its speed nature neutralized. Knock-out lower
 * bounds and move orders decide between them; at equal error the prior's
 * own nature wins the tie (priorDistance).
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
 * One combination's rung, composed beside the kept stats and offered only
 * when the budget expresses every claim: a shaved claim would leave its
 * nature standing on nothing (round 40: "Calm 252 HP / 4 SpD / 252 Spe"
 * once Speed stays kept). When it cannot, the released form (round 41) is
 * the fallback; the prior rung stands behind both.
 */
function offeredRung(ctx: LadderContext, options: RungOption[]): CandidateRung | null {
  const claimed: Partial<PokemonEvs> = Object.assign({}, ...options.map(option => option.evs ?? {}));
  const evs = composeRung(ctx.prior, claimed, ctx.keep, ctx.budget, ctx.fixed);
  if (expressed(evs, claimed, ctx.fixed)) {
    const nature = rungNature(options, keepsNature(ctx.keep, ctx.priorPlus), ctx.priorNature);
    return nature === null ? null : { evs, nature };
  }
  return releasedRung(ctx, options, claimed);
}

/**
 * Round 41: a kept Speed gives way to an offense claim the budget cannot
 * express beside it. A satisfied order measures nothing downward while
 * clean damage lines measure the offense; with the log's HP fixed, only
 * one of the two fits, and the measured one wins the room. The released
 * Speed loses its plus nature like a measured stat left uninvested, which
 * frees the offense-plus rung. Bulk claims never release Speed (573756
 * t73: the 252-HP rung must not strip it) and a kept offense never gives
 * way (round 33). bestRung decides between the released body and the
 * 0-offense rungs; its order check prices a released body that no longer
 * moves first.
 */
function releasedRung(ctx: LadderContext, options: RungOption[], claimed: Partial<PokemonEvs>): CandidateRung | null {
  if (!ctx.keep.has('spe') || (claimed[ctx.offenseStat] ?? 0) <= 0) return null;
  const released = new Set([...ctx.keep].filter(stat => stat !== 'spe'));
  const nature = rungNature(options, keepsNature(released, ctx.priorPlus), ctx.priorPlus === 'spe' ? 'Hardy' : ctx.priorNature);
  if (nature === null) return null;
  const evs = composeRung(ctx.prior, claimed, released, ctx.budget, ctx.fixed);
  return expressed(evs, claimed, ctx.fixed) ? { evs, nature } : null;
}

export function candidateLadder(
  prior: SpreadCandidate,
  physicalAttacker: boolean,
  hasAttackerObs: boolean,
  hasDefenderObs: boolean,
  hasSpeedObs: boolean,
  budget: EvBudget,
  keep: ReadonlySet<keyof PokemonEvs> = new Set(),
  fixed: Partial<PokemonEvs> = {},
): CandidateRung[] {
  const max = budget.perStat;
  const offenseStat = physicalAttacker ? 'atk' : 'spa';
  const offense = offenseRungs(offenseStat, physicalAttacker ? 'Adamant' : 'Modest', max, hasAttackerObs);
  const bulk = bulkRungs(max, hasDefenderObs);
  const speed = speedRungs(physicalAttacker ? 'Jolly' : 'Timid', max, hasSpeedObs);

  const measured = measuredStats(offenseStat, hasAttackerObs, hasDefenderObs, hasSpeedObs);
  const priorPlus = NATURE_PLUS[toId(prior.nature)];
  const ctx: LadderContext = {
    prior, budget, fixed, keep, offenseStat, priorPlus,
    priorNature: priorPlus && measured.has(priorPlus) ? 'Hardy' : prior.nature,
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
