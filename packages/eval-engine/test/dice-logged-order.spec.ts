import { describe, expect, test } from 'vitest';
import { loggedDice } from '../src/dice/logged-results';
import { tieName } from '../src/dice/types';

/**
 * Round 86 (the log's dice, T306), found by `cant-choice.spec.ts` (smogtours-gen9ou-752301, turn 1): two Landorus tie in speed, the foe
 * Taunts first and the other body is stopped by the Taunt it just got (`|cant|`). The log shows who acted first only through that `|cant|`
 * line, so the order die has to read a stopped body as an action of the queue too.
 */
describe('the order die reads a body the log stops as an action of the queue', () => {
  const tie = (first: string) => ({ name: tieName('p1a', 'p2a'), result: { first } });

  test('a move, then the body its Taunt stops: the mover is first', () => {
    const lines = ['|', '|move|p2a: Landorus|Taunt|p1a: Landorus', '|-start|p1a: Landorus|move: Taunt', '|cant|p1a: Landorus|move: Taunt|Taunt', '|', '|upkeep'];
    expect(loggedDice(lines)).toContainEqual(tie('p2a'));
  });

  test('a stopped body, then the move of the other: the stopped body is first', () => {
    const lines = ['|', '|cant|p1a: Landorus|par', '|move|p2a: Landorus|Earthquake|p1a: Landorus', '|', '|upkeep'];
    expect(loggedDice(lines)).toContainEqual(tie('p1a'));
  });

  test('a body that switched has no place in the order of moves', () => {
    const lines = ['|', '|switch|p1a: Landorus|Landorus-Therian, M|100/100', '|move|p2a: Landorus|Earthquake|p1a: Landorus', '|', '|upkeep'];
    expect(loggedDice(lines).filter(die => die.name.kind === 'speed-tie')).toEqual([]);
  });
});
