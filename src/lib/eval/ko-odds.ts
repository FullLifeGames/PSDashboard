import { Generations, Move as CalcMove, Pokemon as CalcPokemon, Field, calculate } from '@smogon/calc';
import type { Battle, Pokemon } from '@pkmn/sim';
import { TERRAIN_BY_ID, WEATHER_BY_ID } from '../damage-calc';

/**
 * Analytic one-turn boundary-event odds (round 6 expectation grounding).
 * The sim keeps answering WHAT happens after a roll; this module answers
 * only HOW LIKELY each roll outcome is — kill share of the 16 damage rolls
 * (crit-weighted) times the accuracy after stage modifiers. Everything it
 * cannot price confidently returns null and the caller keeps the plain
 * seed average (fail closed). The value/narrative contract: the search
 * prices what the next roll is worth; the report narrates what many rolls
 * mean.
 */

export interface BoundaryEvent {
  /** 0..1 chance the move connects (accuracy × stage modifiers; 1 for true-accuracy/No Guard). */
  accuracy: number;
  /** 0..1 share of connect branches that KO (16 rolls, crit-weighted). */
  killFraction: number;
  /** accuracy × killFraction. */
  pKill: number;
}

/** Moves that call a RANDOM move — the seed decides what actually happens. */
export const RANDOM_CALL_MOVES = new Set(['sleeptalk', 'metronome', 'assist', 'copycat']);

/** Moves whose immediate damage the one-turn model cannot price. */
const UNPRICEABLE_MOVE_IDS = new Set([
  // depends on incoming damage
  'counter', 'mirrorcoat', 'metalburst', 'comeuppance', 'focuspunch',
  // fails conditionally on the opponent's action / turn count
  'suckerpunch', 'thunderclap', 'fakeout',
  // delayed or charge/semi-invulnerable turns — no immediate hit
  'futuresight', 'doomdesire', 'solarbeam', 'solarblade', 'meteorbeam',
  'electroshot', 'skyattack', 'skullbash', 'razorwind', 'freezeshock',
  'iceburn', 'fly', 'dig', 'bounce', 'dive', 'phantomforce', 'shadowforce',
  // the user's own KO is the point — class truncation semantics break
  'explosion', 'selfdestruct', 'mistyexplosion', 'finalgambit',
  // hits mid-switch with order-dependent power
  'pursuit',
  // party-dependent multi-strike
  'beatup',
]);

/** Accuracy/evasion modifiers the stage table does not cover → fail closed. */
const ACCURACY_ITEMS = new Set(['widelens', 'zoomlens', 'brightpowder', 'laxincense']);
const ACCURACY_ABILITIES = new Set([
  'compoundeyes', 'hustle', 'sandveil', 'snowcloak', 'victorystar', 'tangledfeet', 'wonderskin',
]);

/** Modern accuracy stage multiplier: stage s ≥ 0 → (3+s)/3, s < 0 → 3/(3−s). */
function stageMultiplier(stages: number): number {
  const s = Math.max(-6, Math.min(6, stages));
  return s >= 0 ? (3 + s) / 3 : 3 / (3 - s);
}

function critRate(gen: number, critRatio: number): number | null {
  // Stage 0 or 1 only (the move's own ratio); higher effective stages
  // (Super Luck, Scope Lens, focus energy) fail closed at the call site.
  const stage = Math.max(0, Math.min(1, (critRatio || 1) - 1));
  if (stage === 1) return 1 / 8;
  return gen >= 7 ? 1 / 24 : 1 / 16;
}

function toCalcPokemon(gen: ReturnType<typeof Generations.get>, pokemon: Pokemon, dex: Battle['dex']) {
  const set = pokemon.set;
  return new CalcPokemon(gen, pokemon.species.name, {
    level: pokemon.level,
    ability: pokemon.ability ? dex.abilities.get(pokemon.ability).name : undefined,
    item: pokemon.item ? dex.items.get(pokemon.item).name : undefined,
    nature: set.nature || undefined,
    evs: set.evs as never,
    ivs: set.ivs as never,
    boosts: {
      atk: pokemon.boosts.atk, def: pokemon.boosts.def, spa: pokemon.boosts.spa,
      spd: pokemon.boosts.spd, spe: pokemon.boosts.spe,
    } as never,
    curHP: pokemon.hp,
    status: (pokemon.status || undefined) as never,
    teraType: (pokemon.terastallized || undefined) as never,
  });
}

