import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test, vi } from 'vitest';
import { FIXTURES, rebuild } from './forced-reconstruction-support';

/**
 * Round 86 (the engine reads the dice), lane B, step B12 (T306): the rebuild answers a forced replacement and waits for the simulator's
 * next move. When the simulator asks for another replacement at once (the replacement faints on entry to hazards; a Volt Switch chain;
 * a double faint in doubles), the old wait held for none of its conditions and ran to its 1.5 s timeout. The wait now also ends when
 * either side holds a new request object. Round 86's B11 found five such timeouts in the twelve fixtures (653785 turn 22, 573756
 * turn 40, 912045 turn 5, 2663093831 turn 1, 2630685175 turn 2). The rows rebuild through the log's last turn, the way the timing
 * probe does (the drift line's 356 turns stop before the last block).
 */

const waits = vi.hoisted(() => ({ calls: 0, timeouts: 0 }));

vi.mock('../../packages/eval-engine/src/branch/runtime-session.ts', async importOriginal => {
  const actual = await importOriginal<typeof import('../../packages/eval-engine/src/branch/runtime-session.ts')>();
  return {
    ...actual,
    // a wait timed out when its predicate still fails after the wait returned
    waitForBattle: async (...args: Parameters<typeof actual.waitForBattle>) => {
      await actual.waitForBattle(...args);
      const battle = args[0].battleStream.battle;
      waits.calls++;
      if (!(battle && args[1](battle))) waits.timeouts++;
    },
  };
});

/** The log's last `|turn|` line: the rebuild plays every block, the last one included. */
const lastTurnOf = (id: string): number => {
  const { log } = JSON.parse(readFileSync(join('test', 'e2e-feedback', 'fixtures', `${id}.json`), 'utf-8')) as { log: string };
  return Number([...log.matchAll(/^\|turn\|(\d+)/gm)].pop()![1]);
};

const ROWS = [
  { id: 'smogtours-gen6ou-653785', what: 'a replacement that faints on entry to Stealth Rock and Spikes' },
  { id: 'smogtours-gen9doublesou-912045', what: 'a double faint, two requests in a row (turn 5)' },
] as const;

describe('the rebuild does not wait out its timeout for a second forced replacement', () => {
  test.each(ROWS)('$id: $what', { timeout: 120_000 }, async ({ id }) => {
    waits.timeouts = 0;
    await rebuild(id, { through: lastTurnOf(id), bare: true });
    expect(waits.timeouts).toBe(0);
  });

  // singles (Gen 6, 8, Champions), Doubles OU and VGC (Scarlet/Violet, Champions): every rule set the corpus plays, bare (the timing probe's
  // path) and with the position capture the sweeps of the app use
  test.each(FIXTURES.flatMap(fixture => [false, true].map(captured => [fixture.id, fixture.type, captured ? 'captured' : 'bare'] as const)))(
    '%s (%s, %s): no wait runs to its timeout', { timeout: 180_000 }, async (id, _type, mode) => {
      waits.timeouts = 0;
      waits.calls = 0;
      await rebuild(id, { through: lastTurnOf(id), bare: mode === 'bare' });
      expect(waits.calls).toBeGreaterThan(0);
      expect(waits.timeouts).toBe(0);
    },
  );
});
