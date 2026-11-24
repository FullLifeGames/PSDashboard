import type { PokemonSet } from '@pkmn/sim';
import { CHAMPIONS_MOD, type GameRules, type RulesDex, buildCalcPokemon, dexOf, calcGenerationFor, evBudget, speciesBaseId, toId, type PokemonSnapshot, type TurnSnapshot } from '@fulllifegames/replay-core';
import {
  moveAtUse, sightedHpAt, snapshotMoveTypes, snapshotSimFacts, speciesAfterTeraClick,
  type BranchMoveOption, type BranchSimState, type BranchSlotModifiers, type BranchSwitchOption, type MoveUser, type SimPokemonInfo,
} from '@fulllifegames/eval-engine';
import { teraBanned } from './picker-tera';
import { fieldRow } from './field-row';

/** 'stored' is exact (incl. PP and disables); 'snapshot' is approximated from the replay snapshot and guessed teams. */
export type PickerSource = 'live' | 'stored' | 'snapshot';

const gameRules = (gen: number, champions: boolean): GameRules => ({ gen: Math.round(gen), mod: champions ? CHAMPIONS_MOD : undefined });
const dexFor = (gen: number, champions: boolean): RulesDex => dexOf(gameRules(gen, champions));

function moveTypeFor(name: string, gen: number, champions: boolean): string {
  try {
    return dexFor(gen, champions).moves.get(name)?.type || '';
  } catch {
    return '';
  }
}

function speciesTypesFor(species: string, gen: number, champions: boolean): string[] {
  try {
    return [...(dexFor(gen, champions).species.get(species)?.types ?? [])];
  } catch {
    return [];
  }
}

export { pickerFromSerialized, pickerStateFromSerialized, type PickerBattle } from './picker-stored';

function moveNamesFor(mon: PokemonSnapshot, set: PokemonSet | undefined): string[] {
  return set?.moves && set.moves.length > 0 ? set.moves : mon.moves;
}

// A Champions game's evs hold Stat Points, which the calc's Champions generation (0) reads as they are.
const championsMark = (champions: boolean): { mod?: string } => (champions ? { mod: CHAMPIONS_MOD } : {});

function guessedAttacks(mon: PokemonSnapshot, set: PokemonSet | undefined, gen: number, champions = false): { atk?: number; spa?: number } {
  if (!set) return {};
  try {
    const calcGen = calcGenerationFor(gen, champions ? CHAMPIONS_MOD : undefined);
    const poke = buildCalcPokemon(calcGen, mon.speciesForme, { level: mon.level || set.level || 100, nature: set.nature || undefined, evs: set.evs, ivs: set.ivs });
    return { atk: poke.rawStats.atk, spa: poke.rawStats.spa };
  } catch {
    return {};
  }
}

function snapshotMoveUser(mon: PokemonSnapshot, set: PokemonSet | undefined, gen: number, champions = false): MoveUser {
  const dex = dexFor(gen, champions);
  const species = dex.species.get(mon.speciesForme);
  const known = species.exists ? species : null;
  const item = mon.item ? dex.items.get(mon.item) : null;
  return {
    gen,
    species: known?.name,
    abilities: mon.ability ? [toId(mon.ability)] : set?.ability ? [toId(set.ability)] : Object.values(known?.abilities ?? {}).map(toId),
    item: item?.exists ? { id: item.id, onPlate: item.onPlate, onMemory: item.onMemory, onDrive: item.onDrive, naturalGift: item.naturalGift } : undefined,
    terastallized: mon.terastallized || null,
    types: known?.types,
    ...guessedAttacks(mon, set, gen, champions),
  };
}

// No simulator twin: no weather or terrain, so Weather Ball, Terrain Pulse and Hidden Power keep the catalog type.
function snapshotTypeAtUse(name: string, user: MoveUser, gen: number, champions: boolean): string {
  const move = dexFor(gen, champions).moves.get(name);
  if (!move.exists) return '';
  return moveAtUse(move, user)?.type ?? move.type;
}

function typesUnderTera(info: SimPokemonInfo, user: MoveUser, teraType: string | null, gen: number, champions: boolean): (name: string) => string | undefined {
  if (!teraType) return () => undefined;
  const clicked: MoveUser = { ...user, terastallized: teraType, species: speciesAfterTeraClick(gen, info, teraType) };
  return name => snapshotTypeAtUse(name, clicked, gen, champions);
}

