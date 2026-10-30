import { describe, expect, test } from 'vitest';
import { replacementRounds } from '../src/replacement-rounds';

/**
 * Round 79 (T290): the protocol's request rounds on scripted logs: singles, doubles with one and two slots, both sides at once,
 * a replacement that falls to an entry hazard, and the lines that are no replacement (a pivot, the last body of a side).
 */

const log = (...lines: string[]) => lines.join('\n');

describe('replacementRounds', () => {
  test('singles: a faint and the switch that answers it is one round of the block\'s turn', () => {
    const rounds = replacementRounds(log(
      '|turn|3', '|move|p1a: A|Tackle|p2a: B', '|faint|p2a: B', '|', '|upkeep', '|switch|p2a: C|Toxapex, F|100/100', '|turn|4',
    ));
    expect(rounds).toEqual([{ turn: 3, ordinal: 0, slots: { p1: [], p2: [0] }, species: { p1: [], p2: ['Toxapex'] } }]);
  });

  test('doubles: two fainted slots of a side are one round with two slots, one slot of two is one slot', () => {
    const two = replacementRounds(log(
      '|turn|5', '|faint|p1a: A', '|faint|p1b: B', '|upkeep', '|switch|p1b: D|Rotom-Wash|100/100', '|switch|p1a: C|Garchomp, M|100/100', '|turn|6',
    ));
    expect(two).toHaveLength(1);
    expect(two[0].slots).toEqual({ p1: [0, 1], p2: [] });
    expect(two[0].species.p1).toEqual(['Rotom-Wash', 'Garchomp']);
    const one = replacementRounds(log('|turn|5', '|faint|p2b: B', '|upkeep', '|switch|p2b: D|Ting-Lu|100/100', '|turn|6'));
    expect(one[0].slots).toEqual({ p1: [], p2: [1] });
  });

  test('both sides at once share one round', () => {
    const rounds = replacementRounds(log(
      '|turn|2', '|faint|p1a: A', '|faint|p2a: B', '|upkeep', '|switch|p1a: C|Corviknight|100/100', '|switch|p2a: D|Clefable|100/100', '|turn|3',
    ));
    expect(rounds).toHaveLength(1);
    expect(rounds[0].slots).toEqual({ p1: [0], p2: [0] });
  });

  test('a replacement that faints on entry opens the next round of the block', () => {
    const rounds = replacementRounds(log(
      '|turn|8', '|faint|p1a: A', '|upkeep', '|switch|p1a: B|Charizard|100/100', '|-damage|p1a: B|0 fnt|[from] Stealth Rock', '|faint|p1a: B',
      '|', '|switch|p1a: C|Magnezone|100/100', '|turn|9',
    ));
    expect(rounds.map(round => [round.turn, round.ordinal, round.species.p1])).toEqual([[8, 0, ['Charizard']], [8, 1, ['Magnezone']]]);
  });

  test('the second round waits for the other side\'s answer of the first', () => {
    const rounds = replacementRounds(log(
      '|turn|8', '|faint|p1a: A', '|faint|p2a: X', '|upkeep',
      '|switch|p1a: B|Charizard|100/100', '|faint|p1a: B', '|switch|p2a: Y|Toxapex|100/100', '|switch|p1a: C|Magnezone|100/100', '|turn|9',
    ));
    expect(rounds.map(round => [round.ordinal, round.slots.p1, round.slots.p2])).toEqual([[0, [0], [0]], [1, [0], []]]);
  });

  test('a pivot\'s switch, a plain switch and the last body of a side are no round', () => {
    expect(replacementRounds(log(
      '|turn|4', '|switch|p1a: B|Rotom|100/100', '|move|p2a: C|U-turn|p1a: B', '|switch|p2a: D|Zapdos|100/100|[from] U-turn', '|turn|5',
    ))).toEqual([]);
    expect(replacementRounds(log('|turn|9', '|faint|p2a: X', '|win|P1'))).toEqual([]);
    // A faint left over from the block before does not answer the next block's plain switch.
    expect(replacementRounds(log('|turn|9', '|faint|p2a: X', '|turn|10', '|switch|p2a: Y|Zapdos|100/100'))).toEqual([]);
  });

  test('carriage returns do not change the reading', () => {
    const lines = ['|turn|3', '|faint|p2a: B', '|upkeep', '|switch|p2a: C|Toxapex, F|100/100', '|turn|4'];
    expect(replacementRounds(lines.join('\r\n'))).toEqual(replacementRounds(lines.join('\n')));
  });
});
