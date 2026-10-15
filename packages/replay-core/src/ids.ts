/** Showdown-style identifiers shared by the replay core, the engine, and the app. */

export type SideId = 'p1' | 'p2';

/** Lowercase alphanumerics only: `toId('Landorus-Therian') === 'landorustherian'`. */
export function toId(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function sideIndex(side: SideId): 0 | 1 {
  return side === 'p1' ? 0 : 1;
}

/**
 * The generation a format plays: the digit its id starts with ('gen2ou', 'gen21v1', and the bare hint 'gen2' the build passes),
 * 9 for an id that names none, clamped to 1..9. The Dex gives the same number for every format it lists
 * (spread-gen12-build.spec.ts checks it over all of them), but not for a hint, which is no format.
 */
export function genNumOf(formatid: string): number {
  const genNumber = parseInt(formatid.match(/^gen(\d)/)?.[1] ?? '9', 10);
  return Math.min(Math.max(genNumber, 1), 9);
}
