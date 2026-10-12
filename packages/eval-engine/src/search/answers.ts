import { rankFromMatrix } from '../rank.ts';
import { PROVER_NEAR_TIE } from './forced-win-apply.ts';
import { attachKoOdds, koOddsMapsFor } from './root-payload.ts';
import type {
  EvalCellJob, EvalCellValue, EvalChoiceOption, EvalResult, EvalSettings, EvalSubSearchJob, MctsTreeStats, RankedChoice,
} from '../types.ts';

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
 * Since b4 (2630685175 t8) a 'protect' candidate counts only when it still
 * refutes the best row one ply deeper (one natural draw, a depth-1 search of
 * its child: the depth the verify round prices a cell at). At one ply a
 * stall answer reads the board's static, which can lie far from the trees'
 * value (p1's double Protect read -0.16 for p2 at one ply and +0.87 one ply
 * deeper, where every listed answer read +0.84). The added column itself
 * was priced by one natural draw: the best row's step from one ply to one
 * ply deeper does not carry to the other rows (2629703929 t8: shifted by it,
 * every p1 row fell to about -0.54 and the played row read a blunder).
 * Round 69 (T149): the three gaps of that round. Detection reads every row
 * within PROVER_NEAR_TIE of the top, up to ANSWER_NEAR_ROWS (2629703929 t4:
 * six p1 rows within 0.012, so which of them stood first, a tree's noise,
 * decided the verdict): the best row against every answer, the others
 * against the listed ones and the answers that read lowest against the best
 * row; each candidate meets the highest near row it refutes. The near rows
 * that can still decide the ranking (at most ANSWER_DEEP_ROWS) price the
 * added column one ply deeper (912045 t6: the switching row read 0.18 to
 * 0.21 by one draw, 0.03 to 0.07 one ply deeper), the other rows keep their
 * one plain draw; and a round that changes a side's best row sends the new
 * row's unverified cells through one more verify round (tree-orchestrator.ts).
 * The answers come from the simulator's legal list (legalChoices), never a
 * hand list. The score stays the visit mean; the rankings read the answers.
 * Pure and sim-free, like the merge.
 */

export type AnswersMode = 'protect' | 'full' | 'off';
/** One-ply margin by which an unlisted answer must beat the listed ones against the best row. */
export const ANSWER_MARGIN = 0.05;
/** Answers 'protect' adds per graded side. */
export const ANSWER_CAP = 4;
/** Near rows (the best and its closest ties, highest first) that detection prices against the answers. */
export const ANSWER_NEAR_ROWS = 3;
/** Unlisted answers, the lowest against the best row, that detection also prices against each other near row (the listed answers always). */
export const ANSWER_SIBLING_PROBES = 2 * ANSWER_CAP;
/** Rows (the best and its near ties, highest first) whose cells against an added answer are priced one ply deeper. */
export const ANSWER_DEEP_ROWS = 2;

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

/** A plain cell job of the graded side: its row `row` against answer `answer` (indices into rows and answers), one draw, `deepen` for one more ply. */
function job(view: AnswerSide, row: number, answer: number, deepen?: EvalSettings): EvalCellJob {
  const own = view.rows[row].choice;
  const theirs = view.answers[answer].choice;
  const cell = { samples: 1, plain: true, ...(deepen ? { deepen } : {}) };
  return view.side === 'p1'
    ? { i: row, j: answer, p1Choice: own, p2Choice: theirs, ...cell }
    : { i: answer, j: row, p1Choice: theirs, p2Choice: own, ...cell };
}

/** The row and answer indices of a value of the graded side's jobs. */
const at = (view: AnswerSide, value: EvalCellValue): { row: number; answer: number } =>
  (view.side === 'p1' ? { row: value.i, answer: value.j } : { row: value.j, answer: value.i });

/**
 * Round 69 (T149): the graded side's best row and every row within PROVER_NEAR_TIE of its ev (indices into rows), highest
 * ev first, equal evs by choice, so the order the ranking happened to list them in changes nothing.
 */
export function nearRows(view: AnswerSide, result: EvalResult): number[] {
  const ranked = result.perSide[view.side];
  if (ranked.length === 0) return [];
  const top = Math.max(...ranked.map(row => row.ev));
  return ranked.filter(row => top - row.ev <= PROVER_NEAR_TIE)
    .map(row => ({ row: view.rows.findIndex(option => option.choice === row.choice), ev: row.ev, choice: row.choice }))
    .filter(entry => entry.row >= 0)
    .sort((a, b) => b.ev - a.ev || (a.choice < b.choice ? -1 : a.choice > b.choice ? 1 : 0))
    .map(entry => entry.row);
}

/** The near rows that price an added answer one deepened ply (the best and its closest ties, at most ANSWER_DEEP_ROWS). */
export const deepRows = (view: AnswerSide, result: EvalResult): number[] => nearRows(view, result).slice(0, ANSWER_DEEP_ROWS);

/** 'protect', first stage: the best row of the graded side against every answer. */
export function detectionJobs(view: AnswerSide, result: EvalResult): EvalCellJob[] {
  const [best] = nearRows(view, result);
  if (best === undefined || view.answers.length === view.listed) return [];
  return view.answers.map((_, answer) => job(view, best, answer));
}

