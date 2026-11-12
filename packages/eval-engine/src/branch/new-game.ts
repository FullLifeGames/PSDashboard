import { TeamValidator, Teams } from '@pkmn/sim';
import type { PokemonSet } from '@pkmn/sim';
import { dexOfFormat, simFormats, toId } from '@fulllifegames/replay-core';
import { loadSimMods } from '../forward/sim-mods.ts';
import { DEFAULT_GAME_SEED, openStreams, type SessionStreams } from './runtime-session.ts';
import type { SimBattle } from './types.ts';
import { sleep } from './execute.ts';

/**
 * Round 89 (lane H, #105): a new game starts from two teams the user pastes, in the format he picks. This module asks the
 * simulator two things and decides nothing: what the chosen format's own battle looks like when it starts (the header log up
 * to the first turn, the level and values each body gets, whether the format has a team preview), and which problems the
 * simulator's own team validation reports for each team. Whether Start is allowed with problems is the interface's ruling.
 * Every rule comes from the simulator and its Dex: no format, species or move is named here.
 */

/** The seed a game starts on when the caller names none: the one every reconstruction of the replay path uses (`startBattle`). */
export { DEFAULT_GAME_SEED };

/** One body as the chosen format's battle builds it. */
export interface NewGameBody {
  /** The species' name, as the battle prints it. */
  species: string;
  name: string;
  level: number;
  ability: string;
  item: string;
  maxHp: number;
  /** The stored stats, HP excluded. */
  stats: { atk: number; def: number; spa: number; spd: number; spe: number };
}

export interface NewGameStart {
  /** The chosen format's id. */
  format: string;
  /** The simulator's game type of the format: singles, doubles (or triples, which the app does not offer). */
  gameType: string;
  /** The format has a team preview (Gen 1 to 4 have none: the leads come from the teams then). */
  teamPreview: boolean;
  /** The bodies each side brings after a team preview (VGC: 4); null when the whole team plays or there is no preview. */
  bringCount: number | null;
  /** The Pokémon each side fields at once. */
  activeCount: number;
  /** The log up to the start of the game (no `|start|`, no `|t:|` lines, which carry the clock): a pure function of the start. */
  header: string[];
  /** The teams as the format's battle reads them: each set with the level the format gives its body. */
  teams: { p1: PokemonSet[]; p2: PokemonSet[] };
  bodies: { p1: NewGameBody[]; p2: NewGameBody[] };
}

export interface StartGameParams {
  format: string;
  p1Team: PokemonSet[];
  p2Team: PokemonSet[];
  playerNames?: [string, string];
  seed?: string;
}

/** The team validator's problems, per side. */
export interface GameTeamProblems {
  p1: string[];
  p2: string[];
}

/**
 * The level the format gives a set: the simulator's team validator reads `Adjust Level` and `Adjust Level Down` off the rule table and
 * rewrites the set's level before a server battle starts (`validateSet` of team-validator.js; the battle itself plays whatever level
 * it gets, so a replay's level 50 comes from the server and a pasted team needs it here). A spec holds this to the validator over
 * every format.
 */
function levelOfSet(rules: ReturnType<ReturnType<typeof simFormats>['getRuleTable']>, set: PokemonSet): number {
  let level = set.level || rules.defaultLevel;
  let adjust = rules.adjustLevel;
  if (rules.adjustLevelDown && level >= rules.adjustLevelDown) adjust = rules.adjustLevelDown;
  if (level === adjust || (level === 100 && rules.maxLevel < 100)) level = rules.maxLevel;
  return adjust || level;
}

/**
 * Starts the chosen format's battle on the omniscient stream, the one a game's log is written from, and reads its header (the
 * lines before `|start|`) and bodies. The Champions mod loads here, in whatever realm the caller runs. A battle that does not
 * come up (a species the Dex does not know) throws: `checkGameTeams` names such a team before Start.
 */
