import { dexOf, type GameRules } from '@fulllifegames/replay-core';
import { bodyFromInfo, simBodyFacts } from '../calc/body.ts';
import { teraClicked } from '../calc/tera-click.ts';
import { twinBattle, twinFormat } from '../sim-ask/index.ts';
import { isCommanding } from '../forward/request-moves.ts';
import type { PokemonStatTable, SimPokemon, SimPokemonInfo, SimSide } from './types.ts';

function statTableWithDefaults(
  value: Partial<PokemonStatTable> | undefined,
  fallback: PokemonStatTable,
): PokemonStatTable {
  return {
    hp: value?.hp ?? fallback.hp,
    atk: value?.atk ?? fallback.atk,
    def: value?.def ?? fallback.def,
    spa: value?.spa ?? fallback.spa,
    spd: value?.spd ?? fallback.spd,
    spe: value?.spe ?? fallback.spe,
  };
}

const DEFAULT_EVS: PokemonStatTable = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
const DEFAULT_IVS: PokemonStatTable = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };

// @smogon/calc matches abilities and items by display name ('Technician'); an id silently disables every modifier.
function displayFields(pokemon: SimPokemon): Pick<SimPokemonInfo, 'ability' | 'item' | 'moves'> {
  const { dex } = pokemon.battle;
  return {
    moves: pokemon.moveSlots.map(move => ({
      name: move.move,
      type: dex.moves.get(move.id || move.move)?.type || '',
    })),
    ability: pokemon.ability ? (dex.abilities.get(pokemon.ability)?.name || pokemon.ability) : '',
    item: pokemon.item ? (dex.items.get(pokemon.item)?.name || pokemon.item) : '',
  };
}

function storedStats(pokemon: SimPokemon): SimPokemonInfo['stats'] {
  return {
    atk: pokemon.storedStats?.atk || 0,
    def: pokemon.storedStats?.def || 0,
    spa: pokemon.storedStats?.spa || 0,
    spd: pokemon.storedStats?.spd || 0,
    spe: pokemon.storedStats?.spe || 0,
  };
}

function setFields(pokemon: SimPokemon): Pick<SimPokemonInfo, 'nature' | 'evs' | 'ivs' | 'gender' | 'teraType' | 'level' | 'types'> {
  return {
    nature: pokemon.set.nature || 'Hardy',
    evs: statTableWithDefaults(pokemon.set.evs, DEFAULT_EVS),
    ivs: statTableWithDefaults(pokemon.set.ivs, DEFAULT_IVS),
    gender: pokemon.gender || pokemon.set.gender || '',
    teraType: pokemon.terastallized || '',
    level: pokemon.level || 100,
    types: pokemon.types ? [...pokemon.types] : [],
  };
}

export function makePokemonInfo(
  pokemon: SimPokemon,
  isActive = pokemon.isActive,
  activeSlot: number | null = null,
): SimPokemonInfo {
  const { moves, ability, item } = displayFields(pokemon);
  const { nature, evs, ivs, gender, teraType, level, types } = setFields(pokemon);
  return {
    name: pokemon.name,
    species: pokemon.species.name,
    hp: pokemon.hp,
    maxhp: pokemon.maxhp,
    hpPercent: shownPercent(pokemon),
    status: pokemon.status || '',
    fainted: pokemon.fainted,
    isActive,
    activeSlot,
    moves,
    ability,
    item,
    stats: storedStats(pokemon),
    nature,
    evs,
    ivs,
    gender,
    teraType,
    stellarBoostedTypes: [...pokemon.stellarBoostedTypes],
    ...simBodyFacts(pokemon),
    ...(pokemon.battle.dex.currentMod === 'champions' ? { mod: 'champions' } : {}),
    ...(isCommanding(pokemon) ? { commanding: true } : {}),
    boosts: { ...pokemon.boosts },
    level,
    types,
  };
}

export function extractPokemonInfo(side: SimSide): SimPokemonInfo[] {
  return side.pokemon.map(pokemon => {
    const activeSlot = side.active.findIndex(active => active === pokemon);
    return makePokemonInfo(pokemon, pokemon.isActive, activeSlot >= 0 ? activeSlot : null);
  });
}

/** What a replay shows of a body's HP: the numerator and scale of the log's `hp/maxhp` (100 percent, 48 pixels). */
export interface HpSighting {
  hp: number;
  maxhp: number;
}

/** The part of a simulator body its HP display reads: getHealth is a closure over the body's own hp and maxhp. */
export interface HpDisplayBody {
  hp: number;
  maxhp: number;
  getHealth: () => { shared: string };
  battle: { reportPercentages: boolean; reportExactHP: boolean };
}

/** The HP a replay's percent stands for: the middle of the HPs whose display shows that value; null where none does. */
export function sightedHp(body: HpDisplayBody, shown: HpSighting): number | null {
  if (shown.hp <= 0 || shown.hp > shown.maxhp || body.maxhp <= 0) return null;
  const { battle } = body;
  // Gen 7 and later round the percent up, Champions down, so `round(percent * maxhp / 100)` can leave the range.
  const saved = { hp: body.hp, percentages: battle.reportPercentages, exact: battle.reportExactHP };
  battle.reportExactHP = false;
  battle.reportPercentages = shown.maxhp === 100;
  const showing = (hp: number): number => {
    body.hp = hp;
    const read = /^(\d+)\/(\d+)/.exec(body.getHealth().shared);
    return read && Number(read[2]) === shown.maxhp ? Number(read[1]) : -1;
  };
  try {
    if (showing(body.maxhp) < 0) return null;
    // The display never falls as the HP rises, so the HPs that show a value are one run: search its two ends.
    let first = 1;
    let end = body.maxhp;
    while (first < end) {
      const middle = (first + end) >> 1;
      if (showing(middle) >= shown.hp) end = middle; else first = middle + 1;
    }
    if (showing(first) !== shown.hp) return null;
    let last = first;
    end = body.maxhp;
    while (last < end) {
      const middle = (last + end + 1) >> 1;
      if (showing(middle) <= shown.hp) last = middle; else end = middle - 1;
    }
    return (first + last) >> 1;
  } finally {
    body.hp = saved.hp;
    battle.reportPercentages = saved.percentages;
    battle.reportExactHP = saved.exact;
  }
}

