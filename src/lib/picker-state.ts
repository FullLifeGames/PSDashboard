import { Pokemon as CalcPokemon } from '@smogon/calc';
import { Dex } from '@pkmn/dex';
import type { PokemonSet } from '@pkmn/sim';
import { CHAMPIONS_MOD, calcEvs, calcGenerationFor, calcIvs, evBudget, speciesBaseId, toId, type PokemonEvs, type PokemonSnapshot, type TurnSnapshot } from '@fulllifegames/replay-core';
import {
  moveAtUse,
  type BranchMoveOption, type BranchSimState, type BranchSlotModifiers, type BranchSwitchOption, type MoveUser, type SimPokemonInfo,
} from '@fulllifegames/eval-engine';
import { teraBanned } from './picker-tera';

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
  const { createBranchStateFromBattle, loadSimModsFor } = await import('./lazy/branch-engine');
  // Round 67 (T145): a Champions position revives on the Champions mod, which nothing before this lazy module loads.
  await loadSimModsFor(serialized);
  const battle = deserializeBattleExact(serialized);
  return createBranchStateFromBattle(battle, battle.log ?? [], { p1Choices: [], p2Choices: [] });
}

function moveNamesFor(mon: PokemonSnapshot, set: PokemonSet | undefined): string[] {
  return set?.moves && set.moves.length > 0 ? set.moves : mon.moves;
}

/**
 * Round 67 (decision 30): the spreads the calc reads for a guessed set. A set of a Champions game holds Stat Points,
 * which @smogon/calc 0.11 reads as EV = 8·SP − 4 with every IV 31 (the server's statModify on every level).
 */
const CHAMPIONS_BUDGET = evBudget('gen9championsou');
function calcSpreadsOf(set: PokemonSet | undefined, champions: boolean): { evs?: Partial<PokemonEvs>; ivs?: Partial<PokemonEvs> } {
  if (!set) return {};
  if (!champions) return { evs: set.evs, ivs: set.ivs };
  return { evs: calcEvs(set.evs as PokemonEvs, CHAMPIONS_BUDGET), ivs: calcIvs(set.ivs as Partial<PokemonEvs>, CHAMPIONS_BUDGET) };
}

/** The evs of a Champions game's info hold Stat Points; the calc converts them through the mod (decision 30). */
const championsMark = (champions: boolean): { mod?: string } => (champions ? { mod: CHAMPIONS_MOD } : {});

/** Attack and Special Attack of the guessed set (Tera Blast's category in the move table; the label reads only the type). */
function guessedAttacks(mon: PokemonSnapshot, set: PokemonSet | undefined, gen: number, champions = false): { atk?: number; spa?: number } {
  if (!set) return {};
  try {
    const calcGen = calcGenerationFor(gen, champions ? CHAMPIONS_MOD : undefined);
    const poke = new CalcPokemon(calcGen, mon.speciesForme, { level: mon.level || set.level || 100, nature: set.nature || undefined, ...calcSpreadsOf(set, champions) });
    return { atk: poke.rawStats.atk, spa: poke.rawStats.spa };
  } catch {
    return {};
  }
}

/**
 * The facts a snapshot holds about a body for the move table (round 67,
 * T85): the species, the revealed ability or every ability the species may
 * have, a revealed item (an empty item is unknown), the Tera click. The
 * hidden type stays unknown.
 */
function snapshotMoveUser(mon: PokemonSnapshot, set: PokemonSet | undefined, gen: number, champions = false): MoveUser {
  const dex = dexForGen(gen);
  const species = dex.species.get(mon.speciesForme);
  const known = species.exists ? species : null;
  const item = mon.item ? dex.items.get(mon.item) : null;
  return {
    gen,
    species: known?.name,
    abilities: mon.ability ? [toId(mon.ability)] : Object.values(known?.abilities ?? {}).map(toId),
    item: item?.exists ? { id: item.id, onPlate: item.onPlate, onMemory: item.onMemory, onDrive: item.onDrive, naturalGift: item.naturalGift } : undefined,
    terastallized: mon.terastallized || null,
    types: known?.types,
    ...guessedAttacks(mon, set, gen, champions),
  };
}

/**
 * The type a move lands with on the snapshot path (round 67, T85): the move
 * table on the snapshot's facts. The weather and the terrain stay unknown,
 * so Weather Ball, Terrain Pulse and Hidden Power keep the catalog type, as
 * does a move whose possible abilities disagree; the live and stored paths
 * ask the simulator instead (branch/state.ts).
 */
function snapshotTypeAtUse(name: string, user: MoveUser, gen: number): string {
  const move = dexForGen(gen).moves.get(name);
  if (!move.exists) return '';
  return moveAtUse(move, user)?.type ?? move.type;
}

