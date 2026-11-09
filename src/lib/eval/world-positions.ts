/**
 * Round 89 (#124): the positions of a short-side game's other worlds. A side that brought more bodies than it fielded holds unknown
 * bodies, each set of guesses is a world (`bringWorlds` in the engine), and the app plays every world's position of a turn. The user
 * sees and plays the heaviest world, so the position it hands out is the key: the registry maps it to its sibling positions with the
 * worlds' weights, and the worker client (`evaluate`, `evalPair`) looks every position up here before it searches. A position the
 * registry does not know (a game that brought all it could, a pinned game, a rolled copy, a branch position) runs once, as before.
 *
 * Module state on purpose: the evaluation paths (the sweep, the verify round, the replacements, the lead analysis, the single
 * Evaluate) reach the client with a serialized position and nothing else, and this is the only place that all of them can ask.
 */
export interface WorldPosition {
  /** The serialized battle of this world. */
  position: string;
  /** The world's share of the game: relative, the client normalizes over the worlds that answer. */
  weight: number;
}

/** The registry holds this many positions; the oldest leave first (a long game with replacements and probes stays far below). */
export const WORLD_POSITION_CAP = 4_096;

const registry = new Map<string, WorldPosition[]>();

/**
 * Registers the worlds of one position, the heaviest first: its position is the key. Fewer than two worlds register nothing and
 * forget an earlier entry of the same key. A second registration of the key replaces the first (the weights moved, or a sibling did).
 */
export function registerWorldPositions(worlds: readonly WorldPosition[]): void {
  const key = worlds[0]?.position;
  if (key === undefined) return;
  registry.delete(key);
  if (worlds.length < 2) return;
  registry.set(key, worlds.map(world => ({ ...world })));
  if (registry.size > WORLD_POSITION_CAP) registry.delete(registry.keys().next().value!);
}

/** The worlds of a position (the heaviest first, itself included), or null when it has no siblings. */
export function worldPositionsOf(position: string): readonly WorldPosition[] | null {
  return registry.get(position) ?? null;
}

/**
 * The worlds of `position` after the same edit: registers `patched` (the heaviest world's edited position) with each other world's
 * position run through `patch`. A world the edit does not fit (`patch` returns null) leaves the blend. Nothing registers when
 * `position` has no siblings. The item-sensitivity probe edits one guessed item and values the edited position in every world.
 */
export function registerPatchedWorlds(position: string, patched: string, patch: (world: string) => string | null): void {
  const worlds = worldPositionsOf(position);
  if (!worlds) return;
  const siblings = worlds.slice(1).flatMap((world): WorldPosition[] => {
    const edited = patch(world.position);
    return edited === null ? [] : [{ position: edited, weight: world.weight }];
  });
  registerWorldPositions([{ position: patched, weight: worlds[0].weight }, ...siblings]);
}

/** Forgets every position: a new replay or new set knowledge builds other positions. */
export function clearWorldPositions(): void {
  registry.clear();
}
