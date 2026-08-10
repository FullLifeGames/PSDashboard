import { Generations, Pokemon, Move, Field, calculate } from '@smogon/calc';
import type { PokemonSet } from '@pkmn/sim';
import type { DamageObservation, PokemonEvs, SpeedOrderObservation } from '../types';
import { WEATHER_BY_ID } from './damage-calc';

/**
 * Damage-consistent spread inference: the replay's observed damage fractions
 * bound each Pokémon's real bulk and power. A small discrete ladder of
 * standard spreads is scored with @smogon/calc against every observation a
 * Pokémon appears in; the best-fitting rung replaces the guessed EVs (only
 * where EVs were guessed — sheet/revealed/manual spreads are never touched;
 * the overlay in team-builder enforces that precedence).
 *
 * Honest limitation: with sparse observations, "the defender is bulkier" and
 * "the attacker is weaker" fit the same damage line — the greedy solve picks
 * one, so per-mon spreads are not ground truth. What the result guarantees is
 * PAIR consistency: forked eval battles reproduce the damage the replay
 * showed, so branches stop killing Pokémon that visibly survived.
 */

export interface SpreadCandidate {
  evs: PokemonEvs;
  nature: string;
}

const ZERO_EVS: PokemonEvs = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };

/**
 * A violated move-order constraint outweighs any damage-fit error: the log
 * PROVED the order, while damage rolls only bound spreads. Rungs violating a
 * constraint lose to any non-violating rung; if every rung violates
 * (conflicting evidence), damage fit still decides among them.
 */
const SPEED_VIOLATION_PENALTY = 1000;

/**
 * Goodness-of-fit forfeit: mean squared misfit per observation above which
 * the evidence itself is unreliable and the prior stands. Sized on the GPL
 * video reconstruction — clean fits read ≤0.005 (draft/server logs ~0.0002),
 * while Vileplume's contradictory video HP bars left EVERY rung ≥0.05 and
 * the least-bad fit was an all-zero paper spread.
 */
const FIT_FORFEIT_PER_OBSERVATION = 0.01;

/** Format-dependent EV legality (Pokémon Champions uses 32/stat, 66 total). */
export interface EvBudget { perStat: number; total: number }
export function evBudget(formatid: string): EvBudget {
  return /champions/.test(formatid) ? { perStat: 32, total: 66 } : { perStat: 252, total: 508 };
}

const evTotal = (evs: PokemonEvs): number =>
  Object.values(evs).reduce((sum, value) => sum + (value ?? 0), 0);

/**
 * Legalize a composed spread: clamp every stat to the per-stat cap, then
 * shave down to the total budget — least-evidenced stats first (the
 * unprotected offense, then bulk, then HP), Speed last (damage evidence
 * never justifies stripping Speed, so it only gives way when the budget
 * leaves no other room), and rung-claimed (protected) stats after all
 * unprotected ones. The old unlegalized composition let a prior's 252 Spe
 * ride along with 252/252 overrides — a 756-EV spread the sim then played.
 */
function capToBudget(evs: PokemonEvs, protectedStats: Set<keyof PokemonEvs>, budget: EvBudget): PokemonEvs {
  const out: PokemonEvs = { ...evs };
  for (const stat of Object.keys(out) as (keyof PokemonEvs)[]) {
    out[stat] = Math.min(budget.perStat, Math.max(0, out[stat] ?? 0));
  }
  const shaveOrder: (keyof PokemonEvs)[] = [
    ...(['atk', 'spa', 'def', 'spd', 'hp'] as (keyof PokemonEvs)[]).filter(stat => !protectedStats.has(stat)),
    'spe',
    ...(['spd', 'def', 'hp', 'spa', 'atk'] as (keyof PokemonEvs)[]).filter(stat => protectedStats.has(stat)),
  ];
  for (const stat of shaveOrder) {
    const over = evTotal(out) - budget.total;
    if (over <= 0) break;
    out[stat] = Math.max(0, (out[stat] ?? 0) - over);
  }
  return out;
}

/** HP-bar reading noise (the GPL pipeline is ±1–2%): error inside this slack is free. */
const OBSERVATION_SLACK = 0.02;
/** Minimum observations before a spread claim beats the existing guess. */
const MIN_OBSERVATIONS = 2;

/** Client condition ids the shared calc map doesn't spell out. */
const WEATHER_ALIASES: Record<string, string> = {
  sand: 'sandstorm', rain: 'raindance', sun: 'sunnyday',
};

const toId = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '');

const weatherFor = (raw: string) => WEATHER_BY_ID[WEATHER_ALIASES[toId(raw)] ?? toId(raw)];

