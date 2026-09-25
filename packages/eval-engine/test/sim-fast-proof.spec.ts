import { expect, test } from 'vitest';
import { advancePositionWithLog, createRootPosition, legalChoices } from '../src/forward-model';
import { parseSimFastSwitch, SIM_FAST_DEFAULT, takeSimFastReport } from '../src/forward/sim-fast/state';
import { loadPositions, SEEDS } from './sim-fast-helpers';

// Round 59: the layer proof for a whole-suite run. It reads the switch the process was started with.
test('the layer runs exactly as the environment says', () => {
  const levers = parseSimFastSwitch(process.env.EVAL_SIM_FAST) ?? SIM_FAST_DEFAULT;
  takeSimFastReport();
  const root = createRootPosition(loadPositions()[0].serialized);
  const [a] = legalChoices(root, 'p1');
  const [b] = legalChoices(root, 'p2');
  advancePositionWithLog(root, a.choice, b.choice, SEEDS[0]);
  advancePositionWithLog(root, a.choice, b.choice, SEEDS[1]);
  const report = takeSimFastReport();
  console.log(`SIM_FAST_PROOF ${process.env.EVAL_SIM_FAST ?? '-'} ${JSON.stringify(report)}`);
  expect(report.status).toBe(levers.length > 0 ? 'active' : 'off');
  expect(report.counters.ruleTables > 0).toBe(levers.includes('rules'));
  expect(report.counters.clones > 0).toBe(levers.includes('clone'));
  expect(report.counters.dispatchAnswered > 0).toBe(levers.includes('dispatch'));
});
