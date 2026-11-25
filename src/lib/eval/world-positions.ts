/** The other worlds of a short-side game, keyed by the heaviest world's position; an unknown position runs once. */
// Module state on purpose: every evaluation path reaches the client with a serialized position and nothing else.
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

/** Registers `patched` with every other world run through `patch`; a world that returns null leaves the blend. */
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
