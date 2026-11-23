import { Teams } from '@pkmn/sim';
import type { PokemonSet } from '@pkmn/sim';
import { parseTeamText } from '@fulllifegames/replay-core';
import { readGameSeed } from '@fulllifegames/eval-engine';
import { newGameRecord, newGameSeed, type NewGameRecord } from './record';

// What the New game dialog does with its two text fields: a paste is read by Showdown's own import (`Teams.import`); a block without a move line is no set.

export const TEAM_SIZE = 6;

export interface TeamRead {
  sets: PokemonSet[];
  skipped: string[];
}

export function readTeamPaste(text: string): TeamRead {
  const all = Teams.import(parseTeamText(text).replace(/\r\n?/g, '\n')) ?? [];
  return {
    sets: all.filter(set => (set.moves?.length ?? 0) > 0),
    skipped: all.filter(set => (set.moves?.length ?? 0) === 0).map(set => set.name || set.species),
  };
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
}

/**
 * The one rule for what blocks Start: a side with no readable set, a side with more than six, a seed the engine refuses, and a
 * species the format's Dex does not know (`refused`, the sentence `checkGameTeams` takes; absent until the team check has read
 * the paste, where Start refuses it itself). The simulator's other team problems never block: a league may allow what the format bans.
 */
export function startBlocks(params: Pick<StartParams, 'texts' | 'seed'> & { refused?: [string | null, string | null] }): StartBlocks {
  const teams = params.texts.map((text, index) => {
    const { sets } = readTeamPaste(text);
    if (sets.length === 0) return `Paste a team for Player ${index + 1} to start.`;
    if (sets.length > TEAM_SIZE) return `A team holds at most ${TEAM_SIZE} Pokémon.`;
    return params.refused?.[index] ?? null;
  }) as StartBlocks['teams'];
  return { teams, seed: params.seed?.trim() ? seedProblem(params.seed) : null };
}

export const stopsStart = (blocks: StartBlocks): boolean => blocks.teams[0] !== null || blocks.teams[1] !== null || blocks.seed !== null;

export function startProblem(params: Pick<StartParams, 'texts' | 'seed'>): string | null {
  if (params.texts.every(text => readTeamPaste(text).sets.length === 0)) return 'Paste a team for each player to start.';
  const blocks = startBlocks(params);
  return blocks.teams[0] ?? blocks.teams[1] ?? blocks.seed;
}

/**
 * Starts the format's battle with the seed and returns the record at Team Preview (no turn played). The record keeps the teams
 * `startGameLog` returns (the level the format gives, the species' first ability for a set that pasted none), never the raw paste.
 */
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
