import { Generations, Pokemon as CalcPokemon } from '@smogon/calc';
import { Dex } from '@pkmn/dex';
import type { PokemonSet } from '@pkmn/sim';
import { speciesBaseId, type PokemonSnapshot, type TurnSnapshot } from '@fulllifegames/replay-core';
import type {
  BranchMoveOption, BranchSimState, BranchSlotModifiers, BranchSwitchOption, SimPokemonInfo,
} from '@fulllifegames/eval-engine';

/**
 * Data sources for the always-visible pickers (spec: input variant B).
 * 'live' = the branch runtime stands at this position; 'stored' = rebuilt
 * from a recorded serialized position (exact, incl. live PP and disables);
 * 'snapshot' = approximated from replay snapshot + guessed teams — the sim
 * validates legality (choice lock, trapping) when the move executes.
 */
export type PickerSource = 'live' | 'stored' | 'snapshot';

function dexForGen(gen: number) {
  return Dex.forGen(Math.min(9, Math.max(1, Math.round(gen))));
}

/** Move type from the dex — the snapshot knows names, not types, but the
 *  picker buttons color and label by type exactly like the live sim's. */
function moveTypeFor(name: string, gen: number): string {
  try {
    return dexForGen(gen).moves.get(name)?.type || '';
  } catch {
    return '';
  }
}

function speciesTypesFor(species: string, gen: number): string[] {
  try {
    return [...(dexForGen(gen).species.get(species)?.types ?? [])];
  } catch {
    return [];
  }
}

/** Exact pickers from a recorded position — no live stream needed. */
export async function pickerStateFromSerialized(serialized: string): Promise<BranchSimState> {
  const { deserializeBattleExact } = await import('./lazy/forward-model');
  const { createBranchStateFromBattle } = await import('./lazy/branch-engine');
  const battle = deserializeBattleExact(serialized);
  return createBranchStateFromBattle(battle, battle.log ?? [], { p1Choices: [], p2Choices: [] });
}

function moveNamesFor(mon: PokemonSnapshot, set: PokemonSet | undefined): string[] {
  return set?.moves && set.moves.length > 0 ? set.moves : mon.moves;
}

function moveOptionsFor(
  mon: PokemonSnapshot,
  set: PokemonSet | undefined,
  activeSlot: number,
  gen: number,
): BranchMoveOption[] {
  return moveNamesFor(mon, set).map((name, slot) => ({
    name,
    activeSlot,
    slot: slot + 1,
    // PP unknown without the sim — 0/0 renders as a dash, never a dex pool.
    pp: 0,
    maxpp: 0,
    disabled: false,
    type: moveTypeFor(name, gen),
    targetType: 'normal',
    requiresTarget: false,
    targetOptions: [],
  }));
}

/** Protocol snapshots carry HP on the percent scale (maxhp 100, or 0 for a
 *  never-revealed mon) — fed raw into the damage calc that inflated shown
 *  percentages ~3.4×. Recompute the real max HP from the guessed set. */
function absoluteHp(
  mon: PokemonSnapshot,
  set: PokemonSet | undefined,
  gen: number,
): { hp: number; maxhp: number; hpPercent: number } {
  const hpPercent = mon.maxhp === 0 && !mon.fainted ? 100 : mon.hpPercent;
  try {
    const calcGen = Generations.get(Math.min(9, Math.max(1, gen)) as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9);
    const poke = new CalcPokemon(calcGen, mon.speciesForme, {
      level: mon.level || set?.level || 100,
      nature: set?.nature || undefined,
      evs: set?.evs,
      ivs: set?.ivs,
    });
    const maxhp = poke.maxHP();
    const hp = mon.fainted ? 0 : Math.max(1, Math.round(maxhp * hpPercent / 100));
    return { hp, maxhp, hpPercent };
  } catch {
    return { hp: mon.hp, maxhp: mon.maxhp, hpPercent };
  }
}

