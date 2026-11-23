import { test, expect, describe } from 'vitest';
import { readFileSync } from 'fs';
import { State } from '@pkmn/sim';
import { formatEnforcesSleepClause, inferReplayFormatId, getBranchSimulatorFormat, parseReplayLogWithObservations, buildTeamsFromReplay } from '@fulllifegames/replay-core';
import { reconstructBranchRuntime } from '../src/branch-engine';
import { searchPosition } from '../src/search';
import { resolveTeraPreference } from '../src/tera';

/**
 * The draft replay's Cryogonal finding (the default app replay, committed as a fixture): burned Cryogonal recovering into Kyurem's
 * Iron Head 2HKO ties the Heatran switch by static equilibrium EV, which the fixed horizon cannot split. The horizon-trend layers
 * must surface the switch: its decisive cells build under one ply of lookahead (Heatran walls Iron Head and takes over) while the
 * Recover stall bleeds, and the trend folds into the values, so the switch leads by EV, not just tie order. Assertions stay coarse
 * (direction, ordering) so weight tuning cannot break them.
 */

describe('draft replay end-to-end verdicts', () => {
  test('T50: the trend layers surface the Heatran switch over the Recover stall', { timeout: 240000 }, async () => {
    const replay = JSON.parse(readFileSync(new URL('./fixtures/draft-replay.json', import.meta.url), 'utf-8')) as {
      id: string; log: string; players: string[];
    };
    const formatid = inferReplayFormatId(replay);
    const { snapshots, observations, speedOrders } = parseReplayLogWithObservations(replay.log);
    const { p1Team, p2Team } = buildTeamsFromReplay(replay.log, { observations, speedOrders });
    const tera = resolveTeraPreference('auto', formatid, replay.log);

    const runtime = await reconstructBranchRuntime({
      format: getBranchSimulatorFormat(replay),
      p1Team, p2Team,
      replayLog: replay.log,
      targetTurn: 50,
      snapshot: snapshots[49] ?? null,
    });
    const battle = runtime.battleStream.battle!;
    const serialized = JSON.stringify(State.serializeBattle(battle));

    const settings = {
      samples: 1 as const, tera,
      sleepClause: formatEnforcesSleepClause(getBranchSimulatorFormat(replay)),
    };
    // Find by label: bench slots are a reconstruction detail.
    const rows = (depth: 1 | 2) => {
      const p2 = searchPosition(serialized, { ...settings, depth, samples: 1 }).perSide.p2;
      return {
        p2,
        recover: p2.find(choice => choice.choice === 'move recover')!,
        heatran: p2.find(choice => choice.label === '→ Heatran')!,
      };
    };

    const d1 = rows(1);
    expect(d1.recover).toBeTruthy();
    expect(d1.heatran).toBeTruthy();
    // The probe trends fold into the values under the standing equilibrium (no re-solve): the building switch leads the bleeding
    // stall by value already at depth 1.
    expect(d1.heatran.ev).toBeGreaterThan(d1.recover.ev);
    expect(d1.p2.indexOf(d1.heatran)).toBeLessThan(d1.p2.indexOf(d1.recover));

    // At depth 2 or more the stall falls below the building switch by value.
    const d2 = rows(2);
    expect(d2.heatran.ev).toBeGreaterThan(d2.recover.ev);
    // The crit-tail boundary cells around the Slowking column and the Flash Cannon row price as class means, which orders the
    // near-tied wall pair (ev gap ~0.001; the Heatran column itself carries no boundary event). Which wall leads is a coin flip: the
    // pin is that a wall switch leads and the stall sits below by value.
    expect(d2.p2[0].label).toMatch(/^→ (Heatran|Slowking)$/);
  });
});