function moveOptionsFor(
  mon: PokemonSnapshot,
  set: PokemonSet | undefined,
  activeSlot: number,
  gen: number,
  champions = false,
): BranchMoveOption[] {
  const user = snapshotMoveUser(mon, set, gen, champions);
  return moveNamesFor(mon, set).map((name, slot) => ({
    name,
    activeSlot,
    slot: slot + 1,
    // PP unknown without the sim — 0/0 renders as a dash, never a dex pool.
    pp: 0,
    maxpp: 0,
    disabled: false,
    type: snapshotTypeAtUse(name, user, gen),
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
  champions = false,
): { hp: number; maxhp: number; hpPercent: number } {
  const hpPercent = mon.maxhp === 0 && !mon.fainted ? 100 : mon.hpPercent;
  try {
    const calcGen = calcGenerationFor(gen, champions ? CHAMPIONS_MOD : undefined);
    const poke = new CalcPokemon(calcGen, mon.speciesForme, {
      level: mon.level || set?.level || 100,
      nature: set?.nature || undefined,
      ...calcSpreadsOf(set, champions),
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
  champions: boolean,
): SimPokemonInfo {
  const { hp, maxhp, hpPercent } = absoluteHp(mon, set, gen, champions);
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
    // The damage calc reads the Tera type from here (as on the live and stored paths).
    teraType: mon.terastallized || '',
    ...championsMark(champions),
  };
}

/**
 * The sides that terastallized up to a snapshot (round 67, T136), read from
 * the protocol lines each snapshot keeps: a snapshot clears the Tera type of
 * a body that fainted, and the simulator never gives the side its Tera back.
 */
export function teraUsedSides(snapshots: readonly TurnSnapshot[]): { p1: boolean; p2: boolean } {
  const used = { p1: false, p2: false };
  for (const snapshot of snapshots) {
    for (const line of snapshot.log) {
      if (!line.startsWith('|-terastallize|')) continue;
      const side = line.split('|')[2]?.slice(0, 2);
      if (side === 'p1' || side === 'p2') used[side] = true;
    }
  }
  return used;
}

/**
 * A body transformed into one of these keeps no Tera (sim pokemon.js
 * transformInto names them; the Dex carries no flag). The snapshot has no
 * battle to ask, so regression/picker-state.spec.ts holds this mirror
 * against a live battle.
 */
const NO_TERA_TRANSFORMED_INTO: ReadonlySet<string> = new Set(['Ogerpon', 'Terapagos']);

/**
 * The Tera type the fast picker offers (round 67, T136): the simulator's
 * canTerastallize on the snapshot's facts. The body's Tera type is its
 * set's, else its species' first type (sim pokemon.js); none outside gen 9,
 * once a Pokémon of the side has terastallized, under Terastal Clause, for
 * a held Z crystal or a Mega Stone the body can use (battle-actions
 * canTerastallize and canMegaEvo), or after a transformation into Ogerpon
 * or Terapagos.
 */
function snapshotTeraType(mon: PokemonSnapshot, set: PokemonSet | undefined, gen: number, sideMayTera: boolean): string | null {
  if (!sideMayTera || gen !== 9) return null;
  const dex = dexForGen(gen);
  const species = dex.species.get(set?.species || mon.speciesForme);
  if (transformedWithoutTera(dex, mon, species) || holdsOtherGimmick(dex, set?.item || mon.item, species)) return null;
  return set?.teraType || species.types[0] || null;
}

type GenDex = ReturnType<typeof dexForGen>;
type GenSpecies = ReturnType<GenDex['species']['get']>;

/** The snapshot shows a body transformed into Ogerpon or Terapagos (its set names another species). */
function transformedWithoutTera(dex: GenDex, mon: PokemonSnapshot, species: GenSpecies): boolean {
  const shown = dex.species.get(mon.speciesForme);
  return shown.baseSpecies !== species.baseSpecies && NO_TERA_TRANSFORMED_INTO.has(shown.baseSpecies);
}

/** A held Z crystal, or a Mega Stone the body can use, takes the place of Tera (battle-actions canMegaEvo). */
function holdsOtherGimmick(dex: GenDex, itemName: string, species: GenSpecies): boolean {
  const item = dex.items.get(itemName);
  if (!item.exists) return false;
  const stone = item.megaStone;
  return !!item.zMove || !!(stone && (stone[species.name] || stone[species.baseSpecies]));
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
  bringOnly: { p1: string[]; p2: string[] } | null | undefined, teraAllowed: boolean, champions = false,
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
  const movesBySlot = actives.map((mon, index) => moveOptionsFor(mon, setFor(mon), index, gen, champions));
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
  const activeSlots = actives.map((mon, index) => pokemonInfoFromSnapshot(mon, setFor(mon), index, gen, champions));
  const infos = pokemon.map(mon =>
    pokemonInfoFromSnapshot(mon, setFor(mon), mon.isActive ? actives.indexOf(mon) : null, gen, champions));
  // One Tera per side and battle: a terastallized teammate spent it.
  const sideMayTera = teraAllowed && !pokemon.some(mon => mon.terastallized);
  const modifiersBySlot = actives.map((mon, index) => ({
    teraType: snapshotTeraType(mon, setFor(mon), gen, sideMayTera),
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
  /**
   * Round 67 (T136): the branch simulator format (getBranchSimulatorFormat),
   * whose rule table says whether Tera exists at all, and the sides that
   * terastallized before this snapshot (teraUsedSides).
   */
  rules: { format?: string; teraUsed?: { p1: boolean; p2: boolean } } = {},
): BranchSimState {
  const teraAllowed = !teraBanned(rules.format);
  // Round 67 (decision 30): a Champions format's sets hold Stat Points.
  const champions = evBudget(rules.format ?? '').statPoints;
  const p1 = snapshotSideOptions(snapshot, 'p1', p1Team, gen, bringOnly, teraAllowed && !rules.teraUsed?.p1, champions);
  const p2 = snapshotSideOptions(snapshot, 'p2', p2Team, gen, bringOnly, teraAllowed && !rules.teraUsed?.p2, champions);
  return snapshotPickerState(snapshot, p1, p2);
}
