import { describe, expect, test } from 'vitest';
import { worstAnswer } from '../src/turn-analysis/worst-answer';
import type { EvalMatrix, EvalResult, MatrixCell, RankedChoice } from '../src/types';

/**
 * Round 89 (#153): the reply that hurts a row most. The lowest cell of the row among the cells the result trusts (verified, or the
 * visits the hindsight read asks for, or every cell when the result carries no cell statistics), else the row's own floor
 * (`punishedBy`), else none. Singles and doubles boards read the same matrix.
 */

const ranked = (choice: string, label: string, punishedBy: string | null = null): RankedChoice => ({ choice, label, worstCase: 0, expected: 0, ev: 0, punishedBy });
const solid: MatrixCell = { visits: 20, verified: false };
const thin: MatrixCell = { visits: 2, verified: false };
const verified: MatrixCell = { visits: 1, verified: true };

/** Rows: Surf, Ice Beam (p1). Columns: Draining Kiss, Moonblast, Mew (p2). Values are p1's view. */
function board(values: number[][], cells?: MatrixCell[][], p1 = ['Surf', 'Ice Beam'], p2 = ['Draining Kiss', 'Moonblast', '→ Mew']): EvalResult {
  const matrix: EvalMatrix = {
    p1Labels: p1, p2Labels: p2, p1Choices: p1.map(label => `c:${label}`), p2Choices: p2.map(label => `c:${label}`),
    values, mixes: { p1: [], p2: [] }, ...(cells ? { cells } : {}),
  };
  return {
    score: 0, interval: 0, depthCompleted: 1, matrix,
    perSide: { p1: p1.map(label => ranked(`c:${label}`, label, p2[0])), p2: p2.map(label => ranked(`c:${label}`, label, p1[0])) },
  };
}

describe('worstAnswer', () => {
  const values = [[0.2, -0.4, 0.1], [0.5, 0.3, -0.1]];

  test('p1 reads the lowest cell of its row', () => {
    const result = board(values, [[solid, solid, solid], [solid, solid, solid]]);
    expect(worstAnswer(result, 'p1', result.perSide.p1[0])).toEqual({ label: 'Moonblast', choice: 'c:Moonblast', basis: 'cell' });
    expect(worstAnswer(result, 'p1', result.perSide.p1[1])).toEqual({ label: '→ Mew', choice: 'c:→ Mew', basis: 'cell' });
  });

  test('p2 reads the highest cell of its column, the p1 maximum', () => {
    const result = board(values, [[solid, solid, solid], [solid, solid, solid]]);
    expect(worstAnswer(result, 'p2', result.perSide.p2[0])).toEqual({ label: 'Ice Beam', choice: 'c:Ice Beam', basis: 'cell' });
    expect(worstAnswer(result, 'p2', result.perSide.p2[2])).toEqual({ label: 'Surf', choice: 'c:Surf', basis: 'cell' });
  });

  test('a lower cell nobody tested is skipped; a verified one counts at one visit', () => {
    const guess = board(values, [[solid, thin, solid], [solid, solid, solid]]);
    expect(worstAnswer(guess, 'p1', guess.perSide.p1[0])).toEqual({ label: '→ Mew', choice: 'c:→ Mew', basis: 'cell' });
    const checked = board(values, [[solid, verified, solid], [solid, solid, solid]]);
    expect(worstAnswer(checked, 'p1', checked.perSide.p1[0])?.label).toBe('Moonblast');
  });

  test('a result without cell statistics (a matrix pass) counts every cell', () => {
    const result = board(values);
    expect(worstAnswer(result, 'p1', result.perSide.p1[0])).toEqual({ label: 'Moonblast', choice: 'c:Moonblast', basis: 'cell' });
  });

  test('a row with no trusted cell falls back to its own floor, then to none', () => {
    const result = board(values, [[thin, thin, thin], [thin, thin, thin]]);
    expect(worstAnswer(result, 'p1', result.perSide.p1[0])).toEqual({ label: 'Draining Kiss', choice: 'c:Draining Kiss', basis: 'punisher' });
    const bare = { ...result, perSide: { p1: [ranked('c:Surf', 'Surf')], p2: result.perSide.p2 } };
    expect(worstAnswer(bare, 'p1', bare.perSide.p1[0])).toBeNull();
  });

  test('a waiting side is no answer; an answer the ranked list lacks is skipped', () => {
    const waits = board([[0.2, -0.4]], [[solid, solid]], ['Surf'], ['wait', 'Moonblast']);
    expect(worstAnswer(waits, 'p1', waits.perSide.p1[0])?.label).toBe('Moonblast');
    const pruned = board(values, [[solid, solid, solid], [solid, solid, solid]]);
    pruned.perSide.p2 = pruned.perSide.p2.filter(row => row.label !== 'Moonblast');
    expect(worstAnswer(pruned, 'p1', pruned.perSide.p1[0])?.label).toBe('→ Mew');
  });

  test('doubles: a joint answer is one column like any other', () => {
    const p1 = ['Fake Out + Spore', 'Flare Blitz + Spore'];
    const p2 = ['Close Combat + Protect', 'Sucker Punch + Spore'];
    const result = board([[0.3, -0.2], [0.1, 0.0]], [[solid, solid], [solid, solid]], p1, p2);
    expect(worstAnswer(result, 'p1', result.perSide.p1[0])).toEqual({ label: 'Sucker Punch + Spore', choice: 'c:Sucker Punch + Spore', basis: 'cell' });
    expect(worstAnswer(result, 'p2', result.perSide.p2[1])).toEqual({ label: 'Flare Blitz + Spore', choice: 'c:Flare Blitz + Spore', basis: 'cell' });
  });
});
