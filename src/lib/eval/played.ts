/**
 * Parses what each side actually chose in one turn's protocol block. Pure —
 * no @pkmn/sim imports, main-bundle safe.
 */

export interface PlayedAction {
  kind: 'move' | 'switch';
  /** Move name, or the incoming Pokémon's nickname for switches. */
  name: string;
  /** Switches: the species (matching fallback when the nickname differs). */
  species?: string;
  /** Move actions: the side terastallized this turn. */
  tera?: boolean;
  /** Move actions: the Pokémon Mega Evolved / Ultra Bursted this turn. */
  mega?: boolean;
  ultra?: boolean;
  /**
   * Doubles moves: the sim target location (1/2 = foe slots, negative =
   * own side), null when the line names no slot target (spread/self).
   */
  targetLoc?: number | null;
}

export interface PlayedTurn {
  p1: PlayedAction | null;
  p2: PlayedAction | null;
  /** Doubles: per-slot actions (index 0 = slot a). Absent for singles. */
  p1Slots?: (PlayedAction | null)[];
  p2Slots?: (PlayedAction | null)[];
}

const sideOf = (pokemonRef: string): 'p1' | 'p2' | null => {
  if (pokemonRef.startsWith('p1')) return 'p1';
  if (pokemonRef.startsWith('p2')) return 'p2';
  return null;
};

const slotOf = (pokemonRef: string): { side: 'p1' | 'p2'; slot: number } | null => {
  const match = pokemonRef.match(/^(p[12])([a-c])/);
  if (!match) return null;
  return { side: match[1] as 'p1' | 'p2', slot: match[2].charCodeAt(0) - 97 };
};

const nickname = (pokemonRef: string): string => pokemonRef.replace(/^p[12][a-c]: /, '');

/**
 * Per side, the chosen action is its first `|move|` or `|switch|` line —
 * with the protocol's traps excluded: switches after the side already moved
 * are pivots (U-turn), switches after the side's own faint are replacements,
 * `|drag|`/`|replace|` are never choices, and `|cant|` means the choice
 * never surfaced (the side stays unknown rather than guessed).
 */
export function parsePlayedActions(lines: string[]): PlayedTurn {
  const actions: { p1: PlayedAction | null; p2: PlayedAction | null } = { p1: null, p2: null };
  const settled = { p1: false, p2: false };
  const tera = { p1: false, p2: false };
  const mega = { p1: false, p2: false };
  const ultra = { p1: false, p2: false };

  for (const line of lines) {
    const parts = line.split('|');
    const tag = parts[1];
    if (!tag) continue;

    if (tag === '-terastallize' || tag === '-mega' || tag === '-burst') {
      const side = sideOf(parts[2] ?? '');
      if (side) {
        if (tag === '-terastallize') tera[side] = true;
        else if (tag === '-mega') mega[side] = true;
        else ultra[side] = true;
      }
      continue;
    }
    if (tag === 'faint' || tag === 'cant') {
      // The side's queued choice was cancelled (or never shown) — whatever
      // follows for it (replacements) is not the chosen action.
      const side = sideOf(parts[2] ?? '');
      if (side) settled[side] = true;
      continue;
    }
    if (tag === 'move') {
      const side = sideOf(parts[2] ?? '');
      if (!side || settled[side]) continue;
      actions[side] = {
        kind: 'move', name: parts[3] ?? '', tera: tera[side],
        ...(mega[side] ? { mega: true } : {}), ...(ultra[side] ? { ultra: true } : {}),
      };
      settled[side] = true;
      continue;
    }
    if (tag === 'switch') {
      const side = sideOf(parts[2] ?? '');
      if (!side || settled[side]) continue;
      const species = (parts[3] ?? '').split(',')[0].trim();
      actions[side] = { kind: 'switch', name: nickname(parts[2] ?? ''), species };
      settled[side] = true;
      continue;
    }
  }

  return actions;
}

/**
 * Doubles variant: the same settle rules applied per SLOT (a/b), plus move
 * target locations so combined engine choices can be matched exactly.
 */
export function parsePlayedActionsDoubles(lines: string[]): PlayedTurn {
  const slots: Record<'p1' | 'p2', (PlayedAction | null)[]> = { p1: [null, null], p2: [null, null] };
  const settled: Record<'p1' | 'p2', boolean[]> = { p1: [false, false], p2: [false, false] };
  const tera: Record<'p1' | 'p2', boolean[]> = { p1: [false, false], p2: [false, false] };
  const mega: Record<'p1' | 'p2', boolean[]> = { p1: [false, false], p2: [false, false] };
  const ultra: Record<'p1' | 'p2', boolean[]> = { p1: [false, false], p2: [false, false] };

  for (const line of lines) {
    const parts = line.split('|');
    const tag = parts[1];
    if (!tag) continue;
    const ref = slotOf(parts[2] ?? '');
    if (!ref || ref.slot > 1) continue;

    if (tag === '-terastallize') {
      tera[ref.side][ref.slot] = true;
    } else if (tag === '-mega') {
      mega[ref.side][ref.slot] = true;
    } else if (tag === '-burst') {
      ultra[ref.side][ref.slot] = true;
    } else if (tag === 'faint' || tag === 'cant') {
      settled[ref.side][ref.slot] = true;
    } else if (tag === 'move') {
      if (settled[ref.side][ref.slot]) continue;
      const target = slotOf(parts[4] ?? '');
      const targetLoc = target === null || target.slot > 1
        ? null
        : target.side === ref.side ? -(target.slot + 1) : target.slot + 1;
      slots[ref.side][ref.slot] = {
        kind: 'move', name: parts[3] ?? '', tera: tera[ref.side][ref.slot],
        ...(mega[ref.side][ref.slot] ? { mega: true } : {}),
        ...(ultra[ref.side][ref.slot] ? { ultra: true } : {}),
        targetLoc,
      };
      settled[ref.side][ref.slot] = true;
    } else if (tag === 'switch') {
      if (settled[ref.side][ref.slot]) continue;
      const species = (parts[3] ?? '').split(',')[0].trim();
      slots[ref.side][ref.slot] = { kind: 'switch', name: nickname(parts[2] ?? ''), species };
      settled[ref.side][ref.slot] = true;
    }
  }

  return { p1: null, p2: null, p1Slots: slots.p1, p2Slots: slots.p2 };
}