function moveOptionsFor(
  mon: PokemonSnapshot,
  set: PokemonSet | undefined,
  activeSlot: number,
  gen: number,
  champions: boolean,
  tera: { info: SimPokemonInfo; type: string | null },
  field: { weather: string; terrain: string },
): BranchMoveOption[] {
  const user = snapshotMoveUser(mon, set, gen, champions);
  const names = moveNamesFor(mon, set);
  const read = snapshotMoveTypes({ gen, champions, body: tera.info, abilities: user.abilities, field, clickTera: tera.type, moves: names });
  let tableLabels: ReturnType<typeof typesUnderTera> | null = null;
  const underTera = (name: string) => (tableLabels ??= typesUnderTera(tera.info, user, tera.type, gen, champions))(name);
  return names.map((name, slot): BranchMoveOption => {
    const simulated = read?.get(name);
    const type = simulated?.type ?? snapshotTypeAtUse(name, user, gen, champions);
    const clicked = simulated ? simulated.typeUnderTera : underTera(name);
    return {
      name,
      activeSlot,
      slot: slot + 1,
      // PP unknown without the sim: 0/0 renders as a dash, never a dex pool.
      pp: 0,
      maxpp: 0,
      disabled: false,
      type,
      ...(clicked && clicked !== type ? { typeUnderTera: clicked } : {}),
      targetType: 'normal',
      requiresTarget: false,
      targetOptions: [],
    };
  });
}

function sightedAbsoluteHp(mon: PokemonSnapshot, gen: number, champions: boolean, maxhp: number): number | null {
  const unseen = mon.maxhp === 0;
  const scale = unseen ? 100 : mon.maxhp;
  return scale === 100 || scale === 48 ? sightedHpAt(gen, champions, { hp: unseen ? 100 : mon.hp, maxhp: scale }, maxhp) : null;
}

