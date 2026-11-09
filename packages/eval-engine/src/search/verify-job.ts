import type { SimPosition } from '../forward-model.ts';
import { perfCount } from '../perf-trace.ts';
import type { EvalCellJob, EvalCellValue } from '../types.ts';
import type { CellSample } from './cell-sampler.ts';
import {
  deepenVerifiedCell, strandValues, VERIFY_CHEAP, VERIFY_DEEPEN_COVER, VERIFY_LIGHT, type CheapDeepening,
} from './verify-cell.ts';

/**
 * The sub-searches a verify or strand job prices a class child with (position.ts supplies them, so this module imports no
 * search): `full` is the verify settings' own sub-search, `light` the light depth-1 one, which reports in `report.cut`
 * whether it cut either side's option list.
 */
export interface JobPrices {
  full: (child: SimPosition) => number;
  light: (child: SimPosition, report: { cut: boolean }) => number;
}

/**
 * One verify job's deepening: the heaviest outcomes through a full depth-1 sub-search, and (round 69, T148) the doubles
 * outcomes beyond the cover through a light one. The perf counters are the cost proxy of the verify round. Round 89
 * (T322, #59): the cell's classes also record how they were priced (`CellBlendClass.priced`).
 */
export function deepenVerifyJob(value: EvalCellValue, cell: CellSample, gameType: 'singles' | 'doubles', prices: JobPrices): void {
  const full = (child: SimPosition) => { perfCount('verify-sub-full'); return prices.full(child); };
  const mode = VERIFY_CHEAP[gameType];
  const report = { cut: true };
  const cheap: CheapDeepening | undefined = mode === 'off' ? undefined : {
    price: child => { perfCount('verify-sub-light'); return prices.light(child, report); },
    statesOnly: mode === 'states',
    minWeight: VERIFY_LIGHT.minWeight,
    uncut: () => !report.cut,
  };
  deepenVerifiedCell(value, cell, full, VERIFY_DEEPEN_COVER[gameType], cheap);
}

/**
 * Round 89 (T322, #59): a strand job's answer. The cell was sampled again as the verify job drew it (the seeds are fixed), so
 * the class children are the verify round's; the named classes get the full price and nothing else is deepened.
 */
export function strandCell(value: EvalCellValue, cell: CellSample, keys: readonly string[], prices: JobPrices): EvalCellValue {
  const price = (child: SimPosition) => { perfCount('strand-sub'); return prices.full(child); };
  return { i: value.i, j: value.j, value: value.value, ended: value.ended, strandValues: strandValues(value, cell, keys, price) };
}

/** A sampled root cell as the executor reports it; round 70: with the base draws the trend probe replays. */
export function cellValueOf(job: EvalCellJob, cell: CellSample): EvalCellValue {
  return {
    i: job.i, j: job.j, value: cell.value, ended: cell.ended,
    ...(cell.blend ? { blend: cell.blend } : {}),
    ...(cell.diagnostic ? { diagnostic: { ...cell.diagnostic, i: job.i, j: job.j } } : {}),
    ...(cell.baseDraws ? { baseDraws: cell.baseDraws } : {}),
  };
}