export function hpOfSighting(body: HpDisplayBody, sighting: { hp: number; maxhp: number; hpPercent: number }): number {
  const sighted = sighting.maxhp === 100 || sighting.maxhp === 48 ? sightedHp(body, sighting) : null;
  return sighted ?? Math.round((sighting.hpPercent / 100) * body.maxhp);
}

// Gen 7 and later round up (never 100 below full HP), Champions down: `Math.round(hp / maxhp * 100)` reads a point low.
export function shownPercent(body: HpDisplayBody): number {
  if (!(body.maxhp > 0) || !(body.hp > 0)) return 0;
  const { battle } = body;
  const saved = { percentages: battle.reportPercentages, exact: battle.reportExactHP };
  battle.reportExactHP = false;
  battle.reportPercentages = true;
  try {
    const read = /^(\d+)\/100/.exec(body.getHealth().shared);
    return read ? Number(read[1]) : 0;
  } finally {
    battle.reportPercentages = saved.percentages;
    battle.reportExactHP = saved.exact;
  }
}

const probeBodies = new Map<string, HpDisplayBody | null>();
const PROBE_SPECIES = ['Mew', 'Pikachu', 'Garchomp'];

// Before the mod registers the sim builds Champions on base rules (rounds up, not down): `twinFormat` gives null then.
function probeBody(gen: number, champions: boolean): HpDisplayBody | null {
  const format = twinFormat(gen, champions);
  if (!format) return null;
  const key = `${gen}|${champions}`;
  const known = probeBodies.get(key);
  if (known !== undefined) return known;
  for (const species of PROBE_SPECIES) {
    const team = [{
      name: species, species, item: '', ability: 'No Ability', moves: ['splash'], nature: 'Hardy', level: 50, gender: '',
      evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
    }];
    try {
      const battle = twinBattle(format, { p1: { name: 'Probe', team }, p2: { name: 'Foe', team } }, { preview: false });
      const body = battle.sides[0].pokemon[0] as unknown as HpDisplayBody;
      probeBodies.set(key, body);
      return body;
    } catch {
      // The species is not in this generation; the next candidate.
    }
  }
  probeBodies.set(key, null);
  return null;
}

/** `sightedHp` for a body that exists only as numbers: the format's probe body at `maxhp`; null without one. */
export function sightedHpAt(gen: number, champions: boolean, sighting: HpSighting, maxhp: number): number | null {
  const body = probeBody(gen, champions);
  if (!body) return null;
  body.maxhp = maxhp;
  return sightedHp(body, sighting);
}

/** Hidden Power's type and power as the simulator's constructor gives them: hpType, else a typed move, else the IVs. */
export function hiddenPowerFacts(rules: GameRules, set: { moves?: readonly string[]; ivs?: Partial<PokemonStatTable>; hpType?: string }): { hpType: string; hpPower: number } {
  const dex = dexOf(rules);
  const { gen } = rules;
  // The Dex gives the power too: 60 from Gen 6 on, IV-derived before; Gen 1 and 2 read the even DVs.
  const ivs = Object.fromEntries((Object.keys(DEFAULT_IVS) as (keyof PokemonStatTable)[]).map(stat => {
    const iv = Math.min(31, Math.max(0, Math.trunc(set.ivs?.[stat] ?? DEFAULT_IVS[stat])));
    return [stat, gen <= 2 ? iv & 30 : iv];
  })) as unknown as PokemonStatTable;
  const typed = set.hpType || (set.moves ?? []).map(name => dex.moves.get(name)).find(move => move.id === 'hiddenpower' && move.type !== 'Normal')?.type;
  const read = dex.getHiddenPower(ivs);
  return { hpType: typed || read.type, hpPower: read.power };
}

/** The simulator facts the calc reads, from a snapshot: client volatiles, the side's fallen, Hidden Power. */
export function snapshotSimFacts(
  mon: { boostedStat?: string; fallen?: number; moves?: readonly string[] }, set: { moves?: readonly string[]; ivs?: Partial<PokemonStatTable>; hpType?: string } | undefined, rules: GameRules, sideFainted: number,
): Pick<SimPokemonInfo, 'boostedStat' | 'alliesFainted' | 'totalFainted' | 'hpType' | 'hpPower'> {
  return {
    ...(mon.boostedStat ? { boostedStat: mon.boostedStat } : {}),
    ...(mon.fallen ? { alliesFainted: mon.fallen } : {}),
    ...(sideFainted ? { totalFainted: sideFainted } : {}),
    // A body without a set reads as the simulator reads one without IVs: 31 everywhere, the moves the log showed.
    ...hiddenPowerFacts(rules, set ?? { moves: mon.moves }),
  };
}

/** The species after a Tera click, from the simulator's terastallize on a twin (Terapagos-Terastal to -Stellar). */
export function speciesAfterTeraClick(gen: number, info: SimPokemonInfo, teraType: string): string {
  return teraClicked(gen, { ...bodyFromInfo(info), tera: teraType }).species;
}
