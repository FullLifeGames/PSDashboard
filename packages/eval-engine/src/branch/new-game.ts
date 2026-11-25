import { PRNG, TeamValidator, Teams } from '@pkmn/sim';
import type { PokemonSet } from '@pkmn/sim';
import { dexOfFormat, simFormats, toId } from '@fulllifegames/replay-core';
import { loadSimMods } from '../forward/sim-mods.ts';
import { DEFAULT_GAME_SEED } from './game-seed.ts';
import { openStreams, type SessionStreams } from './runtime-session.ts';
import type { SimBattle } from './types.ts';
import { sleep } from './execute.ts';

/** Asks the simulator how a new game starts and which problems its validator reports per team; decides nothing. */

export interface NewGameBody {
  species: string;
  name: string;
  level: number;
  ability: string;
  item: string;
  maxHp: number;
  /** The stored stats, HP excluded. */
  stats: { atk: number; def: number; spa: number; spd: number; spe: number };
}

/** The start of a game as the chosen format's own battle reads it. */
export interface NewGameStart {
  format: string;
  gameType: string;
  /** The format has a team preview (Gen 1 to 4 have none: the leads come from the teams). */
  teamPreview: boolean;
  /** Bodies each side brings after a team preview (VGC: 4); null when the whole team plays or there is no preview. */
  bringCount: number | null;
  activeCount: number;
  /** The log up to the start (no `|start|`, no `|t:|` clock lines): a pure function of the start. */
  header: string[];
  /** The teams as the format's battle reads them: each set with the level the format gives its body. */
  teams: { p1: PokemonSet[]; p2: PokemonSet[] };
  bodies: { p1: NewGameBody[]; p2: NewGameBody[] };
}

/** A seed the simulator reads, or the problem that names the forms the dialog accepts. */
export type GameSeedRead = { seed: string } | { problem: string };

const SEED_PROBLEM = 'A seed is four whole numbers from 0 to 65535 with commas, like 1,2,3,4, or "sodium," and up to 64 hex digits (the form of a Showdown input log), or "gen5," and 16 hex digits.';

/** Reads a typed or pasted seed in the simulator's `PRNG` forms and returns the normalized text, or the problem. */
export function readGameSeed(text: string): GameSeedRead {
  // Stricter than the simulator: it takes any number, and a game with a wild seed could not be told from a typo.
  const seed = text.replace(/\s+/g, '').toLowerCase();
  const numbers = /^(\d{1,5}),(\d{1,5}),(\d{1,5}),(\d{1,5})$/.exec(seed);
  const known = (numbers && numbers.slice(1).every(part => Number(part) <= 0xffff))
    || /^sodium,[0-9a-f]{1,64}$/.test(seed)
    || /^gen5,[0-9a-f]{16}$/.test(seed);
  if (!known) return { problem: SEED_PROBLEM };
  try {
    new PRNG(seed as ConstructorParameters<typeof PRNG>[0]);
  } catch {
    return { problem: SEED_PROBLEM };
  }
  return { seed };
}

/** The input of `startGameLog`: a format and two pasted teams. */
export interface StartGameParams {
  format: string;
  p1Team: PokemonSet[];
  p2Team: PokemonSet[];
  playerNames?: [string, string];
  seed?: string;
  /** Fills a blank ability with the species' first one the format allows; a rebuild of a saved game does not. */
  fillAbilities?: boolean;
}

/** The validator's problems per side, and per side the sentence `startGameLog` throws for an unknown species. */
export interface GameTeamProblems {
  p1: string[];
  p2: string[];
  refused: { p1: string | null; p2: string | null };
}

// The validator rewrites the set's level by `Adjust Level` and `Adjust Level Down` (`validateSet`, team-validator.js);
// the battle itself plays whatever level it gets.
function levelOfSet(rules: ReturnType<ReturnType<typeof simFormats>['getRuleTable']>, set: PokemonSet): number {
  let level = set.level || rules.defaultLevel;
  let adjust = rules.adjustLevel;
  if (rules.adjustLevelDown && level >= rules.adjustLevelDown) adjust = rules.adjustLevelDown;
  if (level === adjust || (level === 100 && rules.maxLevel < 100)) level = rules.maxLevel;
  return adjust || level;
}

// A species the Dex does not know cannot start (the stream throws "Cannot read properties of null");
// a move, item or ability it does not know starts as given.
function unknownSpeciesRefusal(format: ReturnType<ReturnType<typeof simFormats>['get']>, team: PokemonSet[]): string | null {
  const dex = dexOfFormat(format);
  for (const set of team) {
    if (dex.species.get(set.species).exists) continue;
    const name = (set.species || set.name || '').trim();
    return name ? `${name} is no Pokémon of ${format.name}. Fix the set to start.` : `A set has no Pokémon. Fix the set to start.`;
  }
  return null;
}

