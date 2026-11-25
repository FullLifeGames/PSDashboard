import { Field, calculate } from '@smogon/calc';
import type { Battle, Pokemon } from '@pkmn/sim';
import { TERRAIN_BY_ID, WEATHER_BY_ID, callingMoves, calcGenerationFor, dexOfCalc, screenFlags, standingScreens, type RulesDex } from '@fulllifegames/replay-core';
import { attackerAtUse, calcPokemon, type SimBody } from './calc/body.ts';
import { strengthMix, strongerPower } from './calc/fickle.ts';
import { calcMove } from './calc/move.ts';
import { stellarFirstUse } from './calc/stellar.ts';
import { bodyAsClicked } from './calc/tera-click.ts';

// Analytic one-turn odds: the sim says what a roll does, this module how likely each outcome is; what it cannot price
// returns null and the caller keeps the plain seed average (fail closed).

export interface BoundaryEvent {
  accuracy: number;
  killFraction: number;
  pKill: number;
  /** Of the 16 damage rolls, how many knock out without a crit (0 for status moves; 0 or 16 for fixed damage). */
  normalKillRolls: number;
  critKillRolls: number;
}

type DexMove = ReturnType<Battle['dex']['moves']['get']>;

export const randomCallMoves = (dex: RulesDex): ReadonlySet<string> => callingMoves(dex);

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

// Items and abilities with a Modify(Accuracy|CritRatio) handler (Wide Lens, Sand Veil, Super Luck) shift the odds;
// test/ko-odds-guard-census.spec.ts walks them all. @pkmn/dex strips handlers: ask the simulator's own Dex.
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

function accuracyStageMultiplier(stages: number): number {
  const s = Math.max(-6, Math.min(6, stages));
  return s >= 0 ? (3 + s) / 3 : 3 / (3 - s);
}

export function critRate(gen: number, critRatio: number): number | null {
  // Stage 0 or 1 only; higher stages (Super Luck, Scope Lens, focus energy) fail closed at the call site.
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

function killShare(damage: unknown, hp: number): number | null {
  if (typeof damage === 'number') return damage >= hp ? 1 : 0;
  if (!Array.isArray(damage)) return null;
  if (damage.some(entry => Array.isArray(entry))) return null;
  const rolls = (damage as number[]).map(Number);
  if (rolls.length === 0) return null;
  return rolls.filter(roll => roll >= hp).length / rolls.length;
}

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

/** `weather` is the weather the move meets when not the battle's own: '' after a Tera click that clears it. */
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
    // A Stellar body's first use of a type hits harder; the type at use is the calc's own.
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
    // A chance-doubling move (Fickle Beam) mixes its two strengths; the roll counts stay the weaker one's.
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

export interface TeraClicks { attacker?: boolean; defender?: boolean }

export function boundaryEvent(
  battle: Battle, attacker: Pokemon, defender: Pokemon, moveId: string, tera: TeraClicks = {},
): BoundaryEvent | null {
  // `tera`: a body whose side clicks Tera this turn is read as the click makes it, before any move lands.
  const genNum = battle.gen;
  // Gens 1 and 2 roll damage over 217 to 255 (mods gen1/gen2 `getDamage`), Gen 1 crits by Speed: no 16 rolls to count.
  if (genNum <= 2 || genNum > 9) return null;
  const move = battle.dex.moves.get(moveId);
  if (unpriceable(attacker, defender, move)) return null;

  if (move.category === 'Status') {
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
