import { afterEach, describe, expect, test } from 'vitest';
import { emittedBlock, rebuild } from './forced-reconstruction-support';

const orderOf = (lines: string[]): string[] => lines.filter(line => /^\|(move|cant)\|/.test(line)).slice(0, 4);

// The guard reads `EVAL_ASK_CHECK` at each call and `setAskCheck` is no barrel export, so the row sets the variable.
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

  test('the same rebuild with the development check on raises no AskLeak', { timeout: 180_000 }, async () => {
    process.env.EVAL_ASK_CHECK = '1';
    const built = await rebuild('gen9vgc2026regi-2630685175', { bare: true });
    expect(orderOf(emittedBlock(built.battleLog, 5))).toEqual(orderOf(built.logBlock(5)));
  });
});
