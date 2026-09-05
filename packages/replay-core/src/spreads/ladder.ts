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
 * the budget, after the rung's own claims (573756: the 0-Atk sweeper).
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
  const offensePlus = physicalAttacker ? 'Adamant' : 'Modest';
  const offense = offenseRungs(offenseStat, offensePlus, max, hasAttackerObs);
  const bulk = bulkRungs(max, hasDefenderObs);
  const speedPlus = physicalAttacker ? 'Jolly' : 'Timid';
  const speed = speedRungs(speedPlus, max, hasSpeedObs);

  const measured = measuredStats(offenseStat, hasAttackerObs, hasDefenderObs, hasSpeedObs);
  const priorPlus = NATURE_PLUS[toId(prior.nature)];
  const priorNature = priorPlus && measured.has(priorPlus) ? 'Hardy' : prior.nature;
  // A kept stat keeps its plus nature too: a bulk or offense nature would
  // lower the very stat the evidence cannot measure.
  const keepNature = priorPlus !== undefined && keep.has(priorPlus);

  // Every rung is LEGALIZED before scoring (composeRung). The prior rung
  // legalizes around the same kept and fixed stats as the composed ones:
  // with the log's HP in place its carry-overs give way in the same order.
  const priorKept = new Set([...keep].filter(stat => fixed[stat] === undefined && (prior.evs[stat] ?? 0) > 0));
  const rungs: CandidateRung[] = [{
    evs: capToBudget({ ...ZERO_EVS, ...prior.evs, ...fixed }, new Set(), budget, priorKept, fixedStats(fixed)),
    nature: prior.nature,
  }];
  for (const o of offense) {
    for (const b of bulk) {
      for (const s of speed) {
        const nature = rungNature([o, b, s], keepNature, priorNature);
        if (nature === null) continue;
        const claimed = { ...b.evs, ...s.evs, ...o.evs };
        const evs = composeRung(prior, claimed, keep, budget, fixed);
        // A rung the budget cannot express next to the kept and fixed stats
        // is not offered: a shaved claim would leave its nature standing on
        // nothing (round 40: "Calm 252 HP / 4 SpD / 252 Spe" once Speed
        // stays kept). The prior rung is the fallback.
        if (!expressed(evs, claimed, fixed)) continue;
        rungs.push({ evs, nature });
      }
    }
  }
  return rungs;
}
