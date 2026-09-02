import type { PokemonEvs } from '../../types';
import { capToBudget, ZERO_EVS, type EvBudget } from './ev-budget';
import { toId } from '../ids';

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

export function candidateLadder(
  prior: SpreadCandidate,
  physicalAttacker: boolean,
  hasAttackerObs: boolean,
  hasDefenderObs: boolean,
  hasSpeedObs: boolean,
  budget: EvBudget,
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

  // Every rung is LEGALIZED before scoring: rung-claimed stats are
  // protected, prior carry-overs give way first (capToBudget).
  const rungs: CandidateRung[] = [{
    evs: capToBudget({ ...ZERO_EVS, ...prior.evs }, new Set(), budget),
    nature: prior.nature,
  }];
  for (const o of offense) {
    for (const b of bulk) {
      for (const s of speed) {
        if ([o.nature, b.nature, s.nature].filter(Boolean).length > 1) continue;
        const overrides = { ...b.evs, ...s.evs, ...o.evs };
        const protectedStats = new Set((Object.entries(overrides) as [keyof PokemonEvs, number][])
          .filter(([, value]) => (value ?? 0) > 0)
          .map(([stat]) => stat));
        rungs.push({
          evs: capToBudget({ ...ZERO_EVS, ...prior.evs, ...overrides }, protectedStats, budget),
          nature: o.nature ?? b.nature ?? s.nature ??
            (priorPlus && measured.has(priorPlus) ? 'Hardy' : prior.nature),
        });
      }
    }
  }
  return rungs;
}