interface CandidateRung {
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
function candidateLadder(
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
  const offense: { evs?: Partial<PokemonEvs>; nature?: string }[] = hasAttackerObs
    ? [
      { evs: { [offenseStat]: 0 } },
      { evs: { [offenseStat]: max } },
      { evs: { [offenseStat]: max }, nature: offensePlus },
    ]
    : [{}];
  const bulk: { evs?: Partial<PokemonEvs>; nature?: string }[] = hasDefenderObs
    ? [
      { evs: { hp: 0, def: 0, spd: 0 } },
      { evs: { hp: max, def: 0, spd: 0 } },
      { evs: { hp: max, def: max, spd: 0 } },
      { evs: { hp: max, def: 0, spd: max } },
      { evs: { hp: max, def: max, spd: 0 }, nature: 'Bold' },
      { evs: { hp: max, def: 0, spd: max }, nature: 'Calm' },
    ]
    : [{}];
  // Speed rungs exist only under move-order evidence — Speed was never a
  // solved axis before (priors carried it); the observed order now is.
  const speedPlus = physicalAttacker ? 'Jolly' : 'Timid';
  const speed: { evs?: Partial<PokemonEvs>; nature?: string }[] = hasSpeedObs
    ? [{}, { evs: { spe: 0 } }, { evs: { spe: max } }, { evs: { spe: max }, nature: speedPlus }]
    : [{}];

  const measured = new Set<keyof PokemonEvs>([
    ...(hasAttackerObs ? [offenseStat as keyof PokemonEvs] : []),
    ...(hasDefenderObs ? (['def', 'spd'] as (keyof PokemonEvs)[]) : []),
    ...(hasSpeedObs ? (['spe'] as (keyof PokemonEvs)[]) : []),
  ]);
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

function genOf(formatid: string) {
  const genNumber = parseInt(formatid.match(/^gen(\d)/)?.[1] ?? '9', 10);
  return Generations.get(Math.min(Math.max(genNumber, 1), 9) as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9);
}

/** Public legalizer: clamp any EV spread to the format's budget. */
export function legalizeEvs(evs: Partial<PokemonEvs> | undefined, formatid: string): PokemonEvs {
  return capToBudget({ ...ZERO_EVS, ...(evs ?? {}) }, new Set(), evBudget(formatid));
}

export function inferSpreads(
  observations: DamageObservation[],
  sets: { p1: PokemonSet[]; p2: PokemonSet[] },
  formatid: string,
  speedOrders: SpeedOrderObservation[] = [],
): Map<string, SpreadCandidate> {
  const gen = genOf(formatid);
  const budget = evBudget(formatid);
  const solved = new Map<string, SpreadCandidate>();

  const keyOf = (side: 'p1' | 'p2', species: string) => `${side}:${toId(species)}`;
  const setOf = (side: 'p1' | 'p2', species: string): PokemonSet | undefined =>
    sets[side].find(entry => toId(entry.species) === toId(species) || toId(entry.name || '') === toId(species));

  // Observations per mon (as attacker AND as defender).
  const byMon = new Map<string, DamageObservation[]>();
  for (const obs of observations) {
    const defenderSide = obs.attackerSide === 'p1' ? 'p2' : 'p1';
    if (setOf(obs.attackerSide, obs.attackerSpecies) && setOf(defenderSide, obs.defenderSpecies)) {
      const attackerKey = keyOf(obs.attackerSide, obs.attackerSpecies);
      const defenderKey = keyOf(defenderSide, obs.defenderSpecies);
      byMon.set(attackerKey, [...(byMon.get(attackerKey) ?? []), obs]);
      byMon.set(defenderKey, [...(byMon.get(defenderKey) ?? []), obs]);
    }
  }

  // Observed same-turn move order, indexed per participant. Constraints are
  // over the BUILT configuration's effective speed (spread × the set's
  // Scarf), the pair-consistency philosophy: branches must reproduce the
  // order the replay showed, whatever the true item was.
  const speedByMon = new Map<string, SpeedOrderObservation[]>();
  for (const order of speedOrders) {
    if (!setOf(order.firstSide, order.firstSpecies) || !setOf(order.secondSide, order.secondSpecies)) continue;
    const firstKey = keyOf(order.firstSide, order.firstSpecies);
    const secondKey = keyOf(order.secondSide, order.secondSpecies);
    if (firstKey === secondKey) continue;
    speedByMon.set(firstKey, [...(speedByMon.get(firstKey) ?? []), order]);
    speedByMon.set(secondKey, [...(speedByMon.get(secondKey) ?? []), order]);
  }

  const spreadFor = (side: 'p1' | 'p2', species: string): SpreadCandidate => {
    const key = keyOf(side, species);
    const existing = solved.get(key);
    if (existing) return existing;
    const set = setOf(side, species);
    return { evs: { ...ZERO_EVS, ...(set?.evs ?? {}) }, nature: set?.nature || 'Hardy' };
  };

  const calcPokemon = (side: 'p1' | 'p2', species: string, spread: SpreadCandidate, obsBoosts: Record<string, number>, status: string) => {
    const set = setOf(side, species);
    return new Pokemon(gen, set?.species ?? species, {
      level: set?.level || 100,
      ability: set?.ability || undefined,
      item: set?.item || undefined,
      nature: spread.nature,
      evs: spread.evs,
      ivs: set?.ivs,
      boosts: obsBoosts,
      status: (status || undefined) as ConstructorParameters<typeof Pokemon>[2] extends { status?: infer S } ? S : never,
    });
  };

  const observationError = (obs: DamageObservation, candidateKey: string, candidate: SpreadCandidate): number => {
    const defenderSide = obs.attackerSide === 'p1' ? 'p2' : 'p1';
    const attackerKey = keyOf(obs.attackerSide, obs.attackerSpecies);
    const attackerSpread = attackerKey === candidateKey ? candidate : spreadFor(obs.attackerSide, obs.attackerSpecies);
    const defenderKey = keyOf(defenderSide, obs.defenderSpecies);
    const defenderSpread = defenderKey === candidateKey ? candidate : spreadFor(defenderSide, obs.defenderSpecies);

    try {
      const attacker = calcPokemon(obs.attackerSide, obs.attackerSpecies, attackerSpread, obs.attackerBoosts, obs.attackerStatus);
      const defender = calcPokemon(defenderSide, obs.defenderSpecies, defenderSpread, obs.defenderBoosts, '');
      const screens = new Set(obs.screens);
      const result = calculate(gen, attacker, defender, new Move(gen, obs.moveId), new Field({
        weather: weatherFor(obs.weather),
        defenderSide: {
          isReflect: screens.has('reflect'),
          isLightScreen: screens.has('lightscreen'),
          isAuroraVeil: screens.has('auroraveil'),
        },
      }));
      const rolls = (Array.isArray(result.damage) ? (result.damage as number[]).flat() : [Number(result.damage)]).map(Number);
      if (rolls.length === 0) return 0;
      const maxHp = defender.maxHP();
      if (maxHp <= 0) return 0;
      const min = Math.min(...rolls) / maxHp;
      const max = Math.max(...rolls) / maxHp;
      const distance = obs.observedFraction < min
        ? min - obs.observedFraction
        : obs.observedFraction > max ? obs.observedFraction - max : 0;
      return Math.max(0, distance - OBSERVATION_SLACK) ** 2;
    } catch {
      // Unknown move/species for this gen: the observation cannot judge.
      return 0;
    }
  };

  const effectiveSpeed = (side: 'p1' | 'p2', species: string, spread: SpreadCandidate): number => {
    const set = setOf(side, species);
    try {
      const mon = new Pokemon(gen, set?.species ?? species, {
        level: set?.level || 100,
        nature: spread.nature,
        evs: spread.evs,
        ivs: set?.ivs,
      });
      return mon.stats.spe * (toId(set?.item ?? '') === 'choicescarf' ? 1.5 : 1);
    } catch {
      return 0;
    }
  };

  const speedError = (key: string, candidate: SpreadCandidate): number => {
    let violations = 0;
    for (const order of speedByMon.get(key) ?? []) {
      const firstKey = keyOf(order.firstSide, order.firstSpecies);
      const firstSpread = firstKey === key ? candidate : spreadFor(order.firstSide, order.firstSpecies);
      const secondKey = keyOf(order.secondSide, order.secondSpecies);
      const secondSpread = secondKey === key ? candidate : spreadFor(order.secondSide, order.secondSpecies);
      if (effectiveSpeed(order.firstSide, order.firstSpecies, firstSpread) <
        effectiveSpeed(order.secondSide, order.secondSpecies, secondSpread)) {
        violations += 1;
      }
    }
    return violations * SPEED_VIOLATION_PENALTY;
  };

  const physicalAttackerFor = (key: string): boolean => {
    const attacking = (byMon.get(key) ?? []).filter(obs => keyOf(obs.attackerSide, obs.attackerSpecies) === key);
    if (attacking.length === 0) {
      // Never observed attacking — classify by the set's damaging moves so
      // the leftover-EV fill lands in the right offense stat.
      const [side, species] = key.split(':') as ['p1' | 'p2', string];
      let physical = 0;
      let special = 0;
      for (const name of setOf(side, species)?.moves ?? []) {
        const category = gen.moves.get(toId(name) as Parameters<typeof gen.moves.get>[0])?.category;
        if (category === 'Physical') physical += 1;
        else if (category === 'Special') special += 1;
      }
      return physical >= special;
    }
    let physical = 0;
    for (const obs of attacking) {
      const category = gen.moves.get(obs.moveId as Parameters<typeof gen.moves.get>[0])?.category;
      if (category !== 'Special') physical += 1;
    }
    return physical * 2 >= attacking.length;
  };

  // Roll ranges are wide: opposite rungs (0 EV and 252 EV) can BOTH fit an
  // observation with zero error. Ties break toward the mon's prior guess —
  // evidence that cannot distinguish must not move the spread.
  const priors = new Map<string, SpreadCandidate>();
  const priorDistance = (key: string, rung: CandidateRung): number => {
    const prior = priors.get(key);
    if (!prior) return 0;
    const stats: (keyof PokemonEvs)[] = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];
    const evDistance = stats.reduce((sum, stat) => sum + Math.abs((rung.evs[stat] ?? 0) - (prior.evs[stat] ?? 0)), 0);
    return evDistance + (rung.nature === prior.nature ? 0 : 64);
  };

  const solveOne = (key: string) => {
    const monObservations = byMon.get(key) ?? [];
    const monSpeedOrders = speedByMon.get(key) ?? [];
    // Speed evidence stands alone: one proven move order is worth solving
    // for even when no damage line ever measured the mon.
    if (monObservations.length < MIN_OBSERVATIONS && monSpeedOrders.length === 0) return;
    const hasAttackerObs = monObservations.some(obs => keyOf(obs.attackerSide, obs.attackerSpecies) === key);
    const hasDefenderObs = monObservations.some(obs =>
      keyOf(obs.attackerSide === 'p1' ? 'p2' : 'p1', obs.defenderSpecies) === key);
    const prior = priors.get(key);
    if (!prior) return;
    const physicalAttacker = physicalAttackerFor(key);
    const ladder = candidateLadder(prior, physicalAttacker, hasAttackerObs, hasDefenderObs, monSpeedOrders.length > 0, budget);
    let best: CandidateRung | null = null;
    let bestError = Infinity;
    for (const rung of ladder) {
      const error = monObservations.reduce((sum, obs) => sum + observationError(obs, key, rung), 0) +
        speedError(key, rung);
      if (error < bestError - 1e-12 ||
        (best !== null && Math.abs(error - bestError) <= 1e-12 && priorDistance(key, rung) < priorDistance(key, best))) {
        bestError = error;
        best = rung;
      }
    }
    if (!best) return;
    // When even the best rung misfits the damage evidence badly (video-read
    // HP bars, attribution confounds), the evidence is unreliable — keep the
    // prior instead of confidently fielding a paper spread (GPL: all-zero
    // Vileplume, 252-HP-only Clefable). A solve that REPAIRS speed-order
    // violations the prior carries always stands.
    const damageResidual = monObservations.reduce((sum, obs) => sum + observationError(obs, key, best!), 0);
    if (monObservations.length > 0 &&
      damageResidual / monObservations.length > FIT_FORFEIT_PER_OBSERVATION &&
      speedError(key, best) >= speedError(key, prior)) {
      solved.delete(key);
      return;
    }
    // Top up the leftover budget in UNMEASURED, non-Speed stats: a winner
    // like "252 HP only" would otherwise field a systematically
    // under-statted sim mon. Filled stats carry no observation evidence
    // either way (they are exactly the unmeasured ones), so the fill can
    // never contradict the solve.
    const offenseStat: keyof PokemonEvs = physicalAttacker ? 'atk' : 'spa';
    const measured = new Set<keyof PokemonEvs>([
      ...(hasAttackerObs ? [offenseStat] : []),
      ...(hasDefenderObs ? (['hp', 'def', 'spd'] as (keyof PokemonEvs)[]) : []),
    ]);
    const evs: PokemonEvs = { ...best.evs };
    let remaining = budget.total - evTotal(evs);
    for (const stat of ([offenseStat, 'hp', 'def', 'spd'] as (keyof PokemonEvs)[])) {
      if (remaining <= 0) break;
      if (measured.has(stat)) continue;
      const add = Math.min(budget.perStat - (evs[stat] ?? 0), remaining);
      if (add > 0) {
        evs[stat] = (evs[stat] ?? 0) + add;
        remaining -= add;
      }
    }
    solved.set(key, { evs, nature: best.nature });
  };

  // Greedy by observation count, then a refinement pass: the first pass can
  // solve a mon against a still-wrong partner guess; the second re-solves
  // everything against the first pass's answers (deterministic order).
  const order = [...new Set([...byMon.keys(), ...speedByMon.keys()])].sort((a, b) =>
    ((byMon.get(b)?.length ?? 0) - (byMon.get(a)?.length ?? 0)) || a.localeCompare(b));
  for (const key of order) {
    const [side, species] = key.split(':') as ['p1' | 'p2', string];
    priors.set(key, spreadFor(side, species));
  }
  for (const key of order) solveOne(key);
  for (const key of order) solveOne(key);

  return solved;
}
