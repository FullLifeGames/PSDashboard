import {
  AUTO_MCTS_FAINTED_FRACTION, createLocalTreeExecutor, searchPosition, searchTreesOrchestrated,
  type EvalResult, type EvalSettings,
} from '@fulllifegames/eval-engine';

/**
 * Round 61: the bank's search, the app's dispatch. Below the auto threshold
 * the sync matrix search (parity with the app's orchestrated matrix is
 * pinned by eval-orchestrator.spec.ts); at or above it the app's tree
 * search (searchTreesOrchestrated: four trees, verify, prover) over an
 * in-process executor. Before round 61 the bank ran one tree without
 * verify (mctsSearch).
 */
export interface BankSearchInput {
  serialized: string;
  faintedFraction: number;
  depth: 1 | 2 | 3;
  samples: 1 | 3 | 5;
  /** EVAL_CALIBRATION_MODE: 'auto' mirrors the app, 'mcts' forces the tree, anything else the matrix. */
  mode: string | undefined;
  settings: Omit<EvalSettings, 'depth' | 'samples' | 'mode'>;
}

export function bankSearch(input: BankSearchInput): Promise<EvalResult> {
  const { serialized, faintedFraction, depth, samples, mode, settings } = input;
  const tree = mode === 'mcts' || (mode === 'auto' && faintedFraction >= AUTO_MCTS_FAINTED_FRACTION);
  if (tree) return searchTreesOrchestrated(createLocalTreeExecutor(serialized), { ...settings, depth: 1, samples: 1, mode: 'mcts' });
  return Promise.resolve(searchPosition(serialized, { ...settings, depth, samples }));
}

/** EVAL_CALIBRATION_SAMPLES: the engine has five fixed seeds; another count would draw an unseeded PRNG. */
export function bankSampleCount(raw: string | undefined): 1 | 3 | 5 {
  const count = raw === undefined || raw === '' ? 1 : Number(raw);
  if (count !== 1 && count !== 3 && count !== 5) throw new Error(`EVAL_CALIBRATION_SAMPLES must be 1, 3 or 5, got ${raw}`);
  return count;
}
