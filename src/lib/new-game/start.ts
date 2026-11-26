import { Teams, toID } from '@pkmn/sim';
import type { PokemonSet } from '@pkmn/sim';
import { parseTeamText } from '@fulllifegames/replay-core';
import { readGameSeed } from '@fulllifegames/eval-engine';
import { newGameRecord, newGameSeed, type NewGameRecord } from './record';


export const TEAM_SIZE = 6;

export interface TeamRead {
  sets: PokemonSet[];
  skipped: string[];
}

function typedSpecies(text: string): Map<string, string> {
  const typed = new Map<string, string>();
  for (const block of text.split(/\n\s*\n/)) {
    const header = block.trim().split('\n')[0].split(' @ ')[0].replace(/\s*\((?:M|F)\)$/, '').trim();
    const species = /\(([^()]+)\)$/.exec(header)?.[1] ?? header;
    typed.set(toID(species), species);
  }
  return typed;
}

export function readTeamPaste(text: string): TeamRead {
  const clean = parseTeamText(text).replace(/\r\n?/g, '\n');
  const all = Teams.import(clean) ?? [];
  // Teams.import keeps the id as the species of a name the Dex lacks: the refusal names what was typed.
  const typed = typedSpecies(clean);
  const named = (set: PokemonSet): PokemonSet => (set.species === toID(set.species) ? { ...set, name: typed.get(set.species) ?? set.name } : set);
  return {
    sets: all.filter(set => (set.moves?.length ?? 0) > 0).map(named),
    skipped: all.filter(set => (set.moves?.length ?? 0) === 0).map(set => set.name || set.species),
  };
}

export const teamTooBig = (read: TeamRead): boolean => read.sets.length > TEAM_SIZE;

const SIZE_LINE = /^You may only bring up to \d+ Pokémon \(your team has \d+\)\.$/;
const ABSENT_LINE = /^The Pokemon ".*" does not exist\.$/;

/** The simulator's problems for one box, minus the lines that the size reason or the refusal says already. */
export function boxProblems(read: TeamRead, problems: string[] | null, refusal: string | null): string[] | null {
  if (!problems || read.sets.length === 0) return null;
  const kept = problems.filter(problem => !(teamTooBig(read) && SIZE_LINE.test(problem)) && !(refusal && ABSENT_LINE.test(problem)));
  return kept.length === 0 && kept.length < problems.length ? null : kept;
}

export function seedProblem(text: string): string | null {
  const read = readGameSeed(text);
  return 'problem' in read ? read.problem : null;
}

export interface StartParams {
  format: string;
  formatName: string;
  names: [string, string];
  texts: [string, string];
  seed?: string;
}

export interface StartBlocks {
  teams: [string | null, string | null];
  seed: string | null;
  said: [boolean, boolean];
}

/** What blocks Start: no readable set, more than six, a refused seed, an unknown species; no other team problem. */
export function startBlocks(params: Pick<StartParams, 'texts' | 'seed'> & { refused?: [string | null, string | null] }): StartBlocks {
  const reads = params.texts.map(readTeamPaste);
  const teams = reads.map((read, index) => {
    if (read.sets.length === 0) return read.skipped.length > 0 ? `Player ${index + 1} has no set with a move line.` : `Paste a team for Player ${index + 1} to start.`;
    if (teamTooBig(read)) return `A team holds at most ${TEAM_SIZE} Pokémon.`;
    return params.refused?.[index] ?? null;
  }) as StartBlocks['teams'];
  const said = reads.map(read => read.sets.length === 0 && read.skipped.length > 0) as StartBlocks['said'];
  return { teams, seed: params.seed?.trim() ? seedProblem(params.seed) : null, said };
}

export const stopsStart = (blocks: StartBlocks): boolean => blocks.teams[0] !== null || blocks.teams[1] !== null || blocks.seed !== null;

export function startProblem(params: Pick<StartParams, 'texts' | 'seed'>): string | null {
  if (params.texts.every(text => text.trim() === '')) return 'Paste a team for each player to start.';
  const blocks = startBlocks(params);
  return blocks.teams[0] ?? blocks.teams[1] ?? blocks.seed;
}

/** Starts the battle and returns the record at Team Preview, with the teams `startGameLog` returns, not the paste. */
export async function startNewGame(params: StartParams): Promise<NewGameRecord> {
  const problem = startProblem(params);
  if (problem) throw new Error(problem);
  const [p1, p2] = params.texts.map(readTeamPaste);
  const read = params.seed?.trim() ? readGameSeed(params.seed) : null;
  const seed = read && 'seed' in read ? read.seed : newGameSeed('fresh');
  const players: [string, string] = [params.names[0].trim() || 'Player 1', params.names[1].trim() || 'Player 2'];
  const engine = await import('../lazy/branch-engine');
  await engine.loadSimMods(params.format);
  const start = await engine.startGameLog({ format: params.format, p1Team: p1.sets, p2Team: p2.sets, playerNames: players, seed, fillAbilities: true });
  return newGameRecord({ start, formatName: params.formatName, players, seed });
}
