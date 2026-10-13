import { Battle, Teams, toID } from '@pkmn/sim';
import type { ID, PokemonSet } from '@pkmn/sim';
import { simModsReady } from '../forward/sim-mods.ts';
import { terrainIdFromSnapshot, weatherIdFromSnapshot } from './field-ids.ts';
import { typeAtUse, typesUnderTera } from './state.ts';
import type { PokemonStatTable, SimBattle, SimPokemon } from './types.ts';

/**
 * The quick picker's move types, from the simulator (round 70, T215). The picker builds its buttons from a replay
 * snapshot and the guessed teams, with no battle at hand, so it used to keep the catalog type for every move whose
 * type the simulator changes at use: Weather Ball and Terrain Pulse need the field, the -ate family, Liquid Voice and
 * Normalize need the ability. The snapshot holds the field and the guessed set names the ability, so the picker now
 * asks the simulator the way the live picker does (branch/state.ts typeAtUse, and typesUnderTera for the Tera click):
 * a throwaway battle of the body, the field set as the snapshot shows it, the move's own rule and then everyone's run
 * by the simulator. No move or ability name is read here.
 */

/** What the type a move lands with depends on, for a body read off a snapshot. */
export interface SnapshotTypeBody {
  species: string;
  item?: string;
  level?: number;
  gender?: string;
  ivs?: Partial<PokemonStatTable>;
  /** The set's own Hidden Power type ('' or absent: the typed move and the IVs decide). */
  hpType?: string;
  /** The Tera type the body has already terastallized into ('' or absent: not terastallized). */
  teraType?: string;
}

export interface SnapshotTypeQuery {
  gen: number;
  /** A Pokémon Champions game: the mod's battle, which exists once the mod is loaded. */
  champions: boolean;
  body: SnapshotTypeBody;
  /** The abilities the body may have: the revealed one, else the guessed set's, else the species'; empty where the generation has none. */
  abilities: readonly string[];
  /** The snapshot's field by the client's display names ("Sun", "Electric"); empty strings for none. */
  field: { weather: string; terrain: string };
  /** The Tera type the picker's toggle clicks; null where the picker offers no Tera. */
  clickTera: string | null;
  /** The move names the picker lists. */
  moves: readonly string[];
}

/** The type a move lands with and, when the Tera click changes it, the type after the click. */
export interface SnapshotMoveType {
  type: string;
  typeUnderTera?: string;
}

const NO_EVS: PokemonStatTable = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
const ALL_31: PokemonStatTable = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };

/** The most answers kept; a replay holds a dozen bodies, so the bound only guards a long session of many replays. */
const MEMO_LIMIT = 500;
const memo = new Map<string, ReadonlyMap<string, SnapshotMoveType> | null>();

function remember(key: string, answer: ReadonlyMap<string, SnapshotMoveType> | null): void {
  if (memo.size >= MEMO_LIMIT) memo.clear();
  memo.set(key, answer);
}

/** The weather and the terrain the snapshot shows, set on the twin; what the twin's own switch-in ability started goes. */
function setField(battle: Battle, field: SnapshotTypeQuery['field']): void {
  const weather = weatherIdFromSnapshot(field.weather);
  const terrain = terrainIdFromSnapshot(field.terrain);
  if (weather && battle.dex.conditions.get(weather).exists) battle.field.setWeather(weather, 'debug');
  else battle.field.clearWeather();
  if (terrain && battle.dex.conditions.get(terrain).exists) battle.field.setTerrain(terrain, 'debug');
  else battle.field.clearTerrain();
}

function setOf(query: SnapshotTypeQuery, ability: string): PokemonSet {
  const { body } = query;
  const tera = body.teraType || query.clickTera;
  return {
    name: body.species, species: body.species, item: body.item ?? '', ability: ability || 'No Ability', moves: [...query.moves],
    nature: 'Hardy', evs: NO_EVS, ivs: { ...ALL_31, ...body.ivs }, level: body.level ?? 100, gender: body.gender ?? '',
    ...(body.hpType ? { hpType: body.hpType } : {}),
    ...(tera ? { teraType: tera } : {}),
  };
}

