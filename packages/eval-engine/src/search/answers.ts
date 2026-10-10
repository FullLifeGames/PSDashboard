import { rankFromMatrix } from '../rank.ts';
import { attachKoOdds, koOddsMapsFor } from './root-payload.ts';
import type { EvalCellJob, EvalCellValue, EvalChoiceOption, EvalResult, MctsTreeStats, RankedChoice } from '../types.ts';

/**
 * Round 67 (T128): the doubles root's answer round. The tree lists 16
 * combos per side (the hint cut of search/options.ts), so a best row can
 * read 1.00 against every listed answer while an unlisted legal answer
 * refutes it (VGC 2630685175 t7: Wood Hammer + Earth Power against the 12
 * listed p2 combos; each of Zamazenta's six Protect answers holds it near
 * 0.75). After the verify round each side is graded against the other
 * side's legal answers: 'protect' prices the side's best row against every
 * legal answer for one natural draw and adds the answers that beat the
 * listed ones by more than ANSWER_MARGIN (at most ANSWER_CAP), 'full' adds
 * every unlisted legal answer. An added answer is priced for every listed
 * row of the graded side by one natural draw, and the side's ranking is
 * solved over its listed rows against the listed and the added answers.
 * The answers come from the simulator's legal list (legalChoices), never a
 * hand list. The score stays the visit mean; the rankings read the answers.
 * Pure and sim-free, like the merge.
 */

export type AnswersMode = 'protect' | 'full' | 'off';
/** One-ply margin by which an unlisted answer must beat the listed ones against the best row. */
export const ANSWER_MARGIN = 0.05;
/** Answers 'protect' adds per graded side. */
export const ANSWER_CAP = 4;

