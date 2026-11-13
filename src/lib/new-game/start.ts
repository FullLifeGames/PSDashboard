import { PRNG, Teams } from '@pkmn/sim';
import type { PokemonSet } from '@pkmn/sim';
import { parseTeamText } from '@fulllifegames/replay-core';
import { newGameRecord, newGameSeed, type NewGameRecord } from './record';

/**
 * Round 89 (lane H, #105), stage H4: what the New game dialog does with its two text fields. A paste is read the way Showdown's
 * own import reads it (`Teams.import`, the library the other import paths use too); a block without a move line is no set, as in
 * `parsePastedTeam`, and the dialog names it. The seed is the simulator's own format, checked by the simulator's PRNG. Start reads
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

const SEED_MESSAGE = 'A seed is four whole numbers from 0 to 65535 with commas, like 1,2,3,4, or "gen5," and 16 hex digits.';

/**
 * The simulator's seed formats the app plays: four 16-bit numbers (`1,2,3,4`, what `newGameSeed` draws) and `gen5,` with 16 hex
 * digits. The simulator's PRNG has to take the text and give the same seed back. Null for a seed that is fine, else the message.
 */
export function seedProblem(text: string): string | null {
  const seed = text.trim();
  const numbers = /^(\d{1,5}),(\d{1,5}),(\d{1,5}),(\d{1,5})$/.exec(seed);
  const gen5 = /^gen5,[0-9a-f]{16}$/i.test(seed);
  if (!gen5 && !(numbers && numbers.slice(1).every(part => Number(part) <= 0xffff))) return SEED_MESSAGE;
  try {
    const prng = new PRNG(seed.toLowerCase() as ConstructorParameters<typeof PRNG>[0]);
    return /^\d+,\d+,\d+,\d+$/.test(prng.getSeed()) ? null : SEED_MESSAGE;
  } catch {
    return SEED_MESSAGE;
  }
}

export interface StartParams {
  format: string;
  formatName: string;
  names: [string, string];
  texts: [string, string];
  /** The seed field's text; empty draws a fresh one. */
  seed?: string;
}

/** The first problem that stops Start, in the dialog's words, or null. */
export function startProblem(params: Pick<StartParams, 'texts' | 'seed'>): string | null {
  const reads = params.texts.map(readTeamPaste);
  if (reads[0].sets.length === 0 && reads[1].sets.length === 0) return 'Paste a team for each player to start.';
  if (reads[0].sets.length === 0) return 'Paste a team for Player 1 to start.';
  if (reads[1].sets.length === 0) return 'Paste a team for Player 2 to start.';
  if (reads.some(read => read.sets.length > TEAM_SIZE)) return `A team holds at most ${TEAM_SIZE} Pokémon.`;
  return params.seed?.trim() ? seedProblem(params.seed) : null;
}

/**
 * Starts the game: reads both pastes, starts the format's battle with the seed and returns the record at Team Preview (no
 * turn played). The record keeps the teams `startGameLog` returns (the level the format gives), never the raw paste.
 */
export async function startNewGame(params: StartParams): Promise<NewGameRecord> {
  const problem = startProblem(params);
  if (problem) throw new Error(problem);
  const [p1, p2] = params.texts.map(readTeamPaste);
  const seed = params.seed?.trim() ? params.seed.trim().toLowerCase() : newGameSeed('fresh');
  const players: [string, string] = [params.names[0].trim() || 'Player 1', params.names[1].trim() || 'Player 2'];
  const engine = await import('../lazy/branch-engine');
  await engine.loadSimMods(params.format);
  const start = await engine.startGameLog({ format: params.format, p1Team: p1.sets, p2Team: p2.sets, playerNames: players, seed });
  return newGameRecord({ start, formatName: params.formatName, players, seed });
}
