import { describe, expect, test } from 'vitest';
import type { PokemonSnapshot, TurnSnapshot } from '@fulllifegames/replay-core';
import { endgameTurns, livingBodies, loserOf, offeredTurns, WIN_PATHS_BEHIND } from '../../../src/lib/endgame-scope';

const mon = (fainted: boolean): PokemonSnapshot => ({ name: 'x', speciesForme: 'x', hp: fainted ? 0 : 100, maxhp: 100, hpPercent: fainted ? 0 : 100, status: '', fainted, isActive: false, boosts: {}, moves: [], ability: '', item: '', terastallized: '', level: 50, gender: '' });
const side = (id: 'p1' | 'p2', fallen: number, size: number) => ({ name: id, id, pokemon: Array.from({ length: size }, (_, index) => mon(index < fallen)), sideConditions: {} });
const snapshot = (turn: number, fallen1: number, fallen2: number, size1 = 6, size2 = 6, log: string[] = []): TurnSnapshot =>
  ({ turn, p1: side('p1', fallen1, size1), p2: side('p2', fallen2, size2), field: { weather: '', terrain: '', pseudoWeather: {} }, log });

describe('the endgame scope', () => {
  test('singles: the first turn with three bodies standing opens the endgame and every later turn belongs to it', () => {
    // 6 v 6: turn 1 holds 12, turn 2 holds 5 (3 v 2 fallen... 6-3 + 6-4), turn 3 holds 3, turn 4 holds 2
    const snapshots = [snapshot(1, 0, 0), snapshot(2, 3, 4), snapshot(3, 4, 5), snapshot(4, 5, 5)];
    expect(snapshots.map((_, index) => livingBodies(snapshots, index + 1))).toEqual([12, 5, 3, 2]);
    expect(endgameTurns(snapshots, 4)).toEqual([3, 4]);
    expect(endgameTurns(snapshots, 2)).toEqual([]);
  });

  test('VGC: a side brings four of its six, so the brought four are the count', () => {
    const lead = ['|teamsize|p1|4', '|teamsize|p2|4'];
    // the snapshot lists the six of each team, never the unbrought ones as fallen: 4 + 4 brought, 5 fallen on the turn
    const snapshots = [snapshot(1, 0, 0, 6, 6, lead), snapshot(2, 3, 2, 6, 6, lead)];
    expect(livingBodies(snapshots, 1)).toBe(8);
    expect(livingBodies(snapshots, 2)).toBe(3);
    expect(endgameTurns(snapshots, 2)).toEqual([2]);
  });

  test('doubles reads the same count (one body each side is a 1 v 1 endgame)', () => {
    const snapshots = [snapshot(1, 5, 5)];
    expect(livingBodies(snapshots, 1)).toBe(2);
    expect(endgameTurns(snapshots, 1)).toEqual([1]);
  });

  test('no snapshot, no count', () => {
    expect(livingBodies([], 3)).toBeNull();
    expect(endgameTurns([], 3)).toEqual([]);
  });

  test('the loser is the other player than the log\'s winner; a tie or an unfinished log has none', () => {
    expect(loserOf('|turn|3\n|win|devin', ['BKC', 'devin'])).toBe('p1');
    expect(loserOf('|win|BKC', ['BKC', 'devin'])).toBe('p2');
    expect(loserOf('|tie', ['BKC', 'devin'])).toBeNull();
    expect(loserOf('|turn|3', ['BKC', 'devin'])).toBeNull();
    expect(loserOf('|win|someone else', ['BKC', 'devin'])).toBeNull();
  });
});

describe('the turns that offer the loser\'s question', () => {
  const at = (...scores: (number | null)[]) => scores.map(score => (score === null ? null : { score }));

  test('a turn where the loser reads the bar behind offers it, a turn just short of it does not', () => {
    expect(WIN_PATHS_BEHIND).toBe(0.3);
    expect(offeredTurns([], at(-0.3, -0.29, 0.5, -0.31), 'p1')).toEqual([1, 4]);
  });

  test('a p2 loser reads the score with the sign turned: p2 behind is a positive score', () => {
    expect(offeredTurns([], at(0.3, 0.29, -0.5), 'p2')).toEqual([1]);
  });

  test('a turn without a result joins only through the endgame; the union is sorted and holds each turn once', () => {
    expect(offeredTurns([2, 5], at(-0.4, null, -0.35, 0, null), 'p1')).toEqual([1, 2, 3, 5]);
    expect(offeredTurns([], at(null, null), 'p1')).toEqual([]);
  });
});

