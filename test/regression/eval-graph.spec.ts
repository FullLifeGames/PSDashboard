import { test, expect, describe, onTestFinished } from 'vitest';
import { coverageNotice, recordEvalError, resolveAutoTurnSettings, serializedFaintedFraction, supersedesStored, verificationDeepSettings, withEvalGapNotice } from '../../src/hooks/useEvaluation';
import { makePositionSource } from '../../src/hooks/evaluation/sweep-positions';
import type { GraphSweepParams, SweepData } from '../../src/hooks/evaluation/sweep-types';
import {
  AUTO_MCTS_FAINTED_FRACTION, computeBlunders, configureSearchBudget, selectKeyTurns, KEY_TURN_SWING, KEY_MOMENT_SWING,
  SEARCH_BUDGET_DEFAULT,
} from '@fulllifegames/eval-engine';

describe('coverage notice (acquisition pass)', () => {
  const pos = (bits: (0 | 1)[]) => bits.map((bit, index) => (bit ? `p${index + 1}` : null));

  test('full coverage stays silent', () => {
    expect(coverageNotice(pos([1, 1, 1, 1]))).toBeNull();
    expect(coverageNotice([])).toBeNull();
  });

  test('nothing reconstructed names the guessed sets', () => {
    expect(coverageNotice(pos([0, 0, 0]))).toContain('could not be reconstructed');
  });

  test('a missing final turn only is the mild ended-early story', () => {
    const notice = coverageNotice(pos([1, 1, 1, 1, 0]))!;
    expect(notice).toContain('one turn early');
    expect(notice).toContain('rest of the line is unaffected');
    expect(notice).not.toContain('Edit Player/Opp');
  });

  test('mid-game gaps are divergence with reconstruction counts', () => {
    const notice = coverageNotice(pos([1, 1, 0, 1, 1, 1]))!;
    expect(notice).toContain('5 of 6 turns could be reconstructed');
    expect(notice).toContain('Edit Player/Opp');
  });

  test('a long trailing run is divergence, not the mild story', () => {
    const notice = coverageNotice(pos([1, 1, 1, 0, 0, 0, 0]))!;
    expect(notice).toContain('3 of 7 turns could be reconstructed');
  });
});

describe('coverage notice of a new game', () => {
  const pos = (bits: (0 | 1)[]) => bits.map((bit, index) => (bit ? `p${index + 1}` : null));
  const game = { game: true } as const;

  test('full coverage stays silent', () => {
    expect(coverageNotice(pos([1, 1]), game)).toBeNull();
    expect(coverageNotice([], game)).toBeNull();
  });

  test('nothing rebuilt: names the record and the retry, no guessed sets, no Edit Player/Opp', () => {
    expect(coverageNotice(pos([0, 0, 0]), game)).toBe(
      "This game's positions could not be rebuilt from its record, so no turn has a live position to analyze. Analyze game again; if this stays, Report issue sends the game.",
    );
  });

  test('some turns rebuilt, a missing last turn included: counts the turns and offers the retry', () => {
    expect(coverageNotice(pos([1, 1, 0]), game)).toBe('Only 2 of 3 turns could be rebuilt from this game\'s record for analysis. Analyze game again to retry the rest.');
    expect(coverageNotice(pos([1, 0, 1]), game)).toBe('Only 2 of 3 turns could be rebuilt from this game\'s record for analysis. Analyze game again to retry the rest.');
  });

  test('the position source words its notice by the sweep\'s game flag: a rebuild that finds nothing and one that throws', async () => {
    const run = async (game: boolean, acquireAll: () => Promise<(string | null)[]>) => {
      const data = { notice: null } as unknown as SweepData;
      const source = makePositionSource({ turns: 2, game, acquireAll } as unknown as GraphSweepParams, data);
      await source.positionFor(1).catch(() => undefined);
      return data.notice;
    };
    expect(await run(true, async () => [null, null])).toBe(coverageNotice([null, null], { game: true }));
    expect(await run(false, async () => [null, null])).toBe(coverageNotice([null, null]));
    expect(await run(true, async () => { throw new Error('boom'); })).toBe('The game could not be rebuilt: boom');
    expect(await run(false, async () => { throw new Error('boom'); })).toBe('The replay could not be reconstructed: boom');
  });

  test('every game notice avoids the replay words', () => {
    for (const bits of [[0, 0], [1, 0], [0, 1, 1]] as (0 | 1)[][]) {
      expect(coverageNotice(pos(bits), game)).not.toMatch(/guessed sets|Edit Player|replay|simulated/i);
    }
  });
});

