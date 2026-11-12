import { describe, expect, test } from 'vitest';
import { Dex } from '@pkmn/sim';
import { analyzeTurn, summarizeTurn, type EvalResult, type RankedChoice } from '@fulllifegames/eval-engine';
import { STATUS_WORDS, wordsOf } from '../../src/lib/branch-dice';

/**
 * Round 89 (#59), stage 5: a deliberate copy. The strand sentence (eval-engine, `prose/effect-words.ts`) and the dice chips of the
 * branch panel (`src/lib/branch-dice.ts`) both turn an effect id into words, and the package cannot import the app. This spec reads
 * the package through its barrel: a softened grade of a doubles turn names the effect of its class key in a sentence, and the words
 * agree with the chip's (up to the case: "Burn" on a chip, "burn" inside a sentence) for every status, a volatile status and the two
 * stat-change forms. (`strand-effect-words.spec.ts` in the package holds the table to the Dex's status conditions and sweeps every
 * secondary of every move.)
 */
const ranked = (choice: string, label: string, ev: number): RankedChoice => ({ choice, label, worstCase: ev, expected: ev, ev, punishedBy: 'Reply' });
const result: EvalResult = {
  score: 0, interval: 0, depthCompleted: 1,
  perSide: {
    p1: [ranked('move tackle 1, move protect', 'Tackle + Protect', 0.1)],
    p2: [ranked('move tackle 1, move protect', 'Tackle + Protect', 0.05), ranked('move protect, move protect', 'Protect + Protect', -0.3)],
  },
};

const sentenceFor = (effectId: string): string => {
  const analysis = analyzeTurn({
    turn: 5,
    result: {
      ...result,
      strands: { p2: {
        played: 'move protect, move protect', best: 'move tackle 1, move protect', playedEv: -0.1, bestEv: 0.05, regret: 0.15, regretBefore: 0.35,
        strands: [{ role: 'P', classKey: `p2a:tackle>p1a=hit-nokill+${effectId}`, chance: 0.1, column: 'Tackle + Protect', before: -0.9, searched: -0.2 }],
      } },
    },
    played: {
      p1: null, p2: null,
      p1Slots: [{ kind: 'move', name: 'Tackle', targetLoc: 1 }, { kind: 'move', name: 'Protect', targetLoc: null }],
      p2Slots: [{ kind: 'move', name: 'Protect', targetLoc: null }, { kind: 'move', name: 'Protect', targetLoc: null }],
    },
    playedOutcome: null, scoreBefore: 0, scoreAfter: null, actives: { p1: null, p2: null, gen: 9 },
  });
  return summarizeTurn(analysis, ['Alice', 'Bob']);
};

describe('the effect words of the sentence and of the chips', () => {
  const words = wordsOf({ dex: Dex.forGen(9) } as never);

  for (const id of [...Object.keys(STATUS_WORDS), 'flinch', 'confusion', 'boosts:spd', 'boosts:atk+def', 'self:spa']) {
    test(`${id}: the sentence says what the chip says`, () => {
      expect(sentenceFor(id).toLowerCase()).toContain(`the 10% ${words.effect(id).toLowerCase()} from tackle`);
    });
  }
});