/** The foe of the twin: the body's own species (it exists in the generation and the mod), with no ability and no item. */
function foeOf(species: string): PokemonSet {
  return {
    name: 'Foe', species, item: '', ability: 'No Ability', moves: ['splash'], nature: 'Hardy', evs: NO_EVS, ivs: ALL_31, level: 100, gender: '',
  };
}

/** The twin battle of the body with one ability, or throws where the simulator cannot build it. */
function twinOf(format: ID, query: SnapshotTypeQuery, ability: string): Battle {
  const battle = new Battle({
    formatid: format, seed: '1,2,3,4',
    p1: { name: 'Body', team: Teams.pack([setOf(query, ability)]) }, p2: { name: 'Foe', team: Teams.pack([foeOf(query.body.species)]) },
  });
  if (battle.sides.some(side => side.requestState === 'teampreview')) {
    battle.choose('p1', 'team 1');
    battle.choose('p2', 'team 1');
  }
  setField(battle, query.field);
  // A body that terastallized before the snapshot has its Tera type now; the labels below are for the click still to come.
  if (query.body.teraType) battle.actions.terastallize(battle.sides[0].active[0]);
  return battle;
}

/** What the simulator says for the twin with one ability; null where the twin cannot be built. */
function readTwin(format: ID, query: SnapshotTypeQuery, ability: string): ReadonlyMap<string, SnapshotMoveType> | null {
  try {
    const battle = twinOf(format, query, ability);
    const active = battle.sides[0].active[0];
    const sim = battle as unknown as SimBattle;
    const body = active as unknown as SimPokemon;
    const named = query.moves.map(name => ({ name, move: battle.dex.moves.get(name) })).filter(entry => entry.move.exists);
    const clicked = query.clickTera && !query.body.teraType ? typesUnderTera(sim, body, named.map(entry => entry.move.id)) : new Map<string, string>();
    const answers = new Map<string, SnapshotMoveType>();
    for (const { name, move } of named) {
      const type = typeAtUse(sim, body, move.id);
      const after = clicked.get(move.id);
      answers.set(name, { type, ...(after && after !== type ? { typeUnderTera: after } : {}) });
    }
    return answers;
  } catch {
    return null;
  }
}

/** One twin per (body, ability, field, click, moves), remembered; a failure is remembered too once the mod it needs is loaded. */
function readOne(query: SnapshotTypeQuery, ability: string): ReadonlyMap<string, SnapshotMoveType> | null {
  const format = toID(query.champions ? 'gen9championsou' : `gen${query.gen}customgame`);
  // The Champions mod loads on demand: before it is there no battle can come up, and the next build asks again.
  if (!simModsReady(format)) return null;
  const { body } = query;
  // The key holds only what the twin is built from: a caller may hand over a whole info, whose HP and stages change every turn.
  const key = JSON.stringify([
    format, body.species, body.item ?? '', body.level ?? 100, body.gender ?? '', body.ivs ?? null, body.hpType ?? '', body.teraType ?? '',
    ability, query.field, query.clickTera, query.moves,
  ]);
  const known = memo.get(key);
  if (known !== undefined) return known;
  const answer = readTwin(format, query, ability);
  remember(key, answer);
  return answer;
}

const same = (a: SnapshotMoveType | undefined, b: SnapshotMoveType | undefined): boolean =>
  !!a && !!b && a.type === b.type && a.typeUnderTera === b.typeUnderTera;

/**
 * The type each listed move lands with for the snapshot body, as the simulator reads it (null where no twin can be
 * built: the Champions mod is not loaded, the generation lacks the species). Every candidate ability gets its own
 * twin; a move whose candidates disagree is left out, and so is a move the Dex does not know, so the caller keeps its
 * catalog type there. The Tera label is set only where the click changes the type.
 */
export function snapshotMoveTypes(query: SnapshotTypeQuery): ReadonlyMap<string, SnapshotMoveType> | null {
  const reads = (query.abilities.length > 0 ? query.abilities : ['']).map(ability => readOne(query, ability));
  if (reads.some(read => read === null)) return null;
  const [first, ...others] = reads as ReadonlyMap<string, SnapshotMoveType>[];
  const agreed = new Map<string, SnapshotMoveType>();
  for (const [name, answer] of first) {
    if (others.every(other => same(other.get(name), answer))) agreed.set(name, answer);
  }
  return agreed;
}
