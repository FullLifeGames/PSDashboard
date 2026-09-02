import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import { State } from '@pkmn/sim';
import { parseExportedReplay } from '../src/lib/replay-file';
import { formatEnforcesSleepClause, inferReplayFormatId, getBranchSimulatorFormat } from '../packages/replay-core/src/replay-format';
import { parseReplayLogWithObservations } from '../packages/replay-core/src/protocol-parser';
import { buildTeamsFromReplay } from '../packages/replay-core/src/team-builder';
import { reconstructBranchRuntime } from '../packages/eval-engine/src/branch-engine';
import { searchPosition } from '../packages/eval-engine/src/search';
import { analyzeTurn, TIER_THRESHOLDS } from '../packages/eval-engine/src/analysis';
import { detectSacks, parsePlayedActions, turnEvents } from '../packages/eval-engine/src/played';
import { resolveTeraPreference } from '../packages/eval-engine/src/tera';

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
    const { snapshots, observations, speedOrders } = parseReplayLogWithObservations(replay.log);
    const { p1Team, p2Team } = buildTeamsFromReplay(replay.log, { observations, speedOrders });

    const clefable = p1Team.find(set => set.species === 'Clefable');
    expect(clefable?.ability).not.toBe('Magic Guard');

    const tera = resolveTeraPreference('auto', formatid, replay.log);

    const scoreByTurn = new Map<number, number>();
    const analyze = async (turn: number, scoreAfter: number | null = null) => {
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
      const sleepClause = formatEnforcesSleepClause(getBranchSimulatorFormat(replay));
      const result = searchPosition(serialized, { depth: 1, samples: 1, tera, sleepClause });
      scoreByTurn.set(turn, result.score);
      const events = turnEvents(replay.log, turn);
      return analyzeTurn({
        turn,
        result,
        played: parsePlayedActions(events),
        playedOutcome: null,
        scoreBefore: result.score,
        scoreAfter,
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

    // T38/T39 — the graph's tail: correction drift left p2.pokemonLeft high
    // and Rhydon's isActive false, the search threw on both turns, and the
    // graph ended at T37 (user report). Both evaluate now, decisively for
    // the winner mopping up.
    await analyze(38);
    await analyze(39);
    expect(scoreByTurn.get(38)!).toBeGreaterThan(0);
    expect(scoreByTurn.get(39)!).toBeGreaterThan(0);

    // T14: Cobalion was KO'd before it ever acted — the side prices through
    // the charitable stay-in phantom instead of reading "unclear (a choice
    // never surfaced)" (same shape as T36).
    const t14 = await analyze(14);
    expect(t14.p2.neverActed).toBe(true);
    expect(t14.p2.played?.label).toContain('stayed in');

    // T35: the WINNER feeds a healthy Salazzle into Knock Off while the
    // engine calls the game decisively won on both sides of the sack
    // (probe: 83% before, 71% after; with the body deleted outright p1
    // still sits at 72% — the value was surplus headroom). Simplification
    // framing, never a mistake-tier misplay.
    await analyze(36);
    const t35 = await analyze(35, scoreByTurn.get(36) ?? null);
    expect(t35.p1.sacrifice).toBeTruthy();
    expect(t35.p1.sacrifice?.healthy).toBe(true);
    expect(t35.p1.tier === undefined || t35.p1.tier === 'inaccuracy').toBe(true);

    // T25 (pivot pairs): the ranked lists enumerate "U-turn → X" as
    // first-class choices on the real reconstruction — the finding was that
    // the engine could not say WHICH incoming mon makes the pivot safe.
    const t25runtime = await reconstructBranchRuntime({
      format: getBranchSimulatorFormat(replay),
      p1Team, p2Team,
      replayLog: replay.log,
      targetTurn: 25,
      snapshot: snapshots[24] ?? null,
    });
    const t25result = searchPosition(
      JSON.stringify(State.serializeBattle(t25runtime.battleStream.battle!)),
      { depth: 1, samples: 1, tera, sleepClause: formatEnforcesSleepClause(getBranchSimulatorFormat(replay)) },
    );
    const pairRows = [...t25result.perSide.p1, ...t25result.perSide.p2]
      .filter(row => row.choice.includes(' > switch '));
    expect(pairRows.length).toBeGreaterThan(0);
    for (const row of pairRows) expect(row.label).toContain(' → ');
    // The pair rows are real ranked entries with their own values.
    for (const row of pairRows) expect(Number.isFinite(row.ev)).toBe(true);
  });
});
