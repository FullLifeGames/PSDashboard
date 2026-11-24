import { toID } from '@pkmn/dex';
import { dexOf, type GameRules } from '@fulllifegames/replay-core';

// PS names sprite files after the base species ID plus the forme ID: "Ting-Lu" → tinglu.png, "Urshifu-Rapid-Strike" →
// urshifu-rapidstrike.png. The Dex says where the base ends; cosmetic formes keep their forme (gastrodon-east.png).
function speciesSpriteId(name: string, rules: GameRules): string | null {
  const species = dexOf(rules).species.get(name);
  if (!species.exists) return null;
  const base = toID(species.baseSpecies);
  return species.baseSpecies === species.name ? base : `${base}-${toID(species.forme)}`;
}

export function spriteUrl(species: string, rules: GameRules): string {
  // "Greninja-*" (unrevealed forme) falls back to the base sprite.
  const name = species.replace(/-*$/, '');
  const id = speciesSpriteId(name, rules) ?? name
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+$/, '');

  return `https://play.pokemonshowdown.com/sprites/gen5/${id}.png`;
}

/** The base species' sprite for a forme whose own file the folder lacks (Dragalge-Mega); null otherwise. */
export function baseSpriteUrl(species: string, rules: GameRules): string | null {
  const known = dexOf(rules).species.get(species.replace(/-*$/, ''));
  if (!known.exists || known.baseSpecies === known.name) return null;
  const url = spriteUrl(known.baseSpecies, rules);
  return url === spriteUrl(species, rules) ? null : url;
}
