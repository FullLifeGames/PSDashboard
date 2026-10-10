import { test, expect, describe } from 'vitest';
import { deniedEndSentence } from '../src/denied-end';

/**
 * Round 67 (T135 point 4): at odds 1 the denied early end has no roll that
 * could fail, yet the sentence said "one sure KO ... but the roll failed".
 * The Champions VGC census game shows it (2695803506 t2: Kingambit one sure
 * KO from clearing the rest); the knock-out never came.
 */

const denied = { turn: 73, side: 'p2' as const, species: 'Garchomp', removes: 'Corviknight', turnsRemaining: 66 };

describe('T135 point 4: a sure knock-out that never came is no failed roll', () => {
  test('singles (573756 t73 shape at odds 1): both forms say the knock-out never came', () => {
    const winner = deniedEndSentence({ ...denied, odds: 1 }, 'p2', 'SOULWIND');
    expect(winner).toContain('Garchomp stood one sure KO from clearing the rest, but the KO never came');
    expect(winner).not.toContain('roll failed');
    expect(deniedEndSentence({ ...denied, odds: 1 }, 'p1', 'LordEnz')).not.toContain('roll failed');
    // A real roll keeps its words.
    expect(deniedEndSentence({ ...denied, odds: 0.9 }, 'p2', 'SOULWIND')).toContain('but the roll failed');
  });

  test('doubles (2695803506 t2 shape at odds 1): the same rule', () => {
    const sentence = deniedEndSentence({ turn: 2, side: 'p2', species: 'Kingambit', removes: 'Basculegion', odds: 1, turnsRemaining: 10 }, 'p1', 'juacox300');
    expect(sentence).toContain('Kingambit stood one sure KO from clearing the rest, but the KO never came');
    expect(sentence).not.toContain('roll failed');
  });
});
