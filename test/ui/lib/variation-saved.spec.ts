import { beforeEach, describe, expect, test } from 'vitest';
import { saveBranchPayload, type BranchSharePayload } from '../../../src/lib/branch-share';
import type { GameSharePayload } from '../../../src/lib/new-game/share';
import { variationSaved } from '../../../src/lib/variation-saved';

/**
 * Round 89 (lane H, #105), H16a: a variation counts as saved when a saved branch of the same replay or game holds the same turn and
 * the same choices; a variation nobody saved, or one changed since the save, is not. The payloads are the ones Save Branch writes
 * (version 1 for a replay's branch, version 2 for a game's); the stand-ins hold the fields the comparison reads.
 */
const choice = (turnNumber: number, move: string) => ({ turnNumber, p1Choice: `move ${move}`, p2Choice: 'move protect', p1Label: move, p2Label: 'Protect' });
const replayBranch = (moves: string[], replayId = 'gen9ou-1'): BranchSharePayload => ({
  version: 1, replayId, format: 'gen9ou', formatid: 'gen9ou', players: ['A', 'B'], branchTurn: 3, createdAt: '2026-11-13T10:00:00Z',
  choices: moves.map((move, index) => choice(3 + index, move)), finalLog: '',
} as unknown as BranchSharePayload);
const gameBranch = (moves: string[], startTurn = 2, gameId = 'newgame-1'): GameSharePayload => ({
  version: 2, kind: 'game', gameId, format: 'gen9ou', formatName: '[Gen 9] OU', players: ['A', 'B'], teams: { p1: '', p2: '' }, seed: '1,2,3,4',
  entries: [], variation: { startTurn, entries: moves.map(move => ({ p1: move, p2: 'protect' })) }, branchTurn: startTurn, createdAt: '2026-11-13T10:00:00Z',
} as unknown as GameSharePayload);

beforeEach(() => localStorage.clear());

describe('a variation that was saved', () => {
  test.each([
    ['a replay', replayBranch(['earthquake']), replayBranch(['earthquake']), replayBranch(['earthquake', 'return'])],
    ['a game', gameBranch(['earthquake']), gameBranch(['earthquake']), gameBranch(['earthquake'], 3)],
  ])('%s: the same choices are saved, other choices or another turn are not', (_name, stored, same, other) => {
    expect(variationSaved(same)).toBe(false);
    saveBranchPayload(stored);
    expect(variationSaved(same)).toBe(true);
    expect(variationSaved(other)).toBe(false);
  });

  test('the saved rows of another replay or game never count', () => {
    saveBranchPayload(replayBranch(['earthquake'], 'gen9ou-2'));
    saveBranchPayload(gameBranch(['earthquake'], 2, 'newgame-2'));
    expect(variationSaved(replayBranch(['earthquake']))).toBe(false);
    expect(variationSaved(gameBranch(['earthquake']))).toBe(false);
  });

  test('a replay branch and a game variation with the same words are different rows', () => {
    saveBranchPayload(replayBranch(['earthquake'], 'newgame-1'));
    expect(variationSaved(gameBranch(['earthquake']))).toBe(false);
  });
});
