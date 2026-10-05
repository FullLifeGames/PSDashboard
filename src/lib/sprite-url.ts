import { Dex, toID } from '@pkmn/dex';

/**
 * Builds play.pokemonshowdown.com sprite URLs. PS names sprite files after
 * the species ID of the base species plus the forme ID: every hyphen of the
 * base name goes ("Ting-Lu" → tinglu.png), the one before the forme stays,
 * and the forme loses its own ("Rotom-Wash" → rotom-wash.png,
 * "Urshifu-Rapid-Strike" → urshifu-rapidstrike.png). The Dex says where
 * the base name ends; cosmetic formes keep their forme (gastrodon-east.png).
 */
function speciesSpriteId(name: string): string | null {
  const species = Dex.species.get(name);
  if (!species.exists) return null;
  const base = toID(species.baseSpecies);
  return species.baseSpecies === species.name ? base : `${base}-${toID(species.forme)}`;
}

export function spriteUrl(species: string): string {
  // "Greninja-*" (unrevealed forme) falls back to the base sprite (B19).
  const name = species.replace(/-\*$/, '');
  const id = speciesSpriteId(name) ?? name
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+$/, '');

  return `https://play.pokemonshowdown.com/sprites/gen5/${id}.png`;
}
