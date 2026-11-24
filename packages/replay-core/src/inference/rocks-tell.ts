import type { RulesDex } from '../rules-dex.ts';
import type { RevealedPokemonInfo } from '../types.ts';
import { toId } from '../ids.ts';

type GenDex = RulesDex;
type DamageHandler = (this: never, ...args: never[]) => unknown;

// A handler that fails on the stub counts as refusing: then the tell proves nothing.
function keepsRocksOff(dex: GenDex, name: string): boolean {
  const { onDamage } = dex.abilities.get(name) as { onDamage?: DamageHandler };
  if (!onDamage) return false;
  const rocks = dex.conditions.get('stealthrock');
  try {
    const context = { add: () => undefined, effect: rocks, effectState: {} };
    return onDamage.call(context as never, 1 as never, { abilityState: {} } as never, null as never, rocks as never) === false;
  } catch {
    return true;
  }
}

/** Whether an ability the Pokémon may have keeps the rock damage off it: no rock damage then shows no boots. */
export function rocksMayMiss(info: RevealedPokemonInfo, dex: RulesDex, freeAbilities: boolean): boolean {
  const known = info.ability.source === 'revealed' || info.ability.source === 'manual' ? info.ability.value : '';
  if (known) return keepsRocksOff(dex, known);
  if (freeAbilities) return dex.abilities.all().some(ability => keepsRocksOff(dex, ability.name));
  const ruled = info.ruledOut?.abilities ?? [];
  return Object.values(dex.species.get(info.species).abilities ?? {})
    .some(name => !!name && !ruled.includes(toId(name)) && keepsRocksOff(dex, name));
}
