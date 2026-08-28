import type { PokemonSet } from '@pkmn/sim';
import type { PokemonSnapshot, TurnSnapshot } from '../types';
import type {
  BranchMoveOption, BranchSimState, BranchSwitchOption, SimPokemonInfo,
} from './branch-engine';

/**
 * Data sources for the always-visible pickers (spec: input variant B).
 * 'live' = the branch runtime stands at this position; 'stored' = rebuilt
 * from a recorded serialized position (exact, incl. live PP and disables);
 * 'snapshot' = approximated from replay snapshot + guessed teams — the sim
 * validates legality (choice lock, trapping) when the move executes.
 */
export type PickerSource = 'live' | 'stored' | 'snapshot';

export function pickerSourceLabel(source: PickerSource): string {
  if (source === 'live') return 'aus lebendem Sim';
  if (source === 'stored') return 'aus gespeicherter Stellung';
  return 'aus Snapshot — Sim prüft beim Ausführen';
}

/** Exact pickers from a recorded position — no live stream needed. */
export async function pickerStateFromSerialized(serialized: string): Promise<BranchSimState> {
  const { deserializeBattleExact } = await import('./eval/forward-model');
  const { createBranchStateFromBattle } = await import('./branch-engine');
  const battle = deserializeBattleExact(serialized);
  return createBranchStateFromBattle(battle, battle.log ?? [], { p1Choices: [], p2Choices: [] });
}

function moveOptionsFor(
  mon: PokemonSnapshot,
  set: PokemonSet | undefined,
  activeSlot: number,
): BranchMoveOption[] {
  const names = set?.moves && set.moves.length > 0 ? set.moves : mon.moves;
  return names.map((name, slot) => ({
    name,
    activeSlot,
    slot: slot + 1,
    // PP unknown without the sim — 0/0 renders as a dash, never a dex pool.
    pp: 0,
    maxpp: 0,
    disabled: false,
    type: '',
    targetType: 'normal',
    requiresTarget: false,
    targetOptions: [],
  }));
}

function pokemonInfoFromSnapshot(mon: PokemonSnapshot, activeSlot: number | null): SimPokemonInfo {
  return {
    name: mon.name,
    species: mon.speciesForme,
    hp: mon.hp,
    maxhp: mon.maxhp,
    hpPercent: mon.hpPercent,
    status: mon.status,
    fainted: mon.fainted,
    isActive: mon.isActive,
    activeSlot,
    moves: mon.moves.map(name => ({ name, type: '' })),
    ability: mon.ability,
    item: mon.item,
    stats: { atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
    boosts: { ...mon.boosts },
    level: mon.level,
    types: [],
  };
}

/**
 * Approximate pickers for main-line turns without a recorded position:
 * moves from the guessed teams (falling back to the snapshot's revealed
 * moves), switches from the snapshot's living bench. Legality is settled by
 * the sim at execute time via the existing error path.
 */
export function pickerStateFromSnapshot(
  snapshot: TurnSnapshot,
  p1Team: PokemonSet[],
  p2Team: PokemonSet[],
): BranchSimState {
  const build = (side: 'p1' | 'p2', team: PokemonSet[]) => {
    const pokemon = snapshot[side].pokemon;
    const actives = pokemon.filter(mon => mon.isActive && !mon.fainted);
    const setFor = (mon: PokemonSnapshot) =>
      team.find(set => set.species === mon.speciesForme || set.name === mon.name);
    const movesBySlot = actives.map((mon, index) => moveOptionsFor(mon, setFor(mon), index));
    const switchesBySlot = actives.map((_, activeSlot): BranchSwitchOption[] =>
      pokemon
        .filter(mon => !mon.isActive && !mon.fainted && mon.hpPercent > 0)
        .map((mon, index) => ({
          name: mon.name,
          species: mon.speciesForme,
          activeSlot,
          slot: index + 1,
          hp: `${mon.hpPercent}%`,
          hpPercent: mon.hpPercent,
          fainted: false,
        })));
    const activeSlots = actives.map((mon, index) => pokemonInfoFromSnapshot(mon, index));
    const infos = pokemon.map(mon =>
      pokemonInfoFromSnapshot(mon, mon.isActive ? actives.indexOf(mon) : null));
    const modifiersBySlot = actives.map((_, index) => ({
      teraType: null,
      canMegaEvo: false,
      canUltraBurst: false,
      zMoves: (movesBySlot[index] ?? []).map(() => null),
    }));
    return { movesBySlot, switchesBySlot, activeSlots, infos, modifiersBySlot };
  };
  const p1 = build('p1', p1Team);
  const p2 = build('p2', p2Team);
  return {
    p1Moves: p1.movesBySlot[0] ?? [],
    p1MovesBySlot: p1.movesBySlot,
    p1Switches: p1.switchesBySlot[0] ?? [],
    p1SwitchesBySlot: p1.switchesBySlot,
    p2Moves: p2.movesBySlot[0] ?? [],
    p2MovesBySlot: p2.movesBySlot,
    p2Switches: p2.switchesBySlot[0] ?? [],
    p2SwitchesBySlot: p2.switchesBySlot,
    p1Pokemon: p1.infos,
    p2Pokemon: p2.infos,
    p1Active: p1.activeSlots[0] ?? null,
    p1ActiveSlots: p1.activeSlots,
    p2Active: p2.activeSlots[0] ?? null,
    p2ActiveSlots: p2.activeSlots,
    p1ModifiersBySlot: p1.modifiersBySlot,
    p2ModifiersBySlot: p2.modifiersBySlot,
    field: {
      weather: snapshot.field.weather || '',
      terrain: snapshot.field.terrain || '',
      p1SideConditions: Object.keys(snapshot.p1.sideConditions),
      p2SideConditions: Object.keys(snapshot.p2.sideConditions),
    },
    log: [],
    ended: false,
    winner: null,
    waitingForChoice: true,
    turnNumber: snapshot.turn,
    p1ForceSwitch: false,
    p1ForceSwitches: [],
    p2ForceSwitch: false,
    p2ForceSwitches: [],
    p1Choice: null,
    p1Choices: [],
    p2Choice: null,
    p2Choices: [],
  };
}
