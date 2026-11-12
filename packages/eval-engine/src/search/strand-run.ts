import type { SideId } from '@fulllifegames/replay-core';
import { classTrusted } from '../mcts-merge.ts';
import type { OrchestratorCallbacks, SearchExecutor } from '../orchestrator.ts';
import { perfAdd, perfCount } from '../perf-trace.ts';
import { cellKey } from '../rank.ts';
import { solveMatrixGame } from '../ranking/solve.ts';
import { DECIDED_SCORE } from '../turn-analysis/types.ts';
import type { EvalCellJob, EvalCellValue, EvalChoiceOption, EvalResult, EvalSettings, MctsTreeStats, StrandProbe, StrandRecord } from '../types.ts';
import { verifyDeepen, VERIFY_SAMPLES } from '../verify-select.ts';
import { gradedGrid, type SideGrade } from './answers.ts';
import { pickStrands, screenStrands, strandCap, strandRegret, type ScreenedSide, type StrandSearch } from './strand-round.ts';

/**
 * Round 89 (T322, #59), block 2 stage 3: the strand round. After the verify and answer rounds a graded side's regret can
 * hang on one die of one cell that the verify round priced shallow (the Iron Head flinch at 30 percent). The screen
 * (strand-round.ts) names the strands that could move the grade across a tier line; this round asks the executor for one
 * strand job per cell (the cell sampled again as the verify job drew it, the named classes through the full depth-1
 * search), and writes the record the grade reads. It changes no score, matrix, ranking or game value: only `strands`.
 * A doubles side the answer round re-ranked is screened on its answered grid and the mix solved from it (the grid the
 * grade's ranking reads), a side without an added answer on the matrix and its mixes.
 */

export interface StrandRoundInput {
  trees: MctsTreeStats[];
  /** The result after the answer round: its matrix is the merged one, its rankings the answered ones. */
  result: EvalResult;
  /** The cells the verify round priced (and the re-check's), with their blends. */
  verified: ReadonlyMap<number, EvalCellValue>;
  /** The sides whose ranking the answer round replaced, with the grid it ranked. */
  answered: Partial<Record<SideId, SideGrade>>;
  /** The played option per side (indices into the root options); a side without one is not screened. */
  played: { p1?: number; p2?: number };
  settings: EvalSettings;
}

/** A side's grid in p1's view and the opponent's mix over its columns (or rows, for p2); null where the result carries none. */
function gridOf(side: SideId, input: StrandRoundInput): { values: number[][]; oppMix: number[] } | null {
  const { result, answered } = input;
  const matrix = result.matrix;
  if (!matrix) return null;
  const grade = answered[side];
  if (grade && grade.added.length > 0) {
    const { grid } = gradedGrid(grade.view, result, grade.added, grade.values);
    const values = side === 'p1' ? grid : grid[0].map((_, column) => grid.map(row => row[column]));
    const solution = solveMatrixGame(values);
    return { values, oppMix: side === 'p1' ? solution.p2Mix : solution.p1Mix };
  }
  const oppMix = side === 'p1' ? matrix.mixes.p2 : matrix.mixes.p1;
  const columns = side === 'p1' ? (matrix.values[0]?.length ?? 0) : matrix.values.length;
  return oppMix.length === columns && columns > 0 ? { values: matrix.values, oppMix } : null;
}

/** One side's screen on the grid its grade reads; null when the side was not played, or the grade names another best row than the screen. */
function screenSide(side: SideId, input: StrandRoundInput): ScreenedSide | null {
  const played = input.played[side];
  const grid = played === undefined ? null : gridOf(side, input);
  if (!grid) return null;
  const { trees, result, verified } = input;
  const screened = screenStrands({
    side, ...grid, played: played!, decided: Math.abs(result.score) >= DECIDED_SCORE, verified,
    trusted: (i, j, classKey) => {
      const blend = verified.get(cellKey(i, j))?.blend;
      return !!blend && classTrusted(trees, cellKey(i, j), blend, classKey);
    },
  });
  const own = side === 'p1' ? trees[0].p1Options : trees[0].p2Options;
  // The record belongs to the grade's own pair: a screen whose best row is not the ranking's first row would not match it.
  return screened.strands.length > 0 && result.perSide[side][0]?.choice === own[screened.B]?.choice ? screened : null;
}

