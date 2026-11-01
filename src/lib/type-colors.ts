/** Pokémon Showdown's type colors, the badge backgrounds across the UI. */
export const TYPE_BG: Readonly<Record<string, string>> = {
  Normal: '#A8A878',
  Fire: '#F08030',
  Water: '#6890F0',
  Electric: '#F8D030',
  Grass: '#78C850',
  Ice: '#98D8D8',
  Fighting: '#C03028',
  Poison: '#A040A0',
  Ground: '#E0C068',
  Flying: '#A890F0',
  Psychic: '#F85888',
  Bug: '#A8B820',
  Rock: '#B8A038',
  Ghost: '#705898',
  Dragon: '#7038F8',
  Dark: '#705848',
  Steel: '#B8B8D0',
  Fairy: '#EE99AC',
  Stellar: '#40B5A5',
  '???': '#68A090',
};

/** The type's color, or the unknown-type grey. */
export function typeBg(type: string): string {
  return TYPE_BG[type] || '#68A090';
}

/** The navy a move tile mixes its type color into: the surface of the branch panel. */
const TILE_NAVY = '#16233b';

const channels = (hex: string): number[] => [1, 3, 5].map(index => Number.parseInt(hex.slice(index, index + 2), 16));
const hexOf = (values: number[]): string => `#${values.map(value => Math.round(value).toString(16).padStart(2, '0')).join('')}`;

/** `share` of `color` laid over `base`, channel by channel (both #rrggbb). */
export function mixColor(color: string, base: string, share: number): string {
  const under = channels(base);
  return hexOf(channels(color).map((value, index) => value * share + under[index] * (1 - share)));
}

/** WCAG's relative luminance of a #rrggbb color. */
function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map(value => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG's contrast ratio of two #rrggbb colors, from 1 (the same) to 21 (white on black). */
export function contrastRatio(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

/** The text that reads on the full type color: white or the tile navy, whichever contrasts more. */
export function onTypeColor(type: string): string {
  const color = typeBg(type);
  return contrastRatio('#ffffff', color) >= contrastRatio(TILE_NAVY, color) ? '#ffffff' : TILE_NAVY;
}

/**
 * Round 83 (the user's design gate of 01.11.2026): a move tile carries its type as a tint mixed deep into the navy, so light text
 * reads on every type, and the full type color on its top line, its type badge and its selection ring. pickers.css reads these
 * properties; test/regression/move-tile-contrast.spec.ts holds every text at 4.5 : 1 or more.
 */
export function typeTileVars(type: string): { '--type': string; '--type-on': string; '--tint': string; '--tint-low': string; '--tint-edge': string } {
  const color = typeBg(type);
  return {
    '--type': color,
    '--type-on': onTypeColor(type),
    '--tint': mixColor(color, TILE_NAVY, 0.36),
    '--tint-low': mixColor(color, TILE_NAVY, 0.25),
    '--tint-edge': mixColor(color, TILE_NAVY, 0.6),
  };
}
