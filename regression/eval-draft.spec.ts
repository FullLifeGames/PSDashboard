import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import { State } from '@pkmn/sim';
import { inferReplayFormatId, getBranchSimulatorFormat } from '../src/lib/replay-format';
import { parseReplayLogWithObservations } from '../src/lib/protocol-parser';
import { buildTeamsFromReplay } from '../src/lib/team-builder';
import { reconstructBranchRuntime } from '../src/lib/branch-engine';
import { searchPosition } from '../src/lib/eval/search';
import { TIE_EPSILON } from '../src/lib/eval/rank';
import { resolveTeraPreference } from '../src/lib/eval/tera';

/**
 * End-to-end pin of the draft-replay T50 finding (the default app replay,
 * committed as a fixture): burned Cryogonal recovering into Kyurem's Iron
 * Head 2HKO ties the Heatran switch by equilibrium EV — the static matrix
 * cannot split a coin flip. The horizon-trend tiebreak must surface the
 * switch: its decisive cells BUILD under one ply of lookahead (Heatran walls
 * Iron Head and takes over), while the Recover stall BLEEDS (out-healed,
 * losing ground every ply actually searched). Assertions stay coarse — the
 * tie itself plus the ordering — so weight tuning cannot break them.
 */

test.describe('draft replay end-to-end verdicts', () => {
  test('T50: the trend tiebreak surfaces the Heatran switch over the Recover stall', async () => {
    test.setTimeout(240_000);
    const replay = JSON.parse(readFileSync('e2e/fixtures/draft-replay.json', 'utf-8')) as {
      id: string; log: string; players: string[];
    };
    const formatid = inferReplayFormatId(replay);
    const { snapshots, observations } = parseReplayLogWithObservations(replay.log);
    const { p1Team, p2Team } = buildTeamsFromReplay(replay.log, { observations });
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

    const result = searchPosition(serialized, { depth: 1, samples: 1, tera });
    const p2 = result.perSide.p2;
    // Find by label, not slot number — bench slots are a reconstruction
    // detail; the pin is about WHICH Pokémon leads the ranking.
    const recover = p2.find(choice => choice.choice === 'move recover')!;
    const heatran = p2.find(choice => choice.label === '→ Heatran')!;
    expect(recover).toBeTruthy();
    expect(heatran).toBeTruthy();

    // The tie is real — if these ever separate by more than the epsilon the
    // tiebreak no longer decides this position and the pin must be rethought.
    expect(Math.abs(recover.ev - heatran.ev)).toBeLessThanOrEqual(TIE_EPSILON);
    // The switch leads the report; the stall no longer shades it out.
    expect(p2[0].label).toBe('→ Heatran');
    expect(p2.indexOf(heatran)).toBeLessThan(p2.indexOf(recover));
  });
});