/** One job per cell of the picked searches (cell order), each naming its classes: the cell is sampled once however many classes it carries. */
function strandJobs(picked: readonly StrandSearch[], trees: MctsTreeStats[], settings: EvalSettings): EvalCellJob[] {
  const deepen = verifyDeepen(settings);
  const byCell = new Map<number, EvalCellJob>();
  for (const { i, j, classKey } of [...picked].sort((a, b) => a.i - b.i || a.j - b.j)) {
    const key = cellKey(i, j);
    const job = byCell.get(key) ?? { i, j, p1Choice: trees[0].p1Options[i].choice, p2Choice: trees[0].p2Options[j].choice, samples: VERIFY_SAMPLES, deepen, strands: [] };
    job.strands!.push(classKey);
    byCell.set(key, job);
  }
  return [...byCell.values()];
}

/** The record of one side after the searches, or null when none of the side's strands came back with a value. */
function probeOf(
  screened: ScreenedSide, picked: readonly StrandSearch[], answers: ReadonlyMap<number, EvalCellValue>, trees: MctsTreeStats[],
): StrandProbe | null {
  const sign = screened.side === 'p1' ? 1 : -1;
  const own = screened.side === 'p1' ? trees[0].p1Options : trees[0].p2Options;
  const theirs = screened.side === 'p1' ? trees[0].p2Options : trees[0].p1Options;
  const searched: { strand: ScreenedSide['candidates'][number]; value: number }[] = [];
  const records: StrandRecord[] = [];
  for (const search of picked) {
    const raw = answers.get(cellKey(search.i, search.j))?.strandValues?.[search.classKey];
    if (raw === undefined) continue;
    for (const use of search.uses.filter(entry => entry.side === screened.side)) {
      const strand = screened.candidates.find(c => c.role === use.role && c.i === search.i && c.j === search.j && c.classKey === search.classKey);
      if (!strand) continue;
      searched.push({ strand, value: sign * raw });
      records.push({ role: strand.role, classKey: strand.classKey, chance: strand.w, column: (theirs[strand.column] as EvalChoiceOption).label, before: strand.q, searched: sign * raw });
    }
  }
  if (records.length === 0) return null;
  const after = strandRegret(screened, searched);
  return {
    played: own[screened.P].choice, best: own[screened.B].choice, playedEv: after.evP, bestEv: after.evB,
    regret: after.regret, regretBefore: screened.r, strands: records,
  };
}

/**
 * Round 89 (T322, #59): the strand round. Returns the record per side, or undefined when no side has a strand worth a search,
 * the executor fails, or a stop request comes (a refinement: the grade then stands as the engine read it).
 */
export async function strandRound(
  executor: Pick<SearchExecutor, 'evalCells'>, input: StrandRoundInput, callbacks?: OrchestratorCallbacks,
): Promise<EvalResult['strands'] | undefined> {
  const stopped = () => callbacks?.shouldStop?.() === true;
  if (stopped() || input.verified.size === 0 || !input.result.matrix) return undefined;
  const screens = (['p1', 'p2'] as const).map(side => screenSide(side, input)).filter((screened): screened is ScreenedSide => screened !== null);
  const picked = pickStrands(screens, strandCap(input.trees[0].p1Legal ? 'doubles' : 'singles'));
  if (picked.length === 0) return undefined;
  const started = Date.now();
  try {
    const values = await executor.evalCells(strandJobs(picked, input.trees, input.settings));
    if (stopped()) return undefined;
    perfCount('strand-searched', picked.length);
    const answers = new Map(values.map(value => [cellKey(value.i, value.j), value]));
    const probes = screens.map(screened => ({ side: screened.side, probe: probeOf(screened, picked, answers, input.trees) })).filter(entry => entry.probe !== null);
    return probes.length === 0 ? undefined : Object.fromEntries(probes.map(entry => [entry.side, entry.probe]));
  } catch {
    return undefined;
  } finally {
    perfAdd('strand-round', Date.now() - started);
  }
}