function pokemonInfoFromSnapshot(
  mon: PokemonSnapshot,
  set: PokemonSet | undefined,
  activeSlot: number | null,
  gen: number,
): SimPokemonInfo {
  const { hp, maxhp, hpPercent } = absoluteHp(mon, set, gen);
  return {
    name: mon.name,
    species: mon.speciesForme,
    hp,
    maxhp,
    hpPercent,
    status: mon.status,
    fainted: mon.fainted,
    isActive: mon.isActive,
    activeSlot,
    moves: moveNamesFor(mon, set).map(name => ({ name, type: moveTypeFor(name, gen) })),
    ability: mon.ability || set?.ability || '',
    item: mon.item || set?.item || '',
    // Raw stats are unknown without the sim, but the damage calc derives
    // them from nature/EVs/IVs — pass the guessed set's spread through so
    // snapshot previews match what the live sim will show.
    stats: { atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
    nature: set?.nature || undefined,
    evs: set?.evs,
    ivs: set?.ivs,
    boosts: { ...mon.boosts },
    level: mon.level || set?.level || 100,
    types: speciesTypesFor(mon.speciesForme, gen),
  };
}

/**
 * Approximate pickers for main-line turns without a recorded position:
 * moves from the guessed teams (falling back to the snapshot's revealed
 * moves), switches from the snapshot's living bench. Legality is settled by
 * the sim at execute time via the existing error path.
 */
interface SnapshotSideOptions {
  movesBySlot: BranchMoveOption[][];
  switchesBySlot: BranchSwitchOption[][];
  activeSlots: SimPokemonInfo[];
  infos: SimPokemonInfo[];
  modifiersBySlot: BranchSlotModifiers[];
}

/** One side's approximate pickers: moves per active slot, the living bench, and the infos. */
function snapshotSideOptions(
  snapshot: TurnSnapshot, side: 'p1' | 'p2', team: PokemonSet[], gen: number,
  bringOnly: { p1: string[]; p2: string[] } | null | undefined,
): SnapshotSideOptions {
  const pokemon = snapshot[side].pokemon;
  const actives = pokemon.filter(mon => mon.isActive && !mon.fainted);
  const setFor = (mon: PokemonSnapshot) =>
    team.find(set => set.species === mon.speciesForme || set.name === mon.name);
  // A never-revealed bench mon (maxhp 0 on the percent scale) is a healthy
  // switch option, not a missing one.
  const benchPercent = (mon: PokemonSnapshot) =>
    (mon.maxhp === 0 && !mon.fainted ? 100 : mon.hpPercent);
  const broughtBases = (bringOnly?.[side] ?? []).map(name => speciesBaseId(name));
  const inBring = (mon: PokemonSnapshot) =>
    broughtBases.length === 0 || broughtBases.includes(speciesBaseId(mon.speciesForme));
  const movesBySlot = actives.map((mon, index) => moveOptionsFor(mon, setFor(mon), index, gen));
  const switchesBySlot = actives.map((_, activeSlot): BranchSwitchOption[] =>
    pokemon
      .filter(mon => !mon.isActive && !mon.fainted && benchPercent(mon) > 0 && inBring(mon))
      .map((mon, index) => ({
        name: mon.name,
        species: mon.speciesForme,
        activeSlot,
        slot: index + 1,
        hp: `${benchPercent(mon)}%`,
        hpPercent: benchPercent(mon),
        fainted: false,
      })));
  const activeSlots = actives.map((mon, index) => pokemonInfoFromSnapshot(mon, setFor(mon), index, gen));
  const infos = pokemon.map(mon =>
    pokemonInfoFromSnapshot(mon, setFor(mon), mon.isActive ? actives.indexOf(mon) : null, gen));
  const modifiersBySlot = actives.map((_, index) => ({
    teraType: null,
    canMegaEvo: false,
    canUltraBurst: false,
    zMoves: (movesBySlot[index] ?? []).map(() => null),
  }));
  return { movesBySlot, switchesBySlot, activeSlots, infos, modifiersBySlot };
}

/** The picker state around both sides' options: a waiting, un-ended position at the snapshot's turn. */
function snapshotPickerState(snapshot: TurnSnapshot, p1: SnapshotSideOptions, p2: SnapshotSideOptions): BranchSimState {
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

export function pickerStateFromSnapshot(
  snapshot: TurnSnapshot,
  p1Team: PokemonSet[],
  p2Team: PokemonSet[],
  gen = 9,
  /** Bring-limited replays: bench options list only the brought species
   *  (base-species match — actives reveal formes the preview does not).
   *  Null (or an empty side) leaves the bench unfiltered. */
  bringOnly?: { p1: string[]; p2: string[] } | null,
): BranchSimState {
  const p1 = snapshotSideOptions(snapshot, 'p1', p1Team, gen, bringOnly);
  const p2 = snapshotSideOptions(snapshot, 'p2', p2Team, gen, bringOnly);
  return snapshotPickerState(snapshot, p1, p2);
}
