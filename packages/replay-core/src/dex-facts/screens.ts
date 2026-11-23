/** The screens with the flag the damage calculator reads each by; a constant, because `onAnyModifyDamage` finds them only from Generation 5 on. */
// oracle: packages/replay-core/test/screens-oracle.spec.ts
export const SCREEN_FLAGS = { reflect: 'isReflect', lightscreen: 'isLightScreen', auroraveil: 'isAuroraVeil' } as const;

/** The Dex id of one screen: `reflect`, `lightscreen` or `auroraveil`. */
export type ScreenId = keyof typeof SCREEN_FLAGS;

/** The three screens, by Dex id. */
export const SCREENS = Object.keys(SCREEN_FLAGS) as readonly ScreenId[];

/** Whether the id names a screen. */
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

/** The screens standing on a side: a side condition, or, in Generation 1, a volatile of the Pokémon that used Reflect or Light Screen (gone when it leaves). */
export const standingScreens = (side: ScreenHolder): ScreenId[] =>
  SCREENS.filter(id => side.sideConditions[id] || side.active.some(mon => mon?.volatiles[id]));
