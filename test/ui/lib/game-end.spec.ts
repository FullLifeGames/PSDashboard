import { describe, expect, test } from 'vitest';
import { gameEnd, idleGameTip, logWinner } from '../../../src/lib/game-end';

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
    // a replay's end is the battle's (H19a)
    expect(gameEnd({ ...base, atEndPosition: true, isGame: false })).toEqual({ winner: 'Alice', battle: true });
    expect(gameEnd({ ...base, atEndPosition: true, viewingVariation: true })).toBeUndefined();
    expect(logWinner(log)).toBe('Alice');
  });
});

describe('a replay shows its result at its end (H19a)', () => {
  const base = { isGame: false, viewingVariation: false, liveTip: false, simState: null };
  const won = '|turn|9\n|move|p1a: A|Tackle|p2a: B\n|faint|p2a: B\n|\n|win|Alice\n';

  test('the end position of a replay names the winner of its log and marks the end as a battle; any other turn shows none', () => {
    expect(gameEnd({ ...base, atEndPosition: true, log: won })).toEqual({ winner: 'Alice', battle: true });
    expect(gameEnd({ ...base, atEndPosition: false, log: won })).toBeUndefined();
    // a branch of the replay keeps its own words (a variation wins, not the battle)
    expect(gameEnd({ ...base, atEndPosition: true, viewingVariation: true, log: won })).toBeUndefined();
  });

  test('a tie names no winner; a log cut off before any result shows no end (the picker stays)', () => {
    expect(gameEnd({ ...base, atEndPosition: true, log: '|turn|9\n|\n|tie\n' })).toEqual({ winner: null, battle: true });
    expect(gameEnd({ ...base, atEndPosition: true, log: '|turn|9\n|move|p1a: A|Tackle|p2a: B\n' })).toBeUndefined();
  });

  test('a game keeps its own words at its end (no battle flag)', () => {
    expect(gameEnd({ ...base, isGame: true, atEndPosition: true, log: won })).toEqual({ winner: 'Alice' });
  });
});

describe('the live tip of a game is no variation (H4h)', () => {
  const tip = { gameTip: 5, startTurn: 5, history: [] as object[], turnEntries: 0, replacementPending: false };
  const koTurn = { ...tip, history: [{}], turnEntries: 1, replacementPending: true };

  test('no turn played from the tip: idle; a replacement still pending after the first turn: idle until it is chosen (a knockout, singles or doubles)', () => {
    expect(idleGameTip(tip)).toBe(true);
    expect(idleGameTip(koTurn)).toBe(true);
  });

  test('a played turn, a variation from an earlier turn and a replay show their variation chrome', () => {
    expect(idleGameTip({ ...tip, history: [{}], turnEntries: 1 })).toBe(false);
    expect(idleGameTip({ ...koTurn, startTurn: 3 })).toBe(false);
    expect(idleGameTip({ ...koTurn, turnEntries: 2, history: [{}, {}] })).toBe(false);
    expect(idleGameTip({ ...tip, gameTip: null })).toBe(false);
  });
});
