/**
 * The positions of a short-side game's other worlds (`bringWorlds` in the engine). The heaviest world's position is the key; the
 * registry maps it to its siblings with their weights, and the worker client looks every position up here before it searches.
 * A position the registry does not know runs once.
 *
 * Module state on purpose: every evaluation path reaches the client with a serialized position and nothing else.
 */
export interface WorldPosition {
  position: string;
  /** The world's share of the game: relative, the client normalizes over the worlds that answer. */
  weight: number;
}

export const WORLD_POSITION_CAP = 4_096;

const registry = new Map<string, WorldPosition[]>();

export function registerWorldPositions(worlds: readonly WorldPosition[]): void {
  const key = worlds[0]?.position;
  if (key === undefined) return;
  registry.delete(key);
  if (worlds.length < 2) return;
  registry.set(key, worlds.map(world => ({ ...world })));
  if (registry.size > WORLD_POSITION_CAP) registry.delete(registry.keys().next().value!);
}

export function worldPositionsOf(position: string): readonly WorldPosition[] | null {
  return registry.get(position) ?? null;
}

/**
 * Registers `patched` (the heaviest world's edited position) with each other world's position run through `patch`. A world the
 * edit does not fit (`patch` returns null) leaves the blend; nothing registers when `position` has no siblings.
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

export function clearWorldPositions(): void {
  registry.clear();
}
