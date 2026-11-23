import type { PokemonSet } from '@pkmn/sim';
import { dexOfCalc, itemSetValue, toId, type CalcGeneration, type RulesDex, type DamageObservation, type OpponentTeamInfo, type RevealedPokemonInfo } from '@fulllifegames/replay-core';

/** The defender of an observation: its built set (when the team has one), the abilities and the items it may have. */
export interface DefenderRead { set: PokemonSet | undefined; abilities: string[]; items: string[] }

type SimDex = RulesDex;

/**
 * The species a battle forme comes from, as ids: the forme's battleOnly and changesFrom (Mega Evolution, Stance Change, Busted Mimikyu,
 * Ash-Greninja), and the species a Mega Stone turns into the forme (the Mega-Z formes of Champions carry neither). Followed to the base.
 */
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

/** The species a body is priced as: the built set's own name when the log names that species, else the forme the log names. */
export const pricedSpecies = (set: PokemonSet | undefined, logged: string): string =>
  set && toId(set.species) === toId(logged) ? set.species : logged;

/** The ability the forme has: the set's own when the forme lists it (Stance Change), else the forme's first (a Mega's). */
export function formeAbility(gen: CalcGeneration, species: string, ability: string): string {
  const listed = Object.values(dexOfCalc(gen).species.get(species).abilities ?? {}).filter(Boolean);
  return !ability || listed.length === 0 || listed.includes(ability) ? ability : listed[0];
}

const entryOf = (info: OpponentTeamInfo | undefined, set: PokemonSet | undefined, obs: DamageObservation) =>
  info?.pokemon.find(mon => toId(mon.species) === toId(obs.defenderSpecies)) ??
  info?.pokemon.find(mon => !!set && toId(mon.species) === toId(set.species));

/** The ability the log showed or the user entered ('' when it only guessed). */
const shownAbility = (info: RevealedPokemonInfo | undefined): string =>
  info && (info.ability.source === 'revealed' || info.ability.source === 'manual') ? info.ability.value : '';

/** The item the log showed or the user entered ('' when it only guessed or the preview said "has an item"). */
const shownItem = (info: RevealedPokemonInfo | undefined): string =>
  info && (info.item.source === 'revealed' || info.item.source === 'manual') ? itemSetValue(info.item.value) : '';

/**
 * The abilities the defender may have, as the item judge ranges them (replay-core team/item-damage.ts): the one the log showed
 * (revealed or entered by hand) when the defender's side has an inference, else the built set's, and with neither, each ability its
 * species may have beside the ones the log ruled out. '' (the calc's pick of the first ability) only where the Dex lists none. A
 * battle forme of the set's species ranges the forme's abilities (a Mega's own), not the set's.
 */
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

/**
 * The items the defender may hold, as the item judge ranges them: the item the log showed alone, else the built item or none, minus
 * the items the log ruled out. A Choice hit into an Assault Vest or Eviolite holder reads like no Choice item when the defender is
 * priced bare, since the two 1.5 cancel.
 */
export function defenderItems(set: PokemonSet | undefined, obs: DamageObservation, info?: OpponentTeamInfo): string[] {
  const revealed = entryOf(info, set, obs);
  const shown = shownItem(revealed);
  if (shown) return [shown];
  const ruled = revealed?.ruledOut?.items ?? [];
  return [...new Set([set?.item ?? '', ''])].filter(item => !item || !ruled.includes(toId(item)));
}
