import type { PokemonSet } from '@pkmn/sim';
import { dexOfCalc, itemSetValue, toId, type CalcGeneration, type RulesDex, type DamageObservation, type OpponentTeamInfo, type RevealedPokemonInfo } from '@fulllifegames/replay-core';

export interface DefenderRead { set: PokemonSet | undefined; abilities: string[]; items: string[] }

type SimDex = RulesDex;

// A battle forme's origin: battleOnly and changesFrom, and the species a Mega Stone turns into it.
function formeOrigins(dex: SimDex, name: string, depth = 0): string[] {
  const species = dex.species.get(name);
  if (!species.exists || depth > 3) return [];
  const stone = species.requiredItem ? dex.items.get(species.requiredItem) : undefined;
  const stoned = Object.entries(stone?.megaStone ?? {}).filter(([, forme]) => forme === species.name).map(([base]) => base);
  const from = [species.battleOnly, species.changesFrom, ...stoned].flat().filter((origin): origin is string => !!origin);
  return [...new Set(from.flatMap(origin => [toId(origin), ...formeOrigins(dex, origin, depth + 1)]))];
}

export const isBodyOf = (gen: CalcGeneration, logged: string, built: string): boolean =>
  toId(logged) === toId(built) || formeOrigins(dexOfCalc(gen), logged).includes(toId(built));

export const pricedSpecies = (set: PokemonSet | undefined, logged: string): string =>
  set && toId(set.species) === toId(logged) ? set.species : logged;

/** The set's own ability when the forme lists it (Stance Change), else the forme's first (a Mega's). */
export function formeAbility(gen: CalcGeneration, species: string, ability: string): string {
  const listed = Object.values(dexOfCalc(gen).species.get(species).abilities ?? {}).filter(Boolean);
  return !ability || listed.length === 0 || listed.includes(ability) ? ability : listed[0];
}

const entryOf = (info: OpponentTeamInfo | undefined, set: PokemonSet | undefined, obs: DamageObservation) =>
  info?.pokemon.find(mon => toId(mon.species) === toId(obs.defenderSpecies)) ??
  info?.pokemon.find(mon => !!set && toId(mon.species) === toId(set.species));

const shownAbility = (info: RevealedPokemonInfo | undefined): string =>
  info && (info.ability.source === 'revealed' || info.ability.source === 'manual') ? info.ability.value : '';

const shownItem = (info: RevealedPokemonInfo | undefined): string =>
  info && (info.item.source === 'revealed' || info.item.source === 'manual') ? itemSetValue(info.item.value) : '';

/** '' (the calc picks the first) only where the Dex lists none; a battle forme ranges its own abilities. */
export function defenderAbilities(gen: CalcGeneration, set: PokemonSet | undefined, obs: DamageObservation, info?: OpponentTeamInfo): string[] {
  const dex = dexOfCalc(gen);
  const species = pricedSpecies(set, obs.defenderSpecies);
  const forme = !!set && species !== set.species;
  const revealed = entryOf(info, set, obs);
  const known = info ? shownAbility(revealed) : forme ? '' : set?.ability ?? '';
  const named = (name: string) => (dex.abilities.get(name).exists ? dex.abilities.get(name).name : name);
  if (known) return [named(known)];
  const ruled = revealed?.ruledOut?.abilities ?? [];
  const may = Object.values(dex.species.get(species).abilities ?? {}).filter((name): name is string => !!name && !ruled.includes(toId(name)));
  return may.length > 0 ? may : [''];
}

// Priced bare, an Assault Vest or Eviolite holder cancels a Choice item's 1.5: a Choice hit reads like no Choice item.
export function defenderItems(set: PokemonSet | undefined, obs: DamageObservation, info?: OpponentTeamInfo): string[] {
  const revealed = entryOf(info, set, obs);
  const shown = shownItem(revealed);
  if (shown) return [shown];
  const ruled = revealed?.ruledOut?.items ?? [];
  return [...new Set([set?.item ?? '', ''])].filter(item => !item || !ruled.includes(toId(item)));
}
