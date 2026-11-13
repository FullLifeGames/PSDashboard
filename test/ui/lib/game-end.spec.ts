import { describe, expect, test } from 'vitest';
import { gameEnd, logWinner } from '../../../src/lib/game-end';

const ended = { ended: true, winner: 'Bene' };

describe('the end of a game\'s main line (H4h)', () => {
  test('a finished live tip of a game is the game\'s end; singles and doubles read the same state', () => {
    expect(gameEnd({ isGame: true, viewingVariation: false, liveTip: true, atEndPosition: false, log: '', simState: ended })).toEqual({ winner: 'Bene' });
    expect(gameEnd({ isGame: true, viewingVariation: false, liveTip: true, atEndPosition: false, log: '', simState: { ended: true, winner: null } })).toEqual({ winner: null });
  });

  test('a variation that ended, a replay and a live tip still running are no game end', () => {
    expect(gameEnd({ isGame: true, viewingVariation: true, liveTip: true, atEndPosition: false, log: '', simState: ended })).toBeUndefined();
    expect(gameEnd({ isGame: false, viewingVariation: false, liveTip: true, atEndPosition: false, log: '', simState: ended })).toBeUndefined();
    expect(gameEnd({ isGame: true, viewingVariation: false, liveTip: true, atEndPosition: false, log: '', simState: { ended: false, winner: null } })).toBeUndefined();
    expect(gameEnd({ isGame: true, viewingVariation: false, liveTip: false, atEndPosition: false, log: '', simState: null })).toBeUndefined();
  });

  test('after a reload the end position of the main line is the game\'s end, with the winner of the log; any other turn is not', () => {
    const log = '|turn|3\n|move|p1a: A|Tackle|p2a: B\n|\n|win|Alice\n';
    const base = { isGame: true, viewingVariation: false, liveTip: false, simState: null, log };
    expect(gameEnd({ ...base, atEndPosition: true })).toEqual({ winner: 'Alice' });
    expect(gameEnd({ ...base, atEndPosition: true, log: '|turn|3\n' })).toEqual({ winner: null });
    expect(gameEnd({ ...base, atEndPosition: false })).toBeUndefined();
    expect(gameEnd({ ...base, atEndPosition: true, isGame: false })).toBeUndefined();
    expect(gameEnd({ ...base, atEndPosition: true, viewingVariation: true })).toBeUndefined();
    expect(logWinner(log)).toBe('Alice');
  });
});
