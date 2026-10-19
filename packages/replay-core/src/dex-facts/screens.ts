/**
 * Round 72 (T235, GO point 4): the screens, in one constant. Seven readers kept their own list of the same three side
 * conditions (score/features.ts, pair/snapshot.ts, damage-calc.ts, inference/hits.ts, protocol/handlers.ts,
 * team/item-damage-shared.ts, spreads/observation-read.ts). The Dex cannot say them: the handler rule (`onAnyModifyDamage`)
 * finds them only from Generation 5, and Generations 1 to 4 build Reflect and Light Screen differently, so the set stays a
 * constant. Each screen also names the flag the damage calculator reads it by.
 */
// oracle: packages/replay-core/test/screens-oracle.spec.ts
export const SCREEN_FLAGS = { reflect: 'isReflect', lightscreen: 'isLightScreen', auroraveil: 'isAuroraVeil' } as const;

export type ScreenId = keyof typeof SCREEN_FLAGS;

export const SCREENS = Object.keys(SCREEN_FLAGS) as readonly ScreenId[];

export const isScreen = (id: string): id is ScreenId => (SCREENS as readonly string[]).includes(id);

/** The calculator's side flags for a set of standing side conditions: every screen present, the rest ignored. */
export function screenFlags(standing: Iterable<string>): Record<(typeof SCREEN_FLAGS)[ScreenId], boolean> {
  const on = new Set(standing);
  return Object.fromEntries(SCREENS.map(id => [SCREEN_FLAGS[id], on.has(id)])) as Record<(typeof SCREEN_FLAGS)[ScreenId], boolean>;
}

/** A side as the simulator and the client hold it: its side conditions, and the volatiles of its active Pokémon. */
export interface ScreenHolder {
  sideConditions: Readonly<Record<string, unknown>>;
  active: readonly (null | undefined | { volatiles: Readonly<Record<string, unknown>> })[];
}

/**
 * The screens standing on a side. Generation 1 builds Reflect and Light Screen as volatiles of the Pokémon that used them (no side
 * condition, gone when it leaves), so a read of `sideConditions` alone never sees them there (round 72, W10); the later
 * generations hold a screen as a side condition. Both are read.
 */
export const standingScreens = (side: ScreenHolder): ScreenId[] =>
  SCREENS.filter(id => side.sideConditions[id] || side.active.some(mon => mon?.volatiles[id]));
