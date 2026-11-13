import { describe, expect, test } from 'vitest';
import { gameEnd } from '../../../src/lib/game-end';

const ended = { ended: true, winner: 'Bene' };

describe('the end of a game\'s main line (H4h)', () => {
  test('a finished live tip of a game is the game\'s end; singles and doubles read the same state', () => {
    expect(gameEnd({ isGame: true, viewingVariation: false, liveTip: true, simState: ended })).toEqual({ winner: 'Bene' });
    expect(gameEnd({ isGame: true, viewingVariation: false, liveTip: true, simState: { ended: true, winner: null } })).toEqual({ winner: null });
  });

  test('a variation that ended, a replay and a live tip still running are no game end', () => {
    expect(gameEnd({ isGame: true, viewingVariation: true, liveTip: true, simState: ended })).toBeUndefined();
    expect(gameEnd({ isGame: false, viewingVariation: false, liveTip: true, simState: ended })).toBeUndefined();
    expect(gameEnd({ isGame: true, viewingVariation: false, liveTip: true, simState: { ended: false, winner: null } })).toBeUndefined();
    expect(gameEnd({ isGame: true, viewingVariation: false, liveTip: false, simState: null })).toBeUndefined();
  });
});