describe('eval-gap visibility helpers', () => {
  test('recordEvalError keeps the reason only while the turn is scoreless', () => {
    const evalErrors: (string | null)[] = [null, null, null];
    const scores: (number | null)[] = [null, 0.4, null];
    recordEvalError(evalErrors, scores, 1, new Error('p1 "move return102": rejected'));
    expect(evalErrors[0]).toBe('p1 "move return102": rejected');
    recordEvalError(evalErrors, scores, 2, new Error('later pass failed'));
    expect(evalErrors[1]).toBeNull();
    recordEvalError(evalErrors, scores, 3, 'worker died');
    expect(evalErrors[2]).toBe('worker died');
  });

  test('withEvalGapNotice combines acquisition and eval-layer stories', () => {
    expect(withEvalGapNotice(null, [null, null])).toBeNull();
    expect(withEvalGapNotice('short line.', [null, null])).toBe('short line.');
    expect(withEvalGapNotice(null, ['boom', null, 'later']))
      .toBe('2 turns had a live position but could not be evaluated (first error: "boom").');
    expect(withEvalGapNotice(null, [null, 'single']))
      .toBe('1 turn had a live position but could not be evaluated (first error: "single").');
    expect(withEvalGapNotice('The reconstruction diverged: 3 of 5.', ['boom']))
      .toBe('The reconstruction diverged: 3 of 5. 1 turn had a live position but could not be evaluated (first error: "boom").');
  });
});

describe('graph merge monotonicity', () => {
  test('a shallower pass never overwrites deeper stored data', () => {
    expect(supersedesStored({ depth: 2, samples: 3, mode: 'matrix' }, { depth: 1, samples: 1, mode: 'matrix' }, 'matrix')).toBe(false);
    expect(supersedesStored({ depth: 1, samples: 1, mode: 'matrix' }, { depth: 2, samples: 3, mode: 'matrix' }, 'matrix')).toBe(true);
    expect(supersedesStored(null, { depth: 1, samples: 1, mode: 'matrix' }, 'matrix')).toBe(true);
    expect(supersedesStored({ depth: 2, samples: 3, mode: 'matrix' }, { depth: 2, samples: 3, mode: 'matrix' }, 'matrix')).toBe(true);
    expect(supersedesStored({ depth: 2, samples: 5, mode: 'matrix' }, { depth: 3, samples: 3, mode: 'matrix' }, 'matrix')).toBe(false);
    expect(supersedesStored({ depth: 2, samples: 5, mode: 'matrix' }, { depth: 3, samples: 5, mode: 'matrix' }, 'matrix')).toBe(true);
  });
  test('cross-mode results replace only toward the configured mode', () => {
    expect(supersedesStored({ depth: 2, samples: 1, mode: 'mcts' }, { depth: 1, samples: 1, mode: 'matrix' }, 'mcts')).toBe(false);
    expect(supersedesStored({ depth: 2, samples: 1, mode: 'mcts' }, { depth: 1, samples: 1, mode: 'matrix' }, 'matrix')).toBe(true);
    expect(supersedesStored({ depth: 1, samples: 1, mode: 'matrix' }, { depth: 1, samples: 1, mode: 'mcts' }, 'mcts')).toBe(true);
    expect(supersedesStored({ depth: 1, samples: 1, mode: 'mcts' }, { depth: 1, samples: 1, mode: 'mcts' }, 'mcts')).toBe(true);
  });
  test('a matrix result of depth ≥ 2 is replaced by an MCTS-target sweep', () => {
    expect(supersedesStored({ depth: 2, samples: 3, mode: 'matrix' }, { depth: 1, samples: 1, mode: 'mcts' }, 'mcts')).toBe(true);
    expect(supersedesStored({ depth: 3, samples: 3, mode: 'matrix' }, { depth: 1, samples: 1, mode: 'mcts' }, 'mcts')).toBe(true);
    expect(supersedesStored({ depth: 2, samples: 3, mode: 'matrix' }, { depth: 1, samples: 1, mode: 'mcts' }, 'auto', 0.5)).toBe(true);
  });
  test('a matrix result of depth ≥ 2 does not land on an MCTS-target turn', () => {
    expect(supersedesStored({ depth: 1, samples: 1, mode: 'mcts' }, { depth: 2, samples: 3, mode: 'matrix' }, 'auto', 0.5)).toBe(false);
    expect(supersedesStored({ depth: 1, samples: 1, mode: 'mcts' }, { depth: 2, samples: 3, mode: 'matrix' }, 'mcts')).toBe(false);
    expect(supersedesStored({ depth: 1, samples: 1, mode: 'mcts' }, { depth: 3, samples: 3, mode: 'matrix' }, 'auto', 1)).toBe(false);
    expect(supersedesStored({ depth: 1, samples: 1, mode: 'mcts' }, { depth: 2, samples: 3, mode: 'matrix' }, 'matrix')).toBe(true);
  });
});

