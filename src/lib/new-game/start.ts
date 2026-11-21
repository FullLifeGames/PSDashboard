import { Teams } from '@pkmn/sim';
import type { PokemonSet } from '@pkmn/sim';
import { parseTeamText } from '@fulllifegames/replay-core';
import { readGameSeed } from '@fulllifegames/eval-engine';
import { newGameRecord, newGameSeed, type NewGameRecord } from './record';

/**
 * Round 89 (lane H, #105), stage H4: what the New game dialog does with its two text fields. A paste is read the way Showdown's
 * own import reads it (`Teams.import`, the library the other import paths use too); a block without a move line is no set, as in
 * `parsePastedTeam`, and the dialog names it. The seed is read by the engine (`readGameSeed`). Start reads
 * both pastes again, starts the format's battle (`startGameLog`) and returns the record the app opens.
 */

/** A team holds at most six Pokémon; the dialog counts "n of 6 sets read". */
export const TEAM_SIZE = 6;

export interface TeamRead {
  sets: PokemonSet[];
  /** Species of the blocks that had no move line: they are not read as sets, and the dialog names them. */
  skipped: string[];
}

/** The sets a pasted Showdown export holds (German stat names read as in the loader), in paste order. */
export function readTeamPaste(text: string): TeamRead {
  const all = Teams.import(parseTeamText(text).replace(/\r\n?/g, '\n')) ?? [];
  return {
    sets: all.filter(set => (set.moves?.length ?? 0) > 0),
    skipped: all.filter(set => (set.moves?.length ?? 0) === 0).map(set => set.name || set.species),
  };
}

/** Null for a seed the engine reads (`readGameSeed`: four numbers, sodium, gen5), else the message that names the forms. */
export function seedProblem(text: string): string | null {
  const read = readGameSeed(text);
  return 'problem' in read ? read.problem : null;
}

export interface StartParams {
  format: string;
  formatName: string;
  names: [string, string];
  texts: [string, string];
  /** The seed field's text; empty draws a fresh one. */
  seed?: string;
}

/** What stops Start, by the box that causes it: a message per side and one for the seed, each null when nothing stops. */
export interface StartBlocks {
  teams: [string | null, string | null];
  seed: string | null;
}

/**
 * The one rule for what blocks Start (round 89, NG-2): a side with no readable set, a side with more than six, a seed the engine
 * refuses, and a species the format's Dex does not know (`refused`, the sentence `checkGameTeams` takes from the start's own rule;
 * absent until the team check has read the paste, where Start refuses it itself). The simulator's other team problems never block:
 * a league may allow what the format bans (ruling 31, H2b).
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

/** The first problem that stops Start, in the dialog's words, or null. */
export function startProblem(params: Pick<StartParams, 'texts' | 'seed'>): string | null {
  if (params.texts.every(text => readTeamPaste(text).sets.length === 0)) return 'Paste a team for each player to start.';
  const blocks = startBlocks(params);
  return blocks.teams[0] ?? blocks.teams[1] ?? blocks.seed;
}

/**
 * Starts the game: reads both pastes, starts the format's battle with the seed and returns the record at Team Preview (no
 * turn played). The record keeps the teams `startGameLog` returns (the level the format gives, and the species' first ability for a set that
 * pasted none, H20a), never the raw paste.
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
