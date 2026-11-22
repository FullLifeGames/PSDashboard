import { afterEach, describe, expect, test } from 'vitest';
import { emittedBlock, rebuild } from './forced-reconstruction-support';

/**
 * Round 89 (M, fix 3 of #111): the rebuild asks the simulator for the order of a stand-in on its live battle, which it plays turn after turn,
 * so a speed read in one turn must not answer the next (`sim-ask/action-order.ts` kept it per battle and body; the unit rows are
 * `packages/eval-engine/test/action-order-stale.spec.ts`). Scene: gen9vgc2026regi-2630685175 turn 5 under Trick Room. The log has Zamazenta
 * flinch right after Fake Out and before Tera Starstorm. The cant stand-in places the flinching body by the order of the actions around it;
 * with Fake Out's user read at the speed of turn 4 (105 for 1703) no move stood behind it and the flinch came after Tera Starstorm.
 * The rebuild is the bare one (no position correction), the one `faint-step-last-first.spec.ts` pins; it is VGC, so the rows below count the
 * doubles game type that VGC plays (the singles rows are the unit spec's).
 */

const orderOf = (lines: string[]): string[] => lines.filter(line => /^\|(move|cant)\|/.test(line)).slice(0, 4);

// The guard reads `EVAL_ASK_CHECK=1` from the environment at each call (`sim-ask/guard.ts`, `askCheckOn`), so the row sets it for its own rebuild;
// a root spec reaches the package only through its barrel, and `setAskCheck` stays out of it.
const before = process.env.EVAL_ASK_CHECK;
afterEach(() => {
  if (before === undefined) delete process.env.EVAL_ASK_CHECK;
  else process.env.EVAL_ASK_CHECK = before;
});

describe('the flinch stands where the log has it', () => {
  test('gen9vgc2026regi-2630685175 turn 5 (Trick Room): Fake Out, the flinch, Tera Starstorm, Pollen Puff', { timeout: 180_000 }, async () => {
    const built = await rebuild('gen9vgc2026regi-2630685175', { bare: true });
    const logged = orderOf(built.logBlock(5));
    expect(logged.map(line => line.split('|').slice(1, 4).join('|'))).toEqual([
      'move|p1a: Rillaboom|Fake Out', 'cant|p2b: Zamazenta|flinch', 'move|p1b: TeraTurtle|Tera Starstorm', 'move|p2a: Calyrex|Pollen Puff',
    ]);
    expect(orderOf(emittedBlock(built.battleLog, 5))).toEqual(logged);
  });

  // The development check re-reads a memoized answer and throws `AskLeak` when it changed: the check that would have found the fault
  // here, had a spec of the rebuild run with it on (`sim-ask.spec.ts` runs it on, and asks no question twice on a changing body).
  test('the same rebuild with the development check on raises no AskLeak', { timeout: 180_000 }, async () => {
    process.env.EVAL_ASK_CHECK = '1';
    const built = await rebuild('gen9vgc2026regi-2630685175', { bare: true });
    expect(orderOf(emittedBlock(built.battleLog, 5))).toEqual(orderOf(built.logBlock(5)));
  });
});
