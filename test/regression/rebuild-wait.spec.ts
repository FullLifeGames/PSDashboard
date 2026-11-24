import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test, vi } from 'vitest';
import { FIXTURES, rebuild } from './forced-reconstruction-support';

const waits = vi.hoisted(() => ({ calls: 0, timeouts: 0 }));

vi.mock('../../packages/eval-engine/src/branch/runtime-session.ts', async importOriginal => {
  const actual = await importOriginal<typeof import('../../packages/eval-engine/src/branch/runtime-session.ts')>();
  return {
    ...actual,
    waitForBattle: async (...args: Parameters<typeof actual.waitForBattle>) => {
      await actual.waitForBattle(...args);
      const battle = args[0].battleStream.battle;
      waits.calls++;
      if (!(battle && args[1](battle))) waits.timeouts++;
    },
  };
});

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
