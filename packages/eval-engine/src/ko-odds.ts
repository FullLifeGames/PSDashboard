import { Field, calculate } from '@smogon/calc';
import type { Battle, Pokemon } from '@pkmn/sim';
import { TERRAIN_BY_ID, WEATHER_BY_ID, callingMoves, calcGenerationFor, dexOfCalc, screenFlags, standingScreens, type RulesDex } from '@fulllifegames/replay-core';
import { attackerAtUse, calcPokemon, type SimBody } from './calc/body.ts';
import { strengthMix, strongerPower } from './calc/fickle.ts';
import { calcMove } from './calc/move.ts';
import { stellarFirstUse } from './calc/stellar.ts';
import { bodyAsClicked } from './calc/tera-click.ts';

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
  /** Round 43: of the 16 damage rolls, how many knock out without a crit (0 for status moves; 0 or 16 for fixed damage). */
  normalKillRolls: number;
  /** Round 43: of the 16 damage rolls, how many knock out with a crit. */
  critKillRolls: number;
}

type DexMove = ReturnType<Battle['dex']['moves']['get']>;

/**
 * Moves that call another move, so the seed or the turn decides what actually happens (Round 72, W1: the Dex's `callsMove`,
 * seven moves over every generation; the hand list held four). test/random-call-oracle.spec.ts plays each of them.
 */
export const randomCallMoves = (dex: RulesDex): ReadonlySet<string> => callingMoves(dex);

