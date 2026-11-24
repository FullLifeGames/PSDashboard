/**
 * clone.ts and dispatch.ts follow the data layout and the control flow of
 * @pkmn/sim (MIT License, Copyright (c) 2011-2026 Guangcong Luo and other
 * contributors, http://pokemonshowdown.com/).
 */

// The speed layer for the pinned @pkmn/sim: rule tables, battle copies and a dispatch pre-check (ADR 0003).
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
interface CreatedKeys { battle: Keys; field: Keys; side: Keys; pokemon: Keys }
type BattleOptions = ConstructorParameters<typeof Battle>[0];

const createdByProto = new WeakMap<object, Map<string, CreatedKeys>>();

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

function dropEmptied(object: object, created: Keys): void {
  const record = object as Record<string, unknown>;
  for (const key in record) {
    if (record[key] === undefined && !created.has(key)) delete record[key];
  }
}

/** A battle that becomes a copy source, never written afterwards: drops own keys holding undefined, as JSON does. */
// Writes the battle it gets: pass a copy or a fresh deserialization, never a reader's battle.
export function adoptTemplate(battle: Battle): Battle {
  let created: CreatedKeys;
  try {
    created = constructorKeys(battle);
  } catch (error) {
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

export function setTemplateHook(hook: ((battle: Battle) => void) | null): void {
  templateHook = hook;
}

export function prepareBattle(battle: Battle): void {
  if (simFastOn('dispatch') && guardPasses()) attachDispatch(battle);
}
