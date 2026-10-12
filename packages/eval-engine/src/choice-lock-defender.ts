import type { PokemonSet } from '@pkmn/sim';
import { toId, type CalcGeneration, type DamageObservation, type OpponentTeamInfo, type RevealedPokemonInfo } from '@fulllifegames/replay-core';
import { simDexOf } from './calc/body.ts';

/** The defender of an observation: its built set (when the team has one) and the abilities it may have (round 68, T157). */
export interface DefenderRead { set: PokemonSet | undefined; abilities: string[] }

/** The ability the log showed or the user entered ('' when it only guessed). */
const shownAbility = (info: RevealedPokemonInfo | undefined): string =>
  info && (info.ability.source === 'revealed' || info.ability.source === 'manual') ? info.ability.value : '';

/**
 * The abilities the defender may have, as the item judge ranges them since R18 (replay-core team/item-damage.ts): the
 * one the log showed (revealed or entered by hand) when the inference of the defender's side is at hand, else the one
 * the built set names, and with neither, each ability its species may have beside the ones the log ruled out. An empty
 * name is the old reading, the calc's pick of the species' first ability, kept only where the Dex lists none.
 */
export function defenderAbilities(gen: CalcGeneration, set: PokemonSet | undefined, obs: DamageObservation, info?: OpponentTeamInfo): string[] {
  const dex = simDexOf(gen);
  const species = set?.species ?? obs.defenderSpecies;
  const revealed = info?.pokemon.find(mon => toId(mon.species) === toId(species));
  const known = info ? shownAbility(revealed) : set?.ability ?? '';
  const named = (name: string) => (dex.abilities.get(name).exists ? dex.abilities.get(name).name : name);
  if (known) return [named(known)];
  const ruled = revealed?.ruledOut?.abilities ?? [];
  const may = Object.values(dex.species.get(species).abilities ?? {}).filter((name): name is string => !!name && !ruled.includes(toId(name)));
  return may.length > 0 ? may : [''];
}
