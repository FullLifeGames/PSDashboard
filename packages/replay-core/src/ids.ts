/** Showdown-style identifiers shared by the replay core, the engine, and the app. */

/** A side of a battle: `p1` or `p2`. */
export type SideId = 'p1' | 'p2';

/** Lowercase alphanumerics only: `toId('Landorus-Therian') === 'landorustherian'`. */
export function toId(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** The index of a side: 0 for `p1`, 1 for `p2`. */
export function sideIndex(side: SideId): 0 | 1 {
  return side === 'p1' ? 0 : 1;
}

/** The generation a format plays: the digit its id starts with (also the bare hint 'gen2'), 9 for an id that names none, clamped to 1..9. */
export function genNumOf(formatid: string): number {
  const genNumber = parseInt(formatid.match(/^gen(\d)/)?.[1] ?? '9', 10);
  return Math.min(Math.max(genNumber, 1), 9);
}
