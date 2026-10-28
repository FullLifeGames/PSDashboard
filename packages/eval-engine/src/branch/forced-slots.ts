import { fillableForcedSlots } from '../branch-choices.ts';
import type { SimBattle, SimSide } from './types.ts';

/**
 * The Pokémon a side can still send in: the living ones behind the actives, as the simulator counts them
 * (`canSwitchIn` in side.js). Null while a Revival Blessing prompt is open (its request marks the body
 * `reviving`): the target of that switch is a fainted one.
 */
export function switchInsOf(side: SimSide): number | null {
  const party = (side.activeRequest as { side?: { pokemon?: { active?: boolean; reviving?: boolean }[] } } | null)?.side?.pokemon;
  if (party?.some(entry => entry.active && entry.reviving)) return null;
  return side.pokemon.slice(side.active.length).filter(pokemon => pokemon && !pokemon.fainted).length;
}

/**
 * The slots whose replacement the user chooses: the request's forced slots, capped by the bench (round 77,
 * B1). A forced slot the bench cannot fill passes, so it reads like a fainted active without a request.
 */
export function forceSwitches(battle: SimBattle, sideIdx: number): boolean[] {
  const side = battle.sides[sideIdx];
  const requests = side.activeRequest?.forceSwitch;
  const asked = Array.from({ length: side.active.length }, (_, index) => requests?.[index] ?? false);
  return fillableForcedSlots(asked, switchInsOf(side) ?? undefined);
}

export function hasForceSwitch(battle: SimBattle, sideIdx: number): boolean {
  return forceSwitches(battle, sideIdx).some(Boolean);
}
