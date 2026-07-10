/**
 * Builds play.pokemonshowdown.com sprite URLs. PS names sprite files after the
 * species ID: hyphens that are part of the BASE name are dropped
 * ("Ting-Lu" → tinglu.png), while forme hyphens stay ("Rotom-Wash" →
 * rotom-wash.png).
 */
const HYPHENATED_BASE_SPECIES = new Set([
  'ho-oh',
  'porygon-z',
  'jangmo-o',
  'hakamo-o',
  'kommo-o',
  'ting-lu',
  'chien-pao',
  'wo-chien',
  'chi-yu',
  'nidoran-f',
  'nidoran-m',
]);

export function spriteUrl(species: string): string {
  let id = species
    .toLowerCase()
    // "Greninja-*" (unrevealed forme) falls back to the base sprite (B19).
    .replace(/-\*$/, '')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+$/, '');

  for (const base of HYPHENATED_BASE_SPECIES) {
    if (id === base || id.startsWith(`${base}-`)) {
      id = base.replace(/-/g, '') + id.slice(base.length);
      break;
    }
  }

  return `https://play.pokemonshowdown.com/sprites/gen5/${id}.png`;
}
