import { afterEach, describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { createLocalTreeExecutor, searchTreesOrchestrated } from '../src/tree-orchestrator';
import { matchPlayedSide } from '../src/turn-analysis/played-match';
import { analyzeTurn } from '../src/analysis';
import type { PlayedTurn } from '../src/played';
import {
  addedAnswers, ANSWER_CAP, ANSWER_MARGIN, answerSides, answersMode, confirmedAnswers, confirmJobs, detectionJobs, extensionJobs, gradedRanking,
  type AnswerSide,
} from '../src/search/answers';
import type { StaticRuleset } from '../src/eval-function';
import type { EvalCellValue, EvalResult, EvalSettings, MctsTreeStats } from '../src/types';

/**
 * Round 67 (T128): the doubles matrix grades each side against every legal
 * answer of the other side. VGC 2630685175 t7: the tree lists 12 p2 combos,
 * none with Zamazenta's Protect, so Wood Hammer + Earth Power read 1.00 in
 * every column and p1's played U-turn + Tera Starstorm took a mistake of
 * regret 1.233; over every legal answer the line holds about 0.75 (round 64
 * column-cut probe). The regret grades against p2's equilibrium over every
 * answer, so it can move either way once the Protect answers count.
 */

interface Position {
  serialized: string; tera: EvalSettings['tera']; sleepClause: boolean; ruleset: StaticRuleset; keepPlayed: NonNullable<EvalSettings['keepPlayed']>;
  turn?: number; played?: PlayedTurn; sacks?: Parameters<typeof analyzeTurn>[0]['sacks'];
}

const fixture = (name: string): Position =>
  JSON.parse(readFileSync(new URL(`./fixtures/positions/${name}.json`, import.meta.url), 'utf-8')) as Position;

const search = (position: Position): Promise<EvalResult> =>
  searchTreesOrchestrated(createLocalTreeExecutor(position.serialized, position.ruleset), {
    depth: 1, samples: 1, mode: 'mcts', tera: position.tera, sleepClause: position.sleepClause, ruleset: position.ruleset, keepPlayed: position.keepPlayed,
  });

const saved = process.env.EVAL_DOUBLES_ANSWERS;
afterEach(() => {
  if (saved === undefined) delete process.env.EVAL_DOUBLES_ANSWERS;
  else process.env.EVAL_DOUBLES_ANSWERS = saved;
});

describe('the doubles matrix reads every answer (round 67, T128)', () => {
  test('2630685175 t7: p1’s best row meets a Protect answer the tree did not list, and p1 is graded against it', { timeout: 120_000 }, async () => {
    const position = fixture('gen9vgc2026regi-2630685175-t7-played');
    const result = await search(position);
    const best = result.perSide.p1[0];
    expect(best.worstCase).toBeLessThanOrEqual(0.8);
    expect(best.punishedBy).toMatch(/Protect/);
    expect(result.matrix!.p2Labels).not.toContain(best.punishedBy);
    const played = matchPlayedSide(result, 'p1', { p1: null, p2: null, p1Slots: position.keepPlayed.p1Slots, p2Slots: position.keepPlayed.p2Slots });
    expect(played).not.toBeNull();
  });

  test('2630685175 t8: a double Protect that only stalls answers nothing, and the played Taunt stays the mistake (user truth pin)', { timeout: 180_000 }, async () => {
    // At one ply p1’s Protect + Protect read -0.16 for p2, the board’s static after a stalled turn, where the trees
    // read +0.84; one ply deeper it reads +0.87, like the listed answers (probe lanes/B/t128-pin). An answer counts
    // only when it still refutes the best row one ply deeper.
    const position = fixture('gen9vgc2026regi-2630685175-t8');
    const result = await search(position);
    const best = result.perSide.p2[0];
    expect(best.label).toMatch(/^Astral Barrage/);
    expect(best.ev).toBeGreaterThan(0.8);
    const analysis = analyzeTurn({
      turn: position.turn!, result, played: position.played!, playedOutcome: null, scoreBefore: result.score, scoreAfter: null, sacks: position.sacks!,
    });
    expect(analysis.p2.played?.label).toMatch(/^Taunt/);
    expect(analysis.p2.tier).toBe('mistake');
  });

  test('a singles root has no answer round', { timeout: 120_000 }, async () => {
    const position = fixture('smogtours-gen6ou-649664-t14-g1');
    const withRound = await search(position);
    process.env.EVAL_DOUBLES_ANSWERS = 'off';
    expect(await search(position)).toEqual(withRound);
  });

  test('the switch names its forms and refuses a typo', () => {
    delete process.env.EVAL_DOUBLES_ANSWERS;
    expect(answersMode()).toBe('protect');
    process.env.EVAL_DOUBLES_ANSWERS = 'full';
    expect(answersMode()).toBe('full');
    process.env.EVAL_DOUBLES_ANSWERS = 'protekt';
    expect(() => answersMode()).toThrow(/protect, full or off/);
  });
});

/** A two-by-two doubles root with two more legal p2 answers the tree did not list. */
function scene(): { tree: MctsTreeStats; result: EvalResult; view: AnswerSide } {
  const p1 = [{ choice: 'move a 1, move b 1', label: 'A + B' }, { choice: 'move c 1, move d 1', label: 'C + D' }];
  const p2 = [{ choice: 'move x 1, move y 1', label: 'X + Y' }, { choice: 'move x 2, move y 2', label: 'X2 + Y2' }];
  const p2Legal = [...p2, { choice: 'move protect, move protect', label: 'Protect + Protect' }, { choice: 'move z 1, move y 1', label: 'Z + Y' }];
  const tree = { p1Options: p1, p2Options: p2, p1Legal: p1, p2Legal, rootValue: 0, koOdds: undefined } as unknown as MctsTreeStats;
  const result = {
    score: 0.5, interval: 0, depthCompleted: 1,
    perSide: { p1: [{ choice: p1[0].choice, label: p1[0].label, ev: 1, worstCase: 1, expected: 1, punishedBy: 'X + Y' }], p2: [] },
    matrix: { p1Labels: p1.map(o => o.label), p2Labels: p2.map(o => o.label), p1Choices: p1.map(o => o.choice), p2Choices: p2.map(o => o.choice), values: [[1, 1], [1, 1]], mixes: { p1: [0.5, 0.5], p2: [0.5, 0.5] } },
  } as unknown as EvalResult;
  const view = answerSides(tree, result)!.find(side => side.side === 'p1')!;
  return { tree, result, view };
}

describe('the answer round, step by step (round 67, T128)', () => {
  test('the answers are the listed ones, then the unlisted legal ones; a side without legal lists has no round', () => {
    const { tree, result, view } = scene();
    expect(view.answers.map(answer => answer.label)).toEqual(['X + Y', 'X2 + Y2', 'Protect + Protect', 'Z + Y']);
    expect(view.listed).toBe(2);
    expect(answerSides({ ...tree, p1Legal: undefined, p2Legal: undefined }, result)).toBeNull();
  });

  test('protect adds the answers that beat the listed ones against the best row; full adds every unlisted one', () => {
    const { view, result } = scene();
    const jobs = detectionJobs(view, result);
    expect(jobs.map(job => job.p2Choice)).toEqual(view.answers.map(answer => answer.choice));
    expect(jobs.every(job => job.plain && job.i === 0)).toBe(true);
    const value = (j: number, v: number): EvalCellValue => ({ i: 0, j, value: v, ended: false });
    const detected = [value(0, 1), value(1, 0.98), value(2, 0.75), value(3, 0.98 - ANSWER_MARGIN / 2)];
    expect(addedAnswers(view, 'protect', detected)).toEqual([2]);
    expect(addedAnswers(view, 'full', detected)).toEqual([2, 3]);
    expect(ANSWER_CAP).toBeGreaterThan(0);
  });

  test('protect keeps a candidate only when it still refutes the best row one ply deeper', () => {
    const { view, result } = scene();
    const deepen: EvalSettings = { depth: 1, samples: 1, tera: false };
    const jobs = confirmJobs(view, result, [2, 3], deepen);
    expect(jobs.map(job => [job.p1Choice, job.p2Choice, job.settings])).toEqual([
      ['move a 1, move b 1', 'move protect, move protect', deepen], ['move a 1, move b 1', 'move z 1, move y 1', deepen],
    ]);
    // The best row reads 1.00 against the listed answers: one ply deeper Protect + Protect holds it to 0.3 (kept),
    // Z + Y only to 1 - ANSWER_MARGIN / 2 (dropped: the one-ply refutation does not survive the deeper search).
    const deep = (score: number) => ({ score, interval: 0, depthCompleted: 1, perSide: { p1: [], p2: [] } }) as EvalResult;
    expect(confirmedAnswers(view, result, [2, 3], [deep(0.3), deep(1 - ANSWER_MARGIN / 2)])).toEqual([2]);
  });

  test('the graded side ranks against the added answer, priced for every listed row', () => {
    const { view, result, tree } = scene();
    const jobs = extensionJobs(view, [2]);
    expect(jobs.map(job => [job.i, job.j])).toEqual([[0, 2], [1, 2]]);
    // Both rows read 1.00 against the listed answers; the added Protect answer holds A + B to 0.1 and C + D to 0.5.
    const ranked = gradedRanking(view, result, tree, [2], [{ i: 0, j: 2, value: 0.1, ended: false }, { i: 1, j: 2, value: 0.5, ended: false }]);
    const byLabel = new Map(ranked.map(row => [row.label, row]));
    expect(byLabel.get('A + B')!.worstCase).toBeCloseTo(0.1, 12);
    expect(byLabel.get('A + B')!.punishedBy).toBe('Protect + Protect');
    expect(byLabel.get('C + D')!.worstCase).toBeCloseTo(0.5, 12);
    expect(ranked[0].label).toBe('C + D');
  });
});
