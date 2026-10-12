import { Battle, Dex, Teams, toID } from '@pkmn/sim';
import { simBodyFacts } from '../calc/body.ts';
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
  return {
    moves: pokemon.moveSlots.map(move => ({
      name: move.move,
      type: Dex.moves.get(move.id || move.move)?.type || '',
    })),
    ability: pokemon.ability ? (Dex.abilities.get(pokemon.ability)?.name || pokemon.ability) : '',
    item: pokemon.item ? (Dex.items.get(pokemon.item)?.name || pokemon.item) : '',
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
    hpPercent: pokemon.maxhp > 0 ? Math.round(pokemon.hp / pokemon.maxhp * 100) : 0,
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

const probeBodies = new Map<string, HpDisplayBody>();
const PROBE_SPECIES = ['Mew', 'Pikachu', 'Garchomp'];

/**
 * A body of the format's simulator to read the HP display from, when no battle stands at hand (the quick picker
 * on a snapshot): one Pokémon per side in a custom game of the generation, or the Champions OU format of the mod.
 * null where the battle cannot be built (the Champions mod is not loaded yet, a generation without the species).
 */
function probeBody(gen: number, champions: boolean): HpDisplayBody | null {
  const key = `${gen}|${champions}`;
  const known = probeBodies.get(key);
  if (known) return known;
  for (const species of PROBE_SPECIES) {
    const team = Teams.pack([{
      name: species, species, item: '', ability: 'No Ability', moves: ['splash'], nature: 'Hardy', level: 50, gender: '',
      evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
    }]);
    try {
      const battle = new Battle({ formatid: toID(champions ? 'gen9championsou' : `gen${gen}customgame`), seed: '1,2,3,4', p1: { name: 'Probe', team }, p2: { name: 'Foe', team } });
      const body = battle.sides[0].pokemon[0] as unknown as HpDisplayBody;
      probeBodies.set(key, body);
      return body;
    } catch {
      // The species is not in this generation; the next candidate.
    }
  }
  return null;
}

/** sightedHp for a body that exists only as numbers: the format's probe body at the given maximum HP, null where there is none. */
export function sightedHpAt(gen: number, champions: boolean, sighting: HpSighting, maxhp: number): number | null {
  const body = probeBody(gen, champions);
  if (!body) return null;
  body.maxhp = maxhp;
  return sightedHp(body, sighting);
}
