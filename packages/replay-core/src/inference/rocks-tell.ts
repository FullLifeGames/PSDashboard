import { Dex } from '@pkmn/sim';
import type { RevealedPokemonInfo } from '../types.ts';
import { toId } from '../ids.ts';

type GenDex = ReturnType<typeof Dex.forGen>;
type DamageHandler = (this: never, ...args: never[]) => unknown;

/**
 * Whether the ability's own damage handler in the simulator refuses Stealth
 * Rock damage (Magic Guard refuses every damage that is not a move). A
 * handler that fails on the stub counts as refusing: then the tell proves
 * nothing. The build asks the same (team-builder.ts, round 64).
 */
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

/**
 * Whether an ability the Pokémon may have keeps the rock damage off it: the
 * known one, else its species' abilities minus the rule-outs, and in a format
 * with free abilities any ability. A switch-in without rock damage then shows
 * no Heavy-Duty Boots (round 64 review for the build; round 67, T130, for the
 * inference's guess, so the panel never shows a guess the build refuses).
 */
export function rocksMayMiss(info: RevealedPokemonInfo, gen: number, freeAbilities: boolean): boolean {
  const dex = Dex.forGen(gen);
  const known = info.ability.source === 'revealed' || info.ability.source === 'manual' ? info.ability.value : '';
  if (known) return keepsRocksOff(dex, known);
  if (freeAbilities) return dex.abilities.all().some(ability => keepsRocksOff(dex, ability.name));
  const ruled = info.ruledOut?.abilities ?? [];
  return Object.values(dex.species.get(info.species).abilities ?? {})
    .some(name => !!name && !ruled.includes(toId(name)) && keepsRocksOff(dex, name));
}
