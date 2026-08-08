import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import { State } from '@pkmn/sim';
import { parseExportedReplay } from '../src/lib/replay-file';
import { inferReplayFormatId, getBranchSimulatorFormat } from '../src/lib/replay-format';
import { parseReplayLogWithObservations } from '../src/lib/protocol-parser';
import { buildTeamsFromReplay } from '../src/lib/team-builder';
import { reconstructBranchRuntime } from '../src/lib/branch-engine';
import { searchPosition } from '../src/lib/eval/search';
import { analyzeTurn, TIER_THRESHOLDS } from '../src/lib/eval/analysis';
import { detectSacks, parsePlayedActions, turnEvents } from '../src/lib/eval/played';
import { resolveTeraPreference } from '../src/lib/eval/tera';

/**
 * End-to-end pin of the GPL game-report findings that drove this plan:
 *  - T22: Bene's Stealth Rock must not read as a mistake (victim-aware
 *    hazards + damage-consistent spreads).
 *  - T26: Pres' Iron Jugulis sack must not read as a mistake (the coverage
 *    term prices Rhydon's irreplaceability against Salazzle).
 *  - T29: Bene's Uxie sack reads as a sacrifice, never an unpunished risk.
 *  - Clefable is not simmed with Magic Guard (it visibly took rocks chip).
 * Assertions stay coarse (tiers, flags) so weight tuning cannot break them.
 */

test.describe('GPL replay end-to-end verdicts', () => {
  test('the four findings hold on the committed fixture', async () => {
    test.setTimeout(240_000);
    const replay = parseExportedReplay(readFileSync('e2e/fixtures/gpl-replay.html', 'utf-8'), 'gpl-replay.html');
    const formatid = inferReplayFormatId(replay);
    const { snapshots, observations } = parseReplayLogWithObservations(replay.log);
    const { p1Team, p2Team } = buildTeamsFromReplay(replay.log, { observations });

    const clefable = p1Team.find(set => set.species === 'Clefable');
    expect(clefable?.ability).not.toBe('Magic Guard');

    const tera = resolveTeraPreference('auto', formatid, replay.log);

    const analyze = async (turn: number) => {
      const runtime = await reconstructBranchRuntime({
        format: getBranchSimulatorFormat(replay),
        p1Team, p2Team,
        replayLog: replay.log,
        targetTurn: turn,
        snapshot: snapshots[Math.min(turn - 1, snapshots.length - 1)] ?? null,
        capturePositions: {
          snapshotFor: t => snapshots[Math.min(t - 1, snapshots.length - 1)] ?? null,
          onPosition: () => {},
        },
      });
      const battle = runtime.battleStream.battle!;
      const serialized = JSON.stringify(State.serializeBattle(battle));
      const result = searchPosition(serialized, { depth: 1, samples: 1, tera });
      const events = turnEvents(replay.log, turn);
      return analyzeTurn({
        turn,
        result,
        played: parsePlayedActions(events),
        playedOutcome: null,
        scoreBefore: result.score,
        scoreAfter: null,
        sacks: detectSacks(events, snapshots[turn - 1] ?? null),
      });
    };

    const t22 = await analyze(22);
    // Stealth Rock into a rock-weak roster is not a mistake.
    expect(t22.p1.regret === null || t22.p1.regret < TIER_THRESHOLDS.mistake ||
      t22.p1.tier === 'inaccuracy' || t22.p1.tier === undefined).toBe(true);

    const t26 = await analyze(26);
    // Sacking the redundant Jugulis (keeping Rhydon for Salazzle) is not a
    // mistake once coverage prices the sole answer.
    expect(t26.p2.tier === undefined || t26.p2.tier === 'inaccuracy' || !!t26.p2.sacrifice).toBe(true);

    const t29 = await analyze(29);
    // Feeding a 9%-HP Uxie is a sacrifice, not a risk.
    expect(t29.p1.riskUnpunished).toBeFalsy();
    if (t29.p1.tier) expect(t29.p1.sacrifice).toBeTruthy();
  });
});
