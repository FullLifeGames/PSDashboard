import type { PokemonEvs } from '../types.ts';
import { capToBudget, ZERO_EVS, type EvBudget } from './ev-budget.ts';
import { toId } from '../ids.ts';

export interface SpreadCandidate {
  evs: PokemonEvs;
  nature: string;
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
 * observed order): they stay at the prior's value, are protected in the
 * budget like a rung's own claims, and a rung whose protected total would
 * exceed the budget is not a candidate (573756: the 0-Atk sweeper).
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
 * One rung's legal spread: the prior with the rung's overrides, rung-claimed
 * and kept stats protected, prior carry-overs giving way first (capToBudget).
 * Null when the protected stats alone exceed the budget — the rung cannot
 * claim its bulk beside what the evidence leaves untouched.
 */
function composeRung(
  prior: SpreadCandidate, overrides: Partial<PokemonEvs>, keep: ReadonlySet<keyof PokemonEvs>, budget: EvBudget,
): PokemonEvs | null {
  const composed = { ...ZERO_EVS, ...prior.evs, ...overrides };
  const protectedStats = new Set((Object.entries(overrides) as [keyof PokemonEvs, number][])
    .filter(([, value]) => (value ?? 0) > 0)
    .map(([stat]) => stat));
  for (const stat of keep) {
    if (overrides[stat] === undefined && (prior.evs[stat] ?? 0) > 0) protectedStats.add(stat);
  }
  const protectedTotal = [...protectedStats].reduce((sum, stat) => sum + Math.min(budget.perStat, composed[stat] ?? 0), 0);
  return protectedTotal > budget.total ? null : capToBudget(composed, protectedStats, budget);
}

export function candidateLadder(
  prior: SpreadCandidate,
  physicalAttacker: boolean,
  hasAttackerObs: boolean,
  hasDefenderObs: boolean,
  hasSpeedObs: boolean,
  budget: EvBudget,
  keep: ReadonlySet<keyof PokemonEvs> = new Set(),
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

  // Every rung is LEGALIZED before scoring (composeRung).
  const rungs: CandidateRung[] = [{
    evs: capToBudget({ ...ZERO_EVS, ...prior.evs }, new Set(), budget),
    nature: prior.nature,
  }];
  for (const o of offense) {
    for (const b of bulk) {
      for (const s of speed) {
        if ([o.nature, b.nature, s.nature].filter(Boolean).length > 1) continue;
        const evs = composeRung(prior, { ...b.evs, ...s.evs, ...o.evs }, keep, budget);
        if (evs) rungs.push({ evs, nature: o.nature ?? b.nature ?? s.nature ?? priorNature });
      }
    }
  }
  return rungs;
}