function calcField(battle: Battle, defender: Pokemon): Field {
  const defSide = defender.side;
  const conditions = (side: typeof defSide) => {
    const ids = new Set(Object.keys(side.sideConditions ?? {}));
    return { isReflect: ids.has('reflect'), isLightScreen: ids.has('lightscreen'), isAuroraVeil: ids.has('auroraveil') };
  };
  const atkSide = battle.sides[defSide === battle.sides[0] ? 1 : 0];
  return new Field({
    gameType: 'Singles',
    weather: WEATHER_BY_ID[battle.field.weather ?? ''],
    terrain: TERRAIN_BY_ID[battle.field.terrain ?? ''],
    attackerSide: conditions(atkSide),
    defenderSide: conditions(defSide),
  });
}

/** Share of `rolls` that reaches the defender's remaining HP. */
function killShare(damage: unknown, hp: number): number | null {
  if (typeof damage === 'number') return damage >= hp ? 1 : 0;
  if (!Array.isArray(damage)) return null;
  if (damage.some(entry => Array.isArray(entry))) return null; // multi-hit shape
  const rolls = (damage as number[]).map(Number);
  if (rolls.length === 0) return null;
  return rolls.filter(roll => roll >= hp).length / rolls.length;
}

/**
 * The analytic odds of one attacking move against one defender, or null
 * when the model cannot price it (the caller keeps the seed average).
 */
export function boundaryEvent(
  battle: Battle, attacker: Pokemon, defender: Pokemon, moveId: string,
): BoundaryEvent | null {
  const genNum = battle.gen;
  if (genNum <= 2 || genNum > 9) return null;
  const move = battle.dex.moves.get(moveId);
  if (!move.exists) return null;
  if (RANDOM_CALL_MOVES.has(move.id) || UNPRICEABLE_MOVE_IDS.has(move.id)) return null;
  if (move.multihit) return null;
  if (move.ohko) return null;
  if ((move.critRatio ?? 1) > 2) return null;
  if (attacker.ability === 'parentalbond') return null;
  for (const mon of [attacker, defender]) {
    if (ACCURACY_ITEMS.has(mon.item)) return null;
    if (ACCURACY_ABILITIES.has(mon.ability)) return null;
    if (mon.volatiles['focusenergy']) return null;
  }

  // Accuracy first — shared by damaging and status branches.
  let accuracy: number;
  if (move.accuracy === true) {
    accuracy = 1;
  } else {
    let base = move.accuracy / 100;
    const weather = battle.field.weather ?? '';
    const rainish = weather === 'raindance' || weather === 'primordialsea';
    const sunny = weather === 'sunnyday' || weather === 'desolateland';
    const hailish = weather === 'hail' || weather === 'snow' || weather === 'snowscape';
    if ((move.id === 'thunder' || move.id === 'hurricane') && rainish) base = 1;
    if ((move.id === 'thunder' || move.id === 'hurricane') && sunny) base = 0.5;
    if (move.id === 'blizzard' && hailish) base = 1;
    const stages = (attacker.boosts.accuracy ?? 0) - (defender.boosts.evasion ?? 0);
    accuracy = Math.min(1, base * stageMultiplier(stages));
  }
  if (attacker.ability === 'noguard' || defender.ability === 'noguard') accuracy = 1;

  if (move.category === 'Status') {
    // Accuracy-only event: the hit/miss split is pure table arithmetic;
    // the status effect's consequences live inside the outcome classes.
    if (accuracy >= 1) return null;
    return { accuracy, killFraction: 0, pKill: 0 };
  }

  try {
    const gen = Generations.get(genNum as 3 | 4 | 5 | 6 | 7 | 8 | 9);
    const atkPoke = toCalcPokemon(gen, attacker, battle.dex);
    const defPoke = toCalcPokemon(gen, defender, battle.dex);
    const field = calcField(battle, defender);
    const normal = killShare(calculate(gen, atkPoke, defPoke, new CalcMove(gen, move.name), field).damage, defender.hp);
    const crit = killShare(calculate(gen, atkPoke, defPoke, new CalcMove(gen, move.name, { isCrit: true }), field).damage, defender.hp);
    if (normal === null || crit === null) return null;
    const c = critRate(genNum, move.critRatio ?? 1);
    if (c === null) return null;
    const killFraction = (1 - c) * normal + c * crit;
    return { accuracy, killFraction, pKill: accuracy * killFraction };
  } catch {
    return null;
  }
}
