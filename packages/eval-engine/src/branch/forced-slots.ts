import { fillableForcedSlots } from '../branch-choices.ts';
import { isReviving } from '../forward/request-reviving.ts';
import type { SimBattle, SimSide } from './types.ts';

/** The living Pokémon behind the actives (`canSwitchIn` in side.js); null while a Revival Blessing prompt is open. */
export function switchInsOf(side: SimSide): number | null {
  if (isReviving(side)) return null;
  return side.pokemon.slice(side.active.length).filter(pokemon => pokemon && !pokemon.fainted).length;
}

export function forceSwitches(battle: SimBattle, sideIdx: number): boolean[] {
  const side = battle.sides[sideIdx];
  const requests = side.activeRequest?.forceSwitch;
  const asked = Array.from({ length: side.active.length }, (_, index) => requests?.[index] ?? false);
  return fillableForcedSlots(asked, switchInsOf(side) ?? undefined);
}

export function hasForceSwitch(battle: SimBattle, sideIdx: number): boolean {
  return forceSwitches(battle, sideIdx).some(Boolean);
}
