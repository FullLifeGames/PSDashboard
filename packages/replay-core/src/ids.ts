/** Showdown-style identifiers shared by the replay core, the engine, and the app. */

export type SideId = 'p1' | 'p2';

/** Lowercase alphanumerics only: `toId('Landorus-Therian') === 'landorustherian'`. */
export function toId(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function sideIndex(side: SideId): 0 | 1 {
  return side === 'p1' ? 0 : 1;
}