describe('auto mode resolution', () => {
  const before61 = { earlyDepth: 1, earlySamples: 1, treeFrom: AUTO_MCTS_FAINTED_FRACTION } as const;
  const budgetBefore61 = { ...SEARCH_BUDGET_DEFAULT, singles: before61, doubles: before61 };

  test('auto runs the tree from the first turn in doubles; the threshold before it stays reachable through the budget', () => {
    expect(resolveAutoTurnSettings(0, true)).toEqual({ depth: 1, samples: 1, mode: 'mcts' });
    expect(resolveAutoTurnSettings(1, true)).toEqual({ depth: 1, samples: 1, mode: 'mcts' });
    expect(resolveAutoTurnSettings(1, false)).toEqual({ depth: 1, samples: 1, mode: 'mcts' });
    configureSearchBudget(budgetBefore61);
    try {
      for (const doubles of [false, true]) {
        expect(resolveAutoTurnSettings(AUTO_MCTS_FAINTED_FRACTION - 0.001, doubles)).toEqual({ depth: 1, samples: 1, mode: 'matrix' });
        expect(resolveAutoTurnSettings(AUTO_MCTS_FAINTED_FRACTION, doubles)).toEqual({ depth: 1, samples: 1, mode: 'mcts' });
      }
    } finally {
      configureSearchBudget(null);
    }
  });

  test('serializedFaintedFraction mirrors the engine definition', () => {
    const battle = JSON.stringify({
      sides: [
        { pokemon: [{ hp: 100 }, { hp: 0 }, { hp: 12, fainted: false }] },
        { pokemon: [{ hp: 50, fainted: true }, { hp: 88 }, { hp: 44 }] },
      ],
    });
    expect(serializedFaintedFraction(battle)).toBeCloseTo(2 / 6, 10);
    expect(serializedFaintedFraction(JSON.stringify({ sides: [] }))).toBe(0);
  });

  test('supersedes resolves auto per turn: the fast sketch never downgrades a resolved-MCTS turn', () => {
    const mctsStored = { depth: 1, samples: 1, mode: 'mcts' } as const;
    const fastIncoming = { depth: 1, samples: 1, mode: 'matrix' } as const;
    expect(supersedesStored(mctsStored, fastIncoming, 'auto', 0.1, true)).toBe(false);
    configureSearchBudget(budgetBefore61);
    onTestFinished(() => configureSearchBudget(null));
    expect(supersedesStored(mctsStored, fastIncoming, 'auto', 0.5)).toBe(false);
    expect(supersedesStored(mctsStored, fastIncoming, 'auto', 0.1)).toBe(true);
    expect(supersedesStored(mctsStored, fastIncoming, 'auto', null)).toBe(false);
    expect(supersedesStored({ depth: 2, samples: 3, mode: 'matrix' }, fastIncoming, 'auto', null)).toBe(false);
    expect(supersedesStored(fastIncoming, { depth: 2, samples: 3, mode: 'matrix' }, 'auto', null)).toBe(true);
  });
});