// Protocol snapshots carry HP in percent (maxhp 100, 0 if never revealed); the real max HP comes from the guessed set.
function absoluteHp(
  mon: PokemonSnapshot,
  set: PokemonSet | undefined,
  gen: number,
  champions = false,
): { hp: number; maxhp: number; hpPercent: number } {
  const hpPercent = mon.maxhp === 0 && !mon.fainted ? 100 : mon.hpPercent;
  try {
    const calcGen = calcGenerationFor(gen, champions ? CHAMPIONS_MOD : undefined);
    const poke = buildCalcPokemon(calcGen, mon.speciesForme, {
      level: mon.level || set?.level || 100,
      nature: set?.nature || undefined,
      evs: set?.evs,
      ivs: set?.ivs,
    });
    const maxhp = poke.maxHP();
    const hp = mon.fainted ? 0 : Math.max(1, sightedAbsoluteHp(mon, gen, champions, maxhp) ?? Math.round(maxhp * hpPercent / 100));
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
  sideFainted: number,
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
    moves: moveNamesFor(mon, set).map(name => ({ name, type: moveTypeFor(name, gen, champions) })),
    ability: mon.ability || set?.ability || '',
    item: mon.item || set?.item || '',
    stats: { atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
    nature: set?.nature || undefined,
    evs: set?.evs,
    ivs: set?.ivs,
    boosts: { ...mon.boosts },
    level: mon.level || set?.level || 100,
    types: speciesTypesFor(mon.speciesForme, gen, champions),
    teraType: mon.terastallized || '',
    ...snapshotSimFacts(mon, set, gameRules(gen, champions), sideFainted),
    ...championsMark(champions),
  };
}

/** A snapshot clears the Tera type of a body that fainted, and the simulator never gives the side its Tera back. */
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

// sim pokemon.js transformInto names these (no Dex flag); picker-state.spec.ts holds this mirror against a live battle.
const NO_TERA_TRANSFORMED_INTO: ReadonlySet<string> = new Set(['Ogerpon', 'Terapagos']);

// The simulator's canTerastallize (pokemon.js) on the snapshot's facts: none outside gen 9, after a teammate's Tera,
// under Terastal Clause, with a Z crystal or Mega Stone, or after a transformation into Ogerpon or Terapagos.
function snapshotTeraType(mon: PokemonSnapshot, set: PokemonSet | undefined, gen: number, sideMayTera: boolean, champions: boolean): string | null {
  if (!sideMayTera || gen !== 9) return null;
  const dex = dexFor(gen, champions);
  const species = dex.species.get(set?.species || mon.speciesForme);
  if (transformedWithoutTera(dex, mon, species) || holdsOtherGimmick(dex, set?.item || mon.item, species)) return null;
  return set?.teraType || species.types[0] || null;
}

type GenDex = RulesDex;
type GenSpecies = ReturnType<GenDex['species']['get']>;

function transformedWithoutTera(dex: GenDex, mon: PokemonSnapshot, species: GenSpecies): boolean {
  const shown = dex.species.get(mon.speciesForme);
  return shown.baseSpecies !== species.baseSpecies && NO_TERA_TRANSFORMED_INTO.has(shown.baseSpecies);
}

function holdsOtherGimmick(dex: GenDex, itemName: string, species: GenSpecies): boolean {
  const item = dex.items.get(itemName);
  if (!item.exists) return false;
  const stone = item.megaStone;
  return !!item.zMove || !!(stone && (stone[species.name] || stone[species.baseSpecies]));
}

interface SnapshotSideOptions {
  movesBySlot: BranchMoveOption[][];
  switchesBySlot: BranchSwitchOption[][];
  activeSlots: (SimPokemonInfo | null)[];
  infos: SimPokemonInfo[];
  modifiersBySlot: BranchSlotModifiers[];
}

function snapshotSideOptions(
  snapshot: TurnSnapshot, side: 'p1' | 'p2', team: PokemonSet[], gen: number,
  bringOnly: { p1: string[]; p2: string[] } | null | undefined, teraAllowed: boolean, champions = false,
): SnapshotSideOptions {
  const rules: GameRules = { gen, mod: champions ? CHAMPIONS_MOD : undefined };
  const pokemon = snapshot[side].pokemon;
  const actives = fieldRow(pokemon);
  const setFor = (mon: PokemonSnapshot) =>
    team.find(set => set.species === mon.speciesForme || set.name === mon.name);
  const benchPercent = (mon: PokemonSnapshot) =>
    (mon.maxhp === 0 && !mon.fainted ? 100 : mon.hpPercent);
  const broughtBases = (bringOnly?.[side] ?? []).map(name => speciesBaseId(name, rules));
  const inBring = (mon: PokemonSnapshot) =>
    broughtBases.length === 0 || broughtBases.includes(speciesBaseId(mon.speciesForme, rules));
  const fainted = pokemon.filter(mon => mon.fainted).length;
  const sideMayTera = teraAllowed && !pokemon.some(mon => mon.terastallized);
  const activeSlots = actives.map((mon, index) => (mon ? pokemonInfoFromSnapshot(mon, setFor(mon), index, gen, champions, fainted) : null));
  const field = { weather: snapshot.field.weather || '', terrain: snapshot.field.terrain || '' };
  const movesBySlot = actives.map((mon, index) => (mon ? moveOptionsFor(
    mon, setFor(mon), index, gen, champions, { info: activeSlots[index]!, type: snapshotTeraType(mon, setFor(mon), gen, sideMayTera, champions) }, field,
  ) : []));
  const switchesBySlot = actives.map((mon, activeSlot): BranchSwitchOption[] => !mon ? [] :
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
  const infos = pokemon.map(mon =>
    pokemonInfoFromSnapshot(mon, setFor(mon), mon.isActive ? actives.indexOf(mon) : null, gen, champions, fainted));
  const modifiersBySlot = actives.map((mon, index) => ({
    teraType: mon ? snapshotTeraType(mon, setFor(mon), gen, sideMayTera, champions) : null,
    canMegaEvo: false,
    canUltraBurst: false,
    zMoves: (movesBySlot[index] ?? []).map(() => null),
  }));
  return { movesBySlot, switchesBySlot, activeSlots, infos, modifiersBySlot };
}

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
  /** Bring-limited replays: bench options list only the brought species (by base species); null: unfiltered. */
  bringOnly?: { p1: string[]; p2: string[] } | null,
  rules: { format?: string; teraUsed?: { p1: boolean; p2: boolean } } = {},
): BranchSimState {
  const teraAllowed = !teraBanned(rules.format);
  const champions = evBudget(rules.format ?? '').statPoints;
  const p1 = snapshotSideOptions(snapshot, 'p1', p1Team, gen, bringOnly, teraAllowed && !rules.teraUsed?.p1, champions);
  const p2 = snapshotSideOptions(snapshot, 'p2', p2Team, gen, bringOnly, teraAllowed && !rules.teraUsed?.p2, champions);
  return snapshotPickerState(snapshot, p1, p2);
}
