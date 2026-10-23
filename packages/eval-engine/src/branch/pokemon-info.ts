import { dexOf, type GameRules } from '@fulllifegames/replay-core';
import { bodyFromInfo, simBodyFacts } from '../calc/body.ts';
import { teraClicked } from '../calc/tera-click.ts';
import { twinBattle, twinFormat } from '../sim-ask/index.ts';
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

/** Display names, not sim ids: @smogon/calc matches abilities/items by
 *  display name ('Technician'), so ids ('technician') silently disable
 *  every ability/item damage modifier (B6). */
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
    // What the calc cannot see on its own, read as the engine's one builder reads it (round 67, T76).
    ...simBodyFacts(pokemon),
    ...(pokemon.battle.dex.currentMod === 'champions' ? { mod: 'champions' } : {}),
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


/** What a replay shows of a body's HP: the numerator and the scale of the log's `hp/maxhp` (100 for percent, 48 for pixels). */
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

/**
 * The HP a replay's percent stands for (round 69, T161): the middle of the HPs at which the simulator's own
 * display (getHealth) shows that value. Gen 7 and later round the percent up, Champions down, and the old
 * `round(percent * maxhp / 100)` left that range in both. The display runs in the replay's mode, whatever the
 * body's battle was built with (a custom game reports exact HP, a Gen 6 battle without the rule shows pixels):
 * percent for a sighting on the 100 scale, pixels otherwise. null where no HP shows the value (a scale the
 * body's generation does not use, an exact sighting, 0 HP); the body keeps its HP and its modes.
 */
export function sightedHp(body: HpDisplayBody, shown: HpSighting): number | null {
  if (shown.hp <= 0 || shown.hp > shown.maxhp || body.maxhp <= 0) return null;
  const { battle } = body;
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

/**
 * The HP of a body for a snapshot's sighting: sightedHp when the replay showed percent or pixels, else (an exact
 * HP, or a display the body's generation does not have) the old proportional rounding.
 */
export function hpOfSighting(body: HpDisplayBody, sighting: { hp: number; maxhp: number; hpPercent: number }): number {
  const sighted = sighting.maxhp === 100 || sighting.maxhp === 48 ? sightedHp(body, sighting) : null;
  return sighted ?? Math.round((sighting.hpPercent / 100) * body.maxhp);
}

/**
 * The percent a player sees for a body (round 74, step R): the numerator of the simulator's own display (getHealth)
 * on the 100 scale, which is what the replay's log shows. Gen 7 and later round it up (never 100 below full HP),
 * Champions round it down; `Math.round(hp / maxhp * 100)` reads one point under the log for a body the rebuild
 * sets to the middle of a run of HPs (T161). The display runs in percent mode whatever the body's battle was built
 * with (a custom game reports exact HP, a Gen 6 battle without the rule shows pixels); 0 for a faint. The body keeps
 * its modes.
 */
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

/** The probe body per generation and rule set; null remembers a generation no candidate species fits. */
const probeBodies = new Map<string, HpDisplayBody | null>();
const PROBE_SPECIES = ['Mew', 'Pikachu', 'Garchomp'];

/**
 * A body of the format's simulator to read the HP display from, when no battle stands at hand (the quick picker
 * on a snapshot): one Pokémon per side in a custom game of the generation, or the Champions OU format of the mod.
 * null where the battle cannot be built: the Champions mod is not loaded yet, or a generation without the species.
 *
 * Round 70 (T215): before the mod registers, the Champions format id is unknown to the simulator, which then builds
 * the battle on the base rules without an error. That body shows the wrong display (the base rounds a percent up,
 * the mod down), so no battle is built and nothing is kept: the next build asks again once the mod is there. A
 * generation that no candidate fits is remembered, so it is not rebuilt for every body and render.
 */
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

/** sightedHp for a body that exists only as numbers: the format's probe body at the given maximum HP, null where there is none. */
export function sightedHpAt(gen: number, champions: boolean, sighting: HpSighting, maxhp: number): number | null {
  const body = probeBody(gen, champions);
  if (!body) return null;
  body.maxhp = maxhp;
  return sightedHp(body, sighting);
}

/**
 * Hidden Power's type and power for a set, as the simulator's Pokemon constructor gives them (round 69, T158): the
 * set's own hpType, else the type of the first typed Hidden Power move in its list, else the Dex's reading of the
 * IVs (the Dex gives the power too: 60 from Gen 6 on, IV-derived before; Gen 1 and 2 read the even DVs). Round 75 (T160): the
 * Dex is the game's own, by generation and mod.
 */
export function hiddenPowerFacts(rules: GameRules, set: { moves?: readonly string[]; ivs?: Partial<PokemonStatTable>; hpType?: string }): { hpType: string; hpPower: number } {
  const dex = dexOf(rules);
  const { gen } = rules;
  const ivs = Object.fromEntries((Object.keys(DEFAULT_IVS) as (keyof PokemonStatTable)[]).map(stat => {
    const iv = Math.min(31, Math.max(0, Math.trunc(set.ivs?.[stat] ?? DEFAULT_IVS[stat])));
    return [stat, gen <= 2 ? iv & 30 : iv];
  })) as unknown as PokemonStatTable;
  const typed = set.hpType || (set.moves ?? []).map(name => dex.moves.get(name)).find(move => move.id === 'hiddenpower' && move.type !== 'Normal')?.type;
  const read = dex.getHiddenPower(ivs);
  return { hpType: typed || read.type, hpPower: read.power };
}

/** What the calc reads off the simulator's body, from a snapshot (round 69, T158): the volatile facts the client kept, the side's fallen, Hidden Power of the set (or of the moves shown). */
export function snapshotSimFacts(
  mon: { boostedStat?: string; fallen?: number; moves?: readonly string[] }, set: { moves?: readonly string[]; ivs?: Partial<PokemonStatTable>; hpType?: string } | undefined, rules: GameRules, sideFainted: number,
): Pick<SimPokemonInfo, 'boostedStat' | 'alliesFainted' | 'totalFainted' | 'hpType' | 'hpPower'> {
  return {
    ...(mon.boostedStat ? { boostedStat: mon.boostedStat } : {}),
    ...(mon.fallen ? { alliesFainted: mon.fallen } : {}),
    ...(sideFainted ? { totalFainted: sideFainted } : {}),
    // A body without a set reads as the simulator reads one without IVs of its own: 31 everywhere, the moves the log showed.
    ...hiddenPowerFacts(rules, set ?? { moves: mon.moves }),
  };
}

/**
 * The species a quick-picker body has after its Tera click (round 69, T158): the simulator's own terastallize on a
 * twin of the body (Terapagos-Terastal turns into Terapagos-Stellar, an Ogerpon into its Tera forme), the species
 * itself for a click that keeps the forme.
 */
export function speciesAfterTeraClick(gen: number, info: SimPokemonInfo, teraType: string): string {
  return teraClicked(gen, { ...bodyFromInfo(info), tera: teraType }).species;
}
