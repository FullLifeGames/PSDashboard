import type { EvalWorkerClient } from '../../src/lib/eval/worker-client';
import type { GraphSweepParams } from '../../src/hooks/evaluation/sweep-types';
import type { EvaluateParams } from '../../src/hooks/evaluation/single-eval';

declare const client: EvalWorkerClient;
void client.evaluate('{}', { depth: 1, samples: 1, ruleset: 'standard' });
void client.evalPair('{}', 'move 1', 'move 1', { depth: 2, samples: 1, mode: 'mcts', ruleset: 'champions' });
// @ts-expect-error the settings need a rule set
void client.evaluate('{}', { depth: 1, samples: 1 });
// @ts-expect-error the settings need a rule set
void client.evalPair('{}', 'move 1', 'move 1', { depth: 2, samples: 1, mode: 'mcts' });

type Without<T> = Omit<T, 'ruleset'>;
declare const sweep: Without<GraphSweepParams>;
declare const single: Without<EvaluateParams>;
// @ts-expect-error a sweep needs a rule set
export const a: GraphSweepParams = sweep;
// @ts-expect-error an evaluation needs a rule set
export const b: EvaluateParams = single;
