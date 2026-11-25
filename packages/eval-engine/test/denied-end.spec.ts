import { test, expect, describe } from 'vitest';
import { deniedEndSentence } from '../src/denied-end';

const denied = { turn: 73, side: 'p2' as const, species: 'Garchomp', removes: 'Corviknight', turnsRemaining: 66 };

describe('a sure knock-out that never came is no failed roll', () => {
  test('singles (573756 t73 shape at odds 1): both forms say the knock-out never came', () => {
    const winner = deniedEndSentence({ ...denied, odds: 1 }, 'p2', 'SOULWIND');
    expect(winner).toContain('Garchomp stood one sure KO from clearing the rest, but the KO never came');
    expect(winner).not.toContain('roll failed');
    expect(deniedEndSentence({ ...denied, odds: 1 }, 'p1', 'LordEnz')).not.toContain('roll failed');
    expect(deniedEndSentence({ ...denied, odds: 0.9 }, 'p2', 'SOULWIND')).toContain('but the roll failed');
  });

  test('doubles (2695803506 t2 shape at odds 1): the same rule', () => {
    const sentence = deniedEndSentence({ turn: 2, side: 'p2', species: 'Kingambit', removes: 'Basculegion', odds: 1, turnsRemaining: 10 }, 'p1', 'juacox300');
    expect(sentence).toContain('Kingambit stood one sure KO from clearing the rest, but the KO never came');
    expect(sentence).not.toContain('roll failed');
  });
});