export async function startGameLog(params: StartGameParams): Promise<NewGameStart> {
  const { format: formatId } = params;
  await loadSimMods(formatId);
  const format = simFormats().get(formatId);
  if (!format.exists) throw new Error(`Unknown format ${formatId}`);
  const rules = simFormats().getRuleTable(format);
  const leveled = (team: PokemonSet[]): PokemonSet[] => team.map(set => ({ ...set, level: levelOfSet(rules, set) }));
  const p1Team = leveled(params.p1Team);
  const p2Team = leveled(params.p2Team);
  const streams = openStreams();
  const names = params.playerNames ?? ['Player 1', 'Player 2'];
  const name = (index: 0 | 1) => JSON.stringify(names[index].trim() || `Player ${index + 1}`);
  streams.writeSim(
    `>start ${JSON.stringify({ formatid: formatId, seed: params.seed ?? DEFAULT_GAME_SEED })}\n` +
    `>player p1 {"name":${name(0)},"team":${JSON.stringify(Teams.pack(p1Team))}}\n` +
    `>player p2 {"name":${name(1)},"team":${JSON.stringify(Teams.pack(p2Team))}}`,
  );
  const battle = await standingBattle(streams);
  if (!battle) throw new Error(`The ${formatId} battle did not start${streams.choiceErrors.last ? `: ${streams.choiceErrors.last}` : ''}`);
  const log = streams.collectedLog;
  const end = log.findIndex(line => line.startsWith('|start'));
  const bodies = { p1: bodiesOf(battle.sides[0].pokemon), p2: bodiesOf(battle.sides[1].pokemon) };
  const picked = rules.pickedTeamSize;
  const teamPreview = rules.has('teampreview');
  return {
    format: formatId,
    gameType: format.gameType,
    teamPreview,
    bringCount: teamPreview && typeof picked === 'number' && picked > 0 ? picked : null,
    activeCount: battle.activePerHalf,
    header: (end < 0 ? log : log.slice(0, end)).filter(line => !line.startsWith('|t:|')),
    teams: { p1: p1Team, p2: p2Team },
    bodies,
  };
}

/** The battle once both sides stand and its log stops growing (the header comes in one go: a team preview or the first turn); null when none came up. */
async function standingBattle(streams: SessionStreams): Promise<SimBattle | null> {
  const startedAt = Date.now();
  let seen = -1;
  while (Date.now() - startedAt < 3000) {
    const battle = streams.battleStream.battle;
    const ready = !!battle && battle.sides.length === 2 && battle.sides.every(side => side.pokemon.length > 0);
    if (ready && streams.collectedLog.length === seen && seen > 0) return battle;
    seen = ready ? streams.collectedLog.length : -1;
    await sleep(5);
  }
  return null;
}

function bodiesOf(pokemon: SimBattle['sides'][number]['pokemon']): NewGameBody[] {
  return pokemon.map(body => ({
    species: body.species.name,
    name: body.name,
    level: body.level,
    ability: body.baseAbility,
    item: body.item,
    maxHp: body.maxhp,
    stats: {
      atk: body.storedStats.atk, def: body.storedStats.def, spa: body.storedStats.spa,
      spd: body.storedStats.spd, spe: body.storedStats.spe,
    },
  }));
}

/** The abilities a species can have, from the game's Dex (its three slots and an event ability). */
function ownAbilityIds(species: { abilities: object }): Set<string> {
  return new Set((Object.values(species.abilities) as string[]).filter(Boolean).map(ability => toId(ability)));
}

/**
 * The simulator's own validation of each team against the format, as its problems in the simulator's words; an empty list is a
 * legal team. A Custom Game checks nothing in the simulator, so the project's rule joins: each species plays its own
 * abilities (a Hackmons format, which has no such rule, stays free). The result informs the interface; it never decides
 * whether a game may start.
 */
export async function checkGameTeams(formatId: string, teams: { p1: PokemonSet[]; p2: PokemonSet[] }): Promise<GameTeamProblems> {
  await loadSimMods(formatId);
  const format = simFormats().get(formatId);
  if (!format.exists) throw new Error(`Unknown format ${formatId}`);
  const dex = dexOfFormat(format);
  const validator = TeamValidator.get(formatId);
  const free = !format.debug || simFormats().getRuleTable(format).has('obtainableabilities');
  const check = (team: PokemonSet[]): string[] => {
    // The validator may rewrite a set (names, spreads): it reads a copy.
    const problems = validator.validateTeam(JSON.parse(JSON.stringify(team)) as PokemonSet[]) ?? [];
    if (free || dex.gen < 3) return problems;
    for (const set of team) {
      const species = dex.species.get(set.species);
      const ability = dex.abilities.get(set.ability);
      if (!species.exists || !set.ability || !ability.exists) continue;
      if (!ownAbilityIds(species).has(ability.id)) problems.push(`${species.name} cannot have the ability ${ability.name}.`);
    }
    return problems;
  };
  return { p1: check(teams.p1), p2: check(teams.p2) };
}