const nodeEnv = (): string | undefined =>
  (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.EVAL_DOUBLES_ANSWERS;

/** The form of the answer round: EVAL_DOUBLES_ANSWERS under Node (a measurement switch, no UI knob), 'protect' otherwise; a typo throws. */
export function answersMode(): AnswersMode {
  const raw = nodeEnv();
  if (raw === undefined || raw === '') return 'protect';
  if (raw === 'protect' || raw === 'full' || raw === 'off') return raw;
  throw new Error(`EVAL_DOUBLES_ANSWERS must be protect, full or off, got ${raw}`);
}

type SideId = 'p1' | 'p2';

/** One graded side: its listed rows and the other side's answers, listed first, then the unlisted legal ones. */
export interface AnswerSide {
  side: SideId;
  rows: EvalChoiceOption[];
  answers: EvalChoiceOption[];
  listed: number;
}

/** Each side graded against the other side's legal answers; null where the tree shipped no legal lists (singles) or the result has no matrix. */
export function answerSides(tree: MctsTreeStats, result: EvalResult): AnswerSide[] | null {
  const matrix = result.matrix;
  if (!tree.p1Legal || !tree.p2Legal || !matrix?.p1Choices || !matrix.p2Choices) return null;
  const listed = (choices: string[], labels: string[]) => choices.map((choice, index) => ({ choice, label: labels[index] }));
  const p1Listed = listed(matrix.p1Choices, matrix.p1Labels);
  const p2Listed = listed(matrix.p2Choices, matrix.p2Labels);
  const unlisted = (legal: EvalChoiceOption[], shown: EvalChoiceOption[]) => {
    const seen = new Set(shown.map(option => option.choice));
    return legal.filter(option => !seen.has(option.choice));
  };
  return [
    { side: 'p1', rows: p1Listed, answers: [...p2Listed, ...unlisted(tree.p2Legal, p2Listed)], listed: p2Listed.length },
    { side: 'p2', rows: p2Listed, answers: [...p1Listed, ...unlisted(tree.p1Legal, p1Listed)], listed: p1Listed.length },
  ];
}

/** A plain cell job of the graded side: its row `row` against answer `answer` (indices into rows and answers). */
function job(view: AnswerSide, row: number, answer: number): EvalCellJob {
  const own = view.rows[row].choice;
  const theirs = view.answers[answer].choice;
  return view.side === 'p1'
    ? { i: row, j: answer, p1Choice: own, p2Choice: theirs, samples: 1, plain: true }
    : { i: answer, j: row, p1Choice: theirs, p2Choice: own, samples: 1, plain: true };
}

/** The row and answer indices of a value of the graded side's jobs. */
const at = (view: AnswerSide, value: EvalCellValue): { row: number; answer: number } =>
  (view.side === 'p1' ? { row: value.i, answer: value.j } : { row: value.j, answer: value.i });

/** 'protect': the graded side's best row against every answer (its index in rows; -1 when the ranking names none). */
export function detectionJobs(view: AnswerSide, result: EvalResult): EvalCellJob[] {
  const best = result.perSide[view.side][0];
  const row = best ? view.rows.findIndex(option => option.choice === best.choice) : -1;
  if (row < 0 || view.answers.length === view.listed) return [];
  return view.answers.map((_, answer) => job(view, row, answer));
}

/**
 * The answers to add: under 'full' every unlisted one; under 'protect' the
 * unlisted answers whose one-ply value against the best row lies more than
 * ANSWER_MARGIN below the listed answers' minimum (from the graded side),
 * lowest first, at most ANSWER_CAP. Indices into the view's answers.
 */
export function addedAnswers(view: AnswerSide, mode: AnswersMode, detected: EvalCellValue[]): number[] {
  const unlisted = view.answers.map((_, answer) => answer).filter(answer => answer >= view.listed);
  if (mode === 'full') return unlisted;
  const sign = view.side === 'p1' ? 1 : -1;
  const own = new Map(detected.map(value => [at(view, value).answer, sign * value.value]));
  const listedMin = Math.min(...view.answers.slice(0, view.listed).map((_, answer) => own.get(answer) ?? Infinity));
  return unlisted.filter(answer => (own.get(answer) ?? Infinity) < listedMin - ANSWER_MARGIN)
    .sort((a, b) => own.get(a)! - own.get(b)! || a - b)
    .slice(0, ANSWER_CAP);
}

/** Every listed row of the graded side against each added answer. */
export function extensionJobs(view: AnswerSide, added: number[]): EvalCellJob[] {
  return added.flatMap(answer => view.rows.map((_, row) => job(view, row, answer)));
}

/**
 * The graded side's ranking over its listed rows against the listed and the
 * added answers (p1-perspective values: the result's matrix for the listed
 * cells, the extension's values for the added ones). Fields the solve does
 * not make (kill odds, the follow-up line) carry over by choice.
 */
export function gradedRanking(view: AnswerSide, result: EvalResult, tree: MctsTreeStats, added: number[], values: EvalCellValue[]): RankedChoice[] {
  const matrix = result.matrix!;
  const extra = new Map(values.map(value => {
    const { row, answer } = at(view, value);
    return [`${row}:${answer}`, value.value];
  }));
  const answers = [...view.answers.slice(0, view.listed), ...added.map(answer => view.answers[answer])];
  const cell = (row: number, column: number): number => (column < view.listed
    ? (view.side === 'p1' ? matrix.values[row][column] : matrix.values[column][row])
    : extra.get(`${row}:${added[column - view.listed]}`) ?? (view.side === 'p1' ? matrix.values[row][0] : matrix.values[0][row]));
  const grid = view.rows.map((_, row) => answers.map((__, column) => cell(row, column)));
  const ranked = view.side === 'p1'
    ? rankFromMatrix({ p1Options: view.rows, p2Options: answers, values: grid, ended: grid.map(line => line.map(() => false)) }, tree.rootValue).p1
    : rankFromMatrix({ p1Options: answers, p2Options: view.rows, values: answers.map((_, column) => view.rows.map((__, row) => grid[row][column])), ended: answers.map(() => view.rows.map(() => false)) }, tree.rootValue).p2;
  const before = new Map(result.perSide[view.side].map(row => [row.choice, row]));
  const carried = ranked.map(row => {
    const old = before.get(row.choice);
    return old?.line ? { ...row, line: old.line } : row;
  });
  if (tree.koOdds) {
    const holder = { perSide: { p1: view.side === 'p1' ? carried : [], p2: view.side === 'p2' ? carried : [] } } as unknown as EvalResult;
    attachKoOdds(holder, koOddsMapsFor(tree.p1Options, tree.p2Options, tree.koOdds));
  }
  return carried;
}
