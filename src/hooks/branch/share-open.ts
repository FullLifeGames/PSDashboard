import { Teams } from '@pkmn/sim';
import { readGameSeed } from '@fulllifegames/eval-engine';
import { bodyLines } from '../../lib/new-game/game-log';
import { newGameId, newGameRecord, withoutPosition, type NewGameRecord } from '../../lib/new-game/record';
import { historyOfShare, type GameSharePayload } from '../../lib/new-game/share';
import { turnEntryCount } from '../../lib/variation-turns';
import { rebuildGame } from './game-rebuild';
import type { BranchEngineModule } from './shared';

/**
 * Round 89 (lane H, #105), stage H5: the reader of a game's share link (version 2). The link holds the format, the teams, the seed
 * and the entries; the reader starts the format's battle on the seed (the header comes from it, the team preview with it) and plays
 * the entries onto it, the road a saved game's rebuild takes (`rebuildGame`). The record it returns is the sharer's, with a new
 * id: the reader's browser keeps its own copy, and a link opened twice makes two games only where it is opened twice.
 */

export interface OpenedShare { id?: string; now?: Date }

/** The record of a shared game, or the words that say why it cannot start. */
export async function recordOfShare(
  branchEngine: BranchEngineModule, payload: GameSharePayload, { id, now }: OpenedShare = {},
): Promise<NewGameRecord | { error: string }> {
  const p1Team = Teams.unpack(payload.teams.p1) ?? [];
  const p2Team = Teams.unpack(payload.teams.p2) ?? [];
  if (p1Team.length === 0 || p2Team.length === 0) return { error: `This game link holds no team for ${p1Team.length === 0 ? payload.players[0] : payload.players[1]}.` };
  const seed = readGameSeed(payload.seed);
  if ('problem' in seed) return { error: `This game link holds a seed the game cannot use: ${seed.problem}` };
  let start;
  try {
    await branchEngine.loadSimMods(payload.format);
    start = await branchEngine.startGameLog({ format: payload.format, p1Team, p2Team, playerNames: payload.players, seed: seed.seed });
  } catch (error) {
    return { error: `This game link cannot start: ${error instanceof Error ? error.message : String(error)}` };
  }
  const base = newGameRecord({ start, formatName: payload.formatName, players: payload.players, seed: seed.seed, id: id ?? newGameId(), now });
  const entries = historyOfShare(payload.entries);
  const rebuilt = await rebuildGame(branchEngine, { ...base, entries });
  if (!rebuilt) return base;
  if (rebuilt.failure) return { error: `This game link cannot be played from turn ${rebuilt.failure.turnNumber}: ${rebuilt.failure.error}` };
  return {
    ...base,
    entries: rebuilt.entries.map(withoutPosition),
    body: bodyLines(rebuilt.runtime.log),
    turns: Math.max(0, turnEntryCount(rebuilt.entries) - 1),
  };
}
