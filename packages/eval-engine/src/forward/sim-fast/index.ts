/**
 * Round 59 (T91): the speed layer for @pkmn/sim 0.10.11. Three levers, each
 * behind the switch in state.ts: rule tables built once per format
 * (rule-table.ts), battles copied instead of deserialized (clone.ts), and a
 * pre-check that answers event dispatches nobody listens to (dispatch.ts).
 * Results never change, only time (spec
 * docs/superpowers/specs/2026-09-24-round-59-design.md).
 *
 * clone.ts and dispatch.ts follow the data layout and the control flow of
 * @pkmn/sim (MIT License, Copyright (c) 2011-2026 Guangcong Luo and other
 * contributors, http://pokemonshowdown.com/).
 */
import type { Battle, PokemonSet } from '@pkmn/sim';
import { cloneBattle } from './clone.ts';
import { attachDispatch } from './dispatch.ts';
import { guardPasses } from './guard.ts';
import { ensureRuleTable } from './rule-table.ts';
import { breakSimFast, simFastCounters, simFastOn } from './state.ts';

export { simFastOn } from './state.ts';

let templateHook: ((battle: Battle) => void) | null = null;

/** Lever rules: runs before the first `new Battle` of a format (deserializeFromParsed). */
export function prepareFormat(formatid: string): void {
  if (simFastOn('rules') && guardPasses()) ensureRuleTable(formatid);
}

/** Lever clone: a copy of a template (PRNG unset, history empty), or null when the lever is off or the copy broke. */
export function copyBattle(template: Battle): Battle | null {
  if (!simFastOn('clone') || !guardPasses()) return null;
  try {
    const copy = cloneBattle(template);
    simFastCounters.clones++;
    return copy;
  } catch (error) {
    breakSimFast('fallback', error instanceof Error ? error.message : String(error));
    return null;
  }
}

type Keys = ReadonlySet<string>;
/** Own keys the constructors create, per class. */
interface CreatedKeys { battle: Keys; field: Keys; side: Keys; pokemon: Keys }
type BattleOptions = ConstructorParameters<typeof Battle>[0];

/** Per Battle prototype (one per build of the sim), then per format: mods add own keys (scripts, gen 1's modifiedStats). */
const createdByProto = new WeakMap<object, Map<string, CreatedKeys>>();

/**
 * The keys State.deserializeBattle's `new Battle(...)` creates before it
 * assigns the JSON's (state.mjs:64-95): the same class, format, seed and
 * `deserialized`, with copies of the battle's own sets (the Pokemon
 * constructor normalizes a set in place). Built once per prototype and format.
 */
function constructorKeys(battle: Battle): CreatedKeys {
  const proto = Object.getPrototypeOf(battle) as object;
  let byFormat = createdByProto.get(proto);
  if (!byFormat) createdByProto.set(proto, byFormat = new Map());
  let created = byFormat.get(battle.format.id);
  if (!created) {
    const options: BattleOptions = { formatid: battle.format.id, seed: battle.prngSeed, deserialized: true };
    for (const side of battle.sides) {
      options[side.id] = { name: side.name, team: side.pokemon.map(pokemon => JSON.parse(JSON.stringify(pokemon.set)) as PokemonSet) };
    }
    const fresh = new (battle.constructor as new (options: BattleOptions) => Battle)(options);
    const keysOf = (objects: readonly object[]): Keys => new Set(objects.flatMap(object => Object.keys(object)));
    created = {
      battle: keysOf([fresh]), field: keysOf([fresh.field]), side: keysOf(fresh.sides),
      pokemon: keysOf(fresh.sides.flatMap(side => side.pokemon)),
    };
    byFormat.set(battle.format.id, created);
  }
  return created;
}

/** Deletes the own keys holding undefined that the constructor does not create (the sim's classes have no enumerable prototype keys). */
function dropEmptied(object: object, created: Keys): void {
  const record = object as Record<string, unknown>;
  for (const key in record) {
    if (record[key] === undefined && !created.has(key)) delete record[key];
  }
}

/**
 * A battle that becomes a copy source (position template, mid-turn snapshot);
 * never written afterwards. Always a copy or a fresh deserialization, never a
 * reader's battle.
 *
 * Today's fork is a JSON round trip: it drops own keys holding undefined
 * (state.mjs:385), and `new Battle` recreates only the constructor's keys
 * (state.mjs:95, 390-397). A key the constructor does not create and the sim
 * empties (Pokemon.pendingStaleness, pokemon.mjs:1518, 1583, 1602; gen 2's
 * lastMoveTargetLoc on every move, mods/gen2/scripts.mjs:128 and
 * pokemon.mjs:640) is gone after the round trip; a copy would keep its slot,
 * a later write would fill the slot instead of appending the key, and the key
 * order of the serialized state (endgame memo keys) would differ. So the
 * source drops such keys on the battle, the field, every side and every
 * Pokemon. A constructor key the sim empties (showCure, pokemon.mjs:145;
 * moveLastTurnResult, moveThisTurnResult and volatileStaleness, clearVolatile
 * :1275-1282, which the constructor runs) holds undefined on a fresh object
 * too, so the round trip leaves it undefined and the copy may keep it; the
 * guard spec's census pins both halves in every gen.
 */
export function adoptTemplate(battle: Battle): Battle {
  let created: CreatedKeys;
  try {
    created = constructorKeys(battle);
  } catch (error) {
    // The copy cannot match today's fork without the key sets: the standard path from here on (forced: throws).
    breakSimFast('fallback', error instanceof Error ? error.message : String(error));
    return battle;
  }
  dropEmptied(battle, created.battle);
  dropEmptied(battle.field, created.field);
  for (const side of battle.sides) {
    dropEmptied(side, created.side);
    for (const pokemon of side.pokemon) dropEmptied(pokemon, created.pokemon);
  }
  templateHook?.(battle);
  return battle;
}

/** Test hook: sees every template as it is adopted (the frozen-template spec freezes them). */
export function setTemplateHook(hook: ((battle: Battle) => void) | null): void {
  templateHook = hook;
}

/** Lever dispatch: every battle the engine makes carries the pre-check (deserializeFromParsed and the copy paths). */
export function prepareBattle(battle: Battle): void {
  if (simFastOn('dispatch') && guardPasses()) attachDispatch(battle);
}
