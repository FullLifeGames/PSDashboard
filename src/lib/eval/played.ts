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
}

export interface PlayedTurn {
  p1: PlayedAction | null;
  p2: PlayedAction | null;
}

const sideOf = (pokemonRef: string): 'p1' | 'p2' | null => {
  if (pokemonRef.startsWith('p1')) return 'p1';
  if (pokemonRef.startsWith('p2')) return 'p2';
  return null;
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

  for (const line of lines) {
    const parts = line.split('|');
    const tag = parts[1];
    if (!tag) continue;

    if (tag === '-terastallize') {
      const side = sideOf(parts[2] ?? '');
      if (side) tera[side] = true;
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
      actions[side] = { kind: 'move', name: parts[3] ?? '', tera: tera[side] };
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
