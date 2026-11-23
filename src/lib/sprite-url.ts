import { toID } from '@pkmn/dex';
import { dexOf, type GameRules } from '@fulllifegames/replay-core';

/**
 * Builds play.pokemonshowdown.com sprite URLs. PS names sprite files after the species ID of the base species plus the forme ID:
 * every hyphen of the base name goes ("Ting-Lu" → tinglu.png), the one before the forme stays, and the forme loses its own
 * ("Urshifu-Rapid-Strike" → urshifu-rapidstrike.png). The Dex of the replay's generation and mod says where the base name ends;
 * cosmetic formes keep their forme (gastrodon-east.png).
 */
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

/**
 * The sprite of the base species for a forme whose own file the folder lacks (Dragalge-Mega has none); null for a base species, an
 * unknown name or a base whose file is the forme's own.
 */
export function baseSpriteUrl(species: string, rules: GameRules): string | null {
  const known = dexOf(rules).species.get(species.replace(/-*$/, ''));
  if (!known.exists || known.baseSpecies === known.name) return null;
  const url = spriteUrl(known.baseSpecies, rules);
  return url === spriteUrl(species, rules) ? null : url;
}
