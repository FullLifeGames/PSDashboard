import { Generations, Pokemon, Move, Field, calculate } from '@smogon/calc';
import type { PokemonSet } from '@pkmn/sim';
import type { DamageObservation, PokemonEvs } from '../types';

/**
 * Damage-consistent spread inference: the replay's observed damage fractions
 * bound each Pokémon's real bulk and power. A small discrete ladder of
 * standard spreads is scored with @smogon/calc against every observation a
 * Pokémon appears in; the best-fitting rung replaces the guessed EVs (only
 * where EVs were guessed — sheet/revealed/manual spreads are never touched;
 * the overlay in team-builder enforces that precedence).
 */

export interface SpreadCandidate {
  evs: PokemonEvs;
  nature: string;
}

const ZERO_EVS: PokemonEvs = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };

/** HP-bar reading noise (the GPL pipeline is ±1–2%): error inside this slack is free. */
const OBSERVATION_SLACK = 0.02;
/** Minimum observations before a spread claim beats the existing guess. */
const MIN_OBSERVATIONS = 2;

const WEATHER_NAMES: Record<string, 'Sand' | 'Rain' | 'Sun' | 'Snow' | 'Hail'> = {
  sand: 'Sand', sandstorm: 'Sand',
  rain: 'Rain', raindance: 'Rain',
  sun: 'Sun', sunnyday: 'Sun',
  snow: 'Snow', snowscape: 'Snow',
  hail: 'Hail',
};

const toId = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '');

interface CandidateRung {
  evs: PokemonEvs;
  nature: string;
}

/**
 * The discrete ladder: offense {0, 252, 252+nature} × bulk {uninvested,
 * 252 HP, 252 HP + 252 Def(/SpD), +nature}. Offense-plus and bulk-plus
 * natures conflict (a nature boosts one stat), so those combinations are
 * skipped. `physicalAttacker` picks Adamant vs Modest and which offense EV
 * the offense rungs invest.
 */
function candidateLadder(physicalAttacker: boolean): CandidateRung[] {
  const offenseStat = physicalAttacker ? 'atk' : 'spa';
  const offensePlus = physicalAttacker ? 'Adamant' : 'Modest';
  const offense: { value: number; nature?: string }[] = [
    { value: 0 },
    { value: 252 },
    { value: 252, nature: offensePlus },
  ];
  const bulk: { evs: Partial<PokemonEvs>; nature?: string }[] = [
    { evs: {} },
    { evs: { hp: 252 } },
    { evs: { hp: 252, def: 252 } },
    { evs: { hp: 252, spd: 252 } },
    { evs: { hp: 252, def: 252 }, nature: 'Bold' },
    { evs: { hp: 252, spd: 252 }, nature: 'Calm' },
  ];

  const rungs: CandidateRung[] = [];
  for (const o of offense) {
    for (const b of bulk) {
      if (o.nature && b.nature) continue;
      rungs.push({
        evs: { ...ZERO_EVS, ...b.evs, [offenseStat]: o.value },
        nature: o.nature ?? b.nature ?? 'Hardy',
      });
    }
  }
  return rungs;
}

function genOf(formatid: string) {
  const genNumber = parseInt(formatid.match(/^gen(\d)/)?.[1] ?? '9', 10);
  return Generations.get(Math.min(Math.max(genNumber, 1), 9) as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9);
}

export function inferSpreads(
  observations: DamageObservation[],
  sets: { p1: PokemonSet[]; p2: PokemonSet[] },
  formatid: string,
): Map<string, SpreadCandidate> {
  const gen = genOf(formatid);
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
        weather: WEATHER_NAMES[toId(obs.weather)],
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

  const physicalAttackerFor = (key: string): boolean => {
    const attacking = (byMon.get(key) ?? []).filter(obs => keyOf(obs.attackerSide, obs.attackerSpecies) === key);
    if (attacking.length === 0) return true;
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
    if (monObservations.length < MIN_OBSERVATIONS) return;
    const ladder = candidateLadder(physicalAttackerFor(key));
    let best: CandidateRung | null = null;
    let bestError = Infinity;
    for (const rung of ladder) {
      const error = monObservations.reduce((sum, obs) => sum + observationError(obs, key, rung), 0);
      if (error < bestError - 1e-12 ||
        (best !== null && Math.abs(error - bestError) <= 1e-12 && priorDistance(key, rung) < priorDistance(key, best))) {
        bestError = error;
        best = rung;
      }
    }
    if (best) solved.set(key, best);
  };

  // Greedy by observation count, then a refinement pass: the first pass can
  // solve a mon against a still-wrong partner guess; the second re-solves
  // everything against the first pass's answers (deterministic order).
  const order = [...byMon.keys()].sort((a, b) =>
    (byMon.get(b)!.length - byMon.get(a)!.length) || a.localeCompare(b));
  for (const key of order) {
    const [side, species] = key.split(':') as ['p1' | 'p2', string];
    priors.set(key, spreadFor(side, species));
  }
  for (const key of order) solveOne(key);
  for (const key of order) solveOne(key);

  // Only claim spreads that had enough evidence.
  for (const key of [...solved.keys()]) {
    if ((byMon.get(key)?.length ?? 0) < MIN_OBSERVATIONS) solved.delete(key);
  }
  return solved;
}