/**
 * 'protect', second stage (round 69, T149): the other near rows (up to ANSWER_NEAR_ROWS in all) against the listed
 * answers and against the ANSWER_SIBLING_PROBES unlisted answers that read lowest against the best row. Pricing every
 * near row against every legal answer would multiply the stage's cost by the number of near rows (2629703929 t4: six).
 */
export function siblingJobs(view: AnswerSide, result: EvalResult, first: EvalCellValue[]): EvalCellJob[] {
  const [best, ...rest] = nearRows(view, result).slice(0, ANSWER_NEAR_ROWS);
  if (best === undefined) return [];
  const sign = view.side === 'p1' ? 1 : -1;
  const probes = first.map(value => ({ answer: at(view, value).answer, own: sign * value.value }))
    .filter(entry => entry.answer >= view.listed)
    .sort((a, b) => a.own - b.own || a.answer - b.answer)
    .slice(0, ANSWER_SIBLING_PROBES)
    .map(entry => entry.answer);
  const answers = [...view.answers.slice(0, view.listed).map((_, answer) => answer), ...probes];
  return rest.flatMap(row => answers.map(answer => job(view, row, answer)));
}

/** An unlisted answer that refutes a near row at one ply, with the row it is checked against. */
export interface Refutation { answer: number; row: number }

/**
 * The unlisted answers whose one-ply value against a near row lies more than ANSWER_MARGIN below the listed answers'
 * minimum against that row (from the graded side), lowest value first, at most ANSWER_CAP. Each is checked against the
 * highest-ranked near row it refutes: a stall answer reads the board's static at one ply and can look like a refutation
 * of the best row that the deeper search takes back (2630685175 t8), so the best row decides, and a second row's one-ply
 * gap never adds an answer the best row's depth check would have dropped.
 */
export function refutations(view: AnswerSide, result: EvalResult, detected: EvalCellValue[]): Refutation[] {
  const sign = view.side === 'p1' ? 1 : -1;
  const byRow = new Map<number, Map<number, number>>();
  for (const value of detected) {
    const { row, answer } = at(view, value);
    byRow.set(row, (byRow.get(row) ?? new Map<number, number>()).set(answer, sign * value.value));
  }
  const found = new Map<number, { row: number; value: number }>();
  for (const row of nearRows(view, result)) {
    const own = byRow.get(row);
    if (!own) continue;
    const listedMin = Math.min(...view.answers.slice(0, view.listed).map((_, answer) => own.get(answer) ?? Infinity));
    for (const [answer, value] of own) {
      if (answer >= view.listed && listedMin - value > ANSWER_MARGIN && !found.has(answer)) found.set(answer, { row, value });
    }
  }
  return [...found.entries()].sort((a, b) => a[1].value - b[1].value || a[0] - b[0]).slice(0, ANSWER_CAP)
    .map(([answer, { row }]) => ({ answer, row }));
}

/** The answers to add: under 'full' every unlisted one; under 'protect' the one-ply refutations of the near rows. Indices into the view's answers. */
export function addedAnswers(view: AnswerSide, mode: AnswersMode, result: EvalResult, detected: EvalCellValue[]): number[] {
  if (mode === 'full') return view.answers.map((_, answer) => answer).filter(answer => answer >= view.listed);
  return refutations(view, result, detected).map(refutation => refutation.answer);
}

/** Each refuting answer against its near row, searched one ply deeper (the executor's sub-search). */
export function confirmJobs(view: AnswerSide, refuting: Refutation[], deepen: EvalSettings): EvalSubSearchJob[] {
  return refuting.map(({ row, answer }) => ({ ...job(view, row, answer), settings: deepen }));
}

/**
 * The answers that still refute their row one ply deeper (more than ANSWER_MARGIN below the row's listed minimum in
 * the merged matrix, from the graded side); deep[k] belongs to refuting[k].
 */
export function confirmedAnswers(view: AnswerSide, result: EvalResult, refuting: Refutation[], deep: EvalResult[]): number[] {
  const matrix = result.matrix!;
  const sign = view.side === 'p1' ? 1 : -1;
  return refuting.filter(({ row }, k) => {
    const listed = view.answers.slice(0, view.listed)
      .map((_, column) => sign * (view.side === 'p1' ? matrix.values[row][column] : matrix.values[column][row]));
    return deep[k] !== undefined && sign * deep[k].score < Math.min(...listed) - ANSWER_MARGIN;
  }).map(({ answer }) => answer);
}

/**
 * The cells the depth check already priced one ply deeper (a full depth-1 search of the draw's child): the kept answers
 * against the near rows they were checked against. The extension does not price them again.
 */
export function confirmedCells(view: AnswerSide, refuting: Refutation[], deep: EvalResult[], kept: number[]): EvalCellValue[] {
  return refuting.flatMap(({ row, answer }, k) => (kept.includes(answer) && deep[k] !== undefined
    ? [view.side === 'p1' ? { i: row, j: answer, value: deep[k].score, ended: false } : { i: answer, j: row, value: deep[k].score, ended: false }]
    : []));
}

/** Every listed row of the graded side against each added answer by one plain draw, the `deep` rows one ply deeper. */
export function extensionJobs(view: AnswerSide, added: number[], deep: number[], deepen: EvalSettings): EvalCellJob[] {
  return added.flatMap(answer => view.rows.map((_, row) => job(view, row, answer, deep.includes(row) ? deepen : undefined)));
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