/** Moves whose immediate damage the one-turn model cannot price. */
// oracle: packages/eval-engine/test/unpriceable-oracle.spec.ts
export const UNPRICEABLE_MOVE_IDS = new Set([
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

/**
 * Round 70 (N1): the crit and accuracy modifiers the stage table does not cover → fail closed, read from the simulator's Dex.
 * An item or an ability with a handler on the ModifyAccuracy or ModifyCritRatio event (its own, a foe's, an ally's, the
 * source's or any: Wide Lens, Sand Veil, Victory Star, Scope Lens, Super Luck, Merciless) changes the number the model
 * prices. The first version named eleven of the eighteen such effects of Gen 9 and its comment said the rest "fail closed".
 * A handler on the Accuracy or CriticalHit event stays out: No Guard is priced in moveAccuracy, and the calc gives a
 * crit-proof defender the normal roll for a crit. test/ko-odds-guard-census.spec.ts walks every item and ability of every
 * generation and the Champions mod and lists the reason of each exclusion. @pkmn/dex strips handlers, so a body asks the
 * simulator's own Dex objects (getItem, getAbility).
 */
const ODDS_HANDLER = /^on(?:Any|Foe|Ally|Source)?Modify(?:Accuracy|CritRatio)$/;
const changesOdds = new WeakMap<object, boolean>();

function modifiesOdds(effect: object): boolean {
  let known = changesOdds.get(effect);
  if (known === undefined) {
    known = Object.keys(effect).some(key => ODDS_HANDLER.test(key));
    changesOdds.set(effect, known);
  }
  return known;
}

/** Modern accuracy stage multiplier: stage s ≥ 0 → (3+s)/3, s < 0 → 3/(3−s). */
function accuracyStageMultiplier(stages: number): number {
  const s = Math.max(-6, Math.min(6, stages));
  return s >= 0 ? (3 + s) / 3 : 3 / (3 - s);
}

export function critRate(gen: number, critRatio: number): number | null {
  // Stage 0 or 1 only (the move's own ratio); higher effective stages
  // (Super Luck, Scope Lens, focus energy) fail closed at the call site.
  const stage = Math.max(0, Math.min(1, (critRatio || 1) - 1));
  if (stage === 1) return 1 / 8;
  return gen >= 7 ? 1 / 24 : 1 / 16;
}

function calcField(battle: Battle, defender: Pokemon): Field {
  const defSide = defender.side;
  const conditions = (side: typeof defSide) => {
    return screenFlags(standingScreens(side));
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

/** The guards that make the one-turn model refuse a pair: unknown or unpriceable moves, crit and accuracy modifiers it cannot fold. */
export function unpriceable(attacker: Pokemon, defender: Pokemon, move: DexMove): boolean {
  if (!move.exists) return true;
  if (randomCallMoves(attacker.battle.dex).has(move.id) || UNPRICEABLE_MOVE_IDS.has(move.id)) return true;
  if (move.multihit) return true;
  if (move.ohko) return true;
  if ((move.critRatio ?? 1) > 2) return true;
  if (attacker.ability === 'parentalbond') return true;
  for (const mon of [attacker, defender]) {
    if (modifiesOdds(mon.getItem()) || modifiesOdds(mon.getAbility())) return true;
    if (mon.volatiles['focusenergy']) return true;
  }
  return false;
}

/** The weather overrides on a move's base accuracy (Thunder/Hurricane in rain and sun, Blizzard in hail). */
function weatherAccuracy(move: DexMove, base: number, weather: string): number {
  let value = base;
  const rainish = weather === 'raindance' || weather === 'primordialsea';
  const sunny = weather === 'sunnyday' || weather === 'desolateland';
  const hailish = weather === 'hail' || weather === 'snow' || weather === 'snowscape';
  if ((move.id === 'thunder' || move.id === 'hurricane') && rainish) value = 1;
  if ((move.id === 'thunder' || move.id === 'hurricane') && sunny) value = 0.5;
  if (move.id === 'blizzard' && hailish) value = 1;
  return value;
}

/**
 * Accuracy after weather and stage modifiers; No Guard on either side makes the move sure. `weather` is the weather the
 * move meets when it is not the battle's own: '' after a Tera click that clears it (T152).
 */
export function moveAccuracy(battle: Battle, move: DexMove, attacker: Pokemon, defender: Pokemon, weather = battle.field.weather ?? ''): number {
  let accuracy: number;
  if (move.accuracy === true) {
    accuracy = 1;
  } else {
    const base = weatherAccuracy(move, move.accuracy / 100, weather);
    const stages = (attacker.boosts.accuracy ?? 0) - (defender.boosts.evasion ?? 0);
    accuracy = Math.min(1, base * accuracyStageMultiplier(stages));
  }
  if (attacker.ability === 'noguard' || defender.ability === 'noguard') accuracy = 1;
  return accuracy;
}

interface KillRolls { killFraction: number; normalKillRolls: number; critKillRolls: number }

/** The crit-weighted kill share of the 16 damage rolls with its roll counts, or null when the calc cannot price the pair. */
function damageKillFraction(
  genNum: number,
  battle: Battle,
  move: DexMove,
  bodies: { attacker: SimBody; defender: SimBody },
  defender: Pokemon,
): KillRolls | null {
  try {
    const gen = calcGenerationFor(genNum, battle.dex.currentMod);
    const atkPoke = calcPokemon(gen, bodies.attacker);
    const defPoke = calcPokemon(gen, bodies.defender);
    const field = calcField(battle, defender);
    const hp = bodies.defender.hp;
    // A Stellar body's first use of a type hits harder (T152); the type at use is the calc's own.
    const first = stellarFirstUse(bodies.attacker, () => calculate(gen, atkPoke, defPoke, calcMove(gen, move.name, bodies.attacker), field).move.type);
    const stellar = first ? { isStellarFirstUse: true } : {};
    const sharesAt = (power: { basePower: number } | null) => {
      const options = { ...stellar, ...(power ? { overrides: power } : {}) };
      const normal = killShare(calculate(gen, atkPoke, defPoke, calcMove(gen, move.name, bodies.attacker, options), field).damage, hp);
      const crit = killShare(calculate(gen, atkPoke, defPoke, calcMove(gen, move.name, bodies.attacker, { isCrit: true, ...options }), field).damage, hp);
      return normal === null || crit === null ? null : { normal, crit };
    };
    const weak = sharesAt(null);
    const c = critRate(genNum, move.critRatio ?? 1);
    if (weak === null || c === null) return null;
    // A move that doubles on a chance (Fickle Beam, T154) is the mix of its two strengths; the roll counts stay the weaker one's, which the scripts aim by.
    const mix = strengthMix(dexOfCalc(gen), move.name);
    const strong = mix ? sharesAt(strongerPower(calcMove(gen, move.name, bodies.attacker, stellar).bp, mix.factor)) : null;
    if (mix && strong === null) return null;
    const fraction = (shares: { normal: number; crit: number }) => (1 - c) * shares.normal + c * shares.crit;
    return {
      killFraction: mix && strong ? (1 - mix.chance) * fraction(weak) + mix.chance * fraction(strong) : fraction(weak),
      normalKillRolls: Math.round(weak.normal * 16),
      critKillRolls: Math.round(weak.crit * 16),
    };
  } catch {
    return null;
  }
}

/** Which of the two bodies an option clicks Tera for: its own attacker, or (a cell's other side) the defender. */
export interface TeraClicks { attacker?: boolean; defender?: boolean }

/**
 * The analytic odds of one attacking move against one defender, or null
 * when the model cannot price it (the caller keeps the seed average). `tera`:
 * a body whose side clicks Tera this turn is read as the click makes it,
 * before any move lands (round 67, T84); left out, the bodies as they stand.
 */
export function boundaryEvent(
  battle: Battle, attacker: Pokemon, defender: Pokemon, moveId: string, tera: TeraClicks = {},
): BoundaryEvent | null {
  const genNum = battle.gen;
  if (genNum <= 2 || genNum > 9) return null;
  const move = battle.dex.moves.get(moveId);
  if (unpriceable(attacker, defender, move)) return null;

  if (move.category === 'Status') {
    // Accuracy-only event: the hit/miss split is pure table arithmetic;
    // the status effect's consequences live inside the outcome classes.
    const accuracy = moveAccuracy(battle, move, attacker, defender);
    if (accuracy >= 1) return null;
    return { accuracy, killFraction: 0, pKill: 0, normalKillRolls: 0, critKillRolls: 0 };
  }

  const bodies = {
    attacker: attackerAtUse(battle.dex, bodyAsClicked(battle, attacker, !!tera.attacker), move.name),
    defender: bodyAsClicked(battle, defender, !!tera.defender),
  };
  // A click that clears the weather (Teraform Zero) comes before every move of the turn, the accuracy roll included.
  const accuracy = moveAccuracy(battle, move, attacker, defender, bodies.attacker.abilityOn || bodies.defender.abilityOn ? '' : undefined);
  const rolls = damageKillFraction(genNum, battle, move, bodies, defender);
  if (rolls === null) return null;
  return { accuracy, ...rolls, pKill: accuracy * rolls.killFraction };
}