function refuseUnknownSpecies(format: ReturnType<ReturnType<typeof simFormats>['get']>, team: PokemonSet[]): void {
  const refusal = unknownSpeciesRefusal(format, team);
  if (refusal) throw new Error(refusal);
}

// The Dex's slot order (0, 1, hidden, special), without gaps or repeats.
function abilitiesInSlotOrder(species: { abilities: object }): string[] {
  const slots = species.abilities as Record<string, string | undefined>;
  const names = ['0', '1', 'H', 'S'].map(slot => slots[slot]).filter((name): name is string => !!name);
  return names.filter((name, index) => names.indexOf(name) === index);
}

// A blank plays as no ability in the simulator; the fill is the first Dex slot the validator allows (`checkAbility`),
// so Evasion Abilities Clause or a banned Commander skips slot 0. Generations 1 and 2 and unknown species fill nothing.
function blankAbilityFill(dex: ReturnType<typeof dexOfFormat>, validator: TeamValidator, set: PokemonSet): string | null {
  if (set.ability || dex.gen < 3) return null;
  const species = dex.species.get(set.species);
  if (!species.exists) return null;
  const own = abilitiesInSlotOrder(species);
  const named = { ...set, name: set.name || species.name };
  const allowed = own.find(name => !validator.checkAbility(named, dex.abilities.get(name), {}));
  return allowed ?? own[0] ?? null;
}

const filledAbilities = (dex: ReturnType<typeof dexOfFormat>, validator: TeamValidator, team: PokemonSet[]): PokemonSet[] =>
  team.map(set => { const fill = blankAbilityFill(dex, validator, set); return fill ? { ...set, ability: fill } : set; });

/** Starts the format's battle on the omniscient stream, reads its header and bodies; throws if it does not come up. */
export async function startGameLog(params: StartGameParams): Promise<NewGameStart> {
  const { format: formatId } = params;
  await loadSimMods(formatId);
  const format = simFormats().get(formatId);
  if (!format.exists) throw new Error(`Unknown format ${formatId}`);
  refuseUnknownSpecies(format, [...params.p1Team, ...params.p2Team]);
  const rules = simFormats().getRuleTable(format);
  const dex = dexOfFormat(format);
  const given = (team: PokemonSet[]): PokemonSet[] => (params.fillAbilities ? filledAbilities(dex, TeamValidator.get(formatId), team) : team);
  const leveled = (team: PokemonSet[]): PokemonSet[] => given(team).map(set => ({ ...set, level: levelOfSet(rules, set) }));
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

function ownAbilityIds(species: { abilities: object }): Set<string> {
  return new Set((Object.values(species.abilities) as string[]).filter(Boolean).map(ability => toId(ability)));
}

/** The simulator's validation of each team (empty: legal), plus the Custom Game ability rule. */
export async function checkGameTeams(formatId: string, teams: { p1: PokemonSet[]; p2: PokemonSet[] }): Promise<GameTeamProblems> {
  // A Custom Game checks nothing in the simulator, so each species plays its own abilities here (Hackmons stay free).
  await loadSimMods(formatId);
  const format = simFormats().get(formatId);
  if (!format.exists) throw new Error(`Unknown format ${formatId}`);
  const dex = dexOfFormat(format);
  const validator = TeamValidator.get(formatId);
  const free = !format.debug || simFormats().getRuleTable(format).has('obtainableabilities');
  const check = (pasted: PokemonSet[]): string[] => {
    const team = filledAbilities(dex, validator, pasted);
    const fills = pasted.flatMap((set, index) => (team[index].ability === set.ability ? [] : [`${dex.species.get(set.species).name} has no ability: plays ${team[index].ability}.`]));
    // The validator may rewrite a set (names, spreads): it reads a copy.
    const problems = [...(validator.validateTeam(JSON.parse(JSON.stringify(team)) as PokemonSet[]) ?? []), ...fills];
    if (free || dex.gen < 3) return problems;
    for (const set of team) {
      const species = dex.species.get(set.species);
      const ability = dex.abilities.get(set.ability);
      if (!species.exists || !set.ability || !ability.exists) continue;
      if (!ownAbilityIds(species).has(ability.id)) problems.push(`${species.name} cannot have the ability ${ability.name}.`);
    }
    return problems;
  };
  return { p1: check(teams.p1), p2: check(teams.p2), refused: { p1: unknownSpeciesRefusal(format, teams.p1), p2: unknownSpeciesRefusal(format, teams.p2) } };
}