describe('verification deep tier', () => {
  test('flags adjudicate one depth up in matrix pair space, from any line engine', () => {
    expect(verificationDeepSettings({ depth: 1, samples: 1, mode: 'matrix' }))
      .toMatchObject({ depth: 2, samples: 1, mode: 'matrix' });
    expect(verificationDeepSettings({ depth: 2, samples: 3, mode: 'matrix' }))
      .toMatchObject({ depth: 3, samples: 3, mode: 'matrix' });
    expect(verificationDeepSettings({ depth: 3, samples: 3, mode: 'matrix' })).toBeNull();
    // MCTS lines verify at the same matrix tier a d1 line gets: the verdict statistic (bestDeep - playedDeep) is
    // deep-tier-internal, whatever engine raised the flag.
    expect(verificationDeepSettings({ depth: 1, samples: 1, mode: 'mcts' }))
      .toMatchObject({ depth: 2, samples: 1, mode: 'matrix' });
    expect(verificationDeepSettings({ depth: 2, samples: 3, mode: 'mcts' }))
      .toMatchObject({ depth: 2, samples: 3, mode: 'matrix' });
    const deep = verificationDeepSettings({ depth: 1, samples: 1, mode: 'mcts', tera: false, keepPlayed: { p1Slots: ['move tackle'] } as never });
    expect(deep?.tera).toBe(false);
    expect(deep?.keepPlayed).toBeUndefined();
  });
});

describe('key-turn coverage matches the report', () => {
  test('every report-worthy swing gets the deepening pass', () => {
    // One constant feeds the report and selectKeyTurns: a swing the report names must get the deepening pass.
    expect(KEY_MOMENT_SWING).toBe(KEY_TURN_SWING);
    expect(selectKeyTurns([-0.16, -0.25, 0.1])).toEqual([2, 3]);
    expect(selectKeyTurns([0.0, 0.2, 0.1])).toEqual([]);
  });
});

describe('eval graph blunder detection', () => {
  test('flags the turn whose play created the swing, not the turn after', () => {
    const scores = [0.1, 0.15, -0.3, -0.25, 0.4];
    // scores[t-1] is the start of turn t, so the -0.45 swing between the turn-2 and turn-3 points was played on turn 2,
    // and the +0.65 swing on turn 4.
    expect(computeBlunders(scores)).toEqual([2, 4]);
  });

  test('ignores gaps and small drifts', () => {
    const scores = [0.0, null, 0.1, 0.15, null, null, 0.2];
    expect(computeBlunders(scores)).toEqual([]);
  });

  test('a swing across a gap is not attributed', () => {
    const scores = [0.5, null, -0.5];
    expect(computeBlunders(scores)).toEqual([]);
  });

  test('key turns cover both sides of every big swing', () => {
    const scores = [0.1, 0.15, -0.3, -0.25, 0.4];
    // Swings land on turns 3 and 5 — deepen the causing turn and the turn after.
    expect(selectKeyTurns(scores)).toEqual([2, 3, 4, 5]);
  });

  test('key turns respect the cap, biggest swings first', () => {
    const scores = [0, 0.3, 0, 0.4, 0, 0.5, 0];
    // Every step is a swing; a cap of 2 keeps only the biggest pair (0.5).
    expect(selectKeyTurns(scores, 2)).toEqual([5, 6]);
  });

  test('a quiet game needs no deepening', () => {
    expect(selectKeyTurns([0.1, 0.12, 0.15, 0.11])).toEqual([]);
  });
});
