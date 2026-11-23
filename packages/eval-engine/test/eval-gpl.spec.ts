import { test, expect, describe } from 'vitest';
import { readFileSync } from 'fs';
import { State } from '@pkmn/sim';
import { type ReplayData, logRules, formatEnforcesSleepClause, inferReplayFormatId, getBranchSimulatorFormat, parseReplayLogWithObservations, buildTeamsFromReplay } from '@fulllifegames/replay-core';
import { reconstructBranchRuntime } from '../src/branch-engine';
import { searchPosition } from '../src/search';
import { analyzeTurn, TIER_THRESHOLDS } from '../src/analysis';
import { DECIDED_SCORE, HEALTHY_SACK_FLOOR } from '../src/turn-analysis/types';
import { detectSacks, parsePlayedActions, turnEvents } from '../src/played';
import { resolveTeraPreference } from '../src/tera';

/** The GPL game-report turns on the real reconstruction; assertions stay coarse (tiers, flags) so weight tuning cannot break them. */

describe('GPL replay end-to-end verdicts', () => {
  test('the four findings hold on the committed fixture', { timeout: 240000 }, async () => {
    const replay = JSON.parse(readFileSync(new URL('./fixtures/gpl-replay.json', import.meta.url), 'utf-8')) as ReplayData;
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
      const rules = logRules(replay.log);
      return analyzeTurn({
        turn,
        result,
        played: parsePlayedActions(events, rules),
        playedOutcome: null,
        scoreBefore: result.score,
        scoreAfter,
        sacks: detectSacks(events, snapshots[turn - 1] ?? null, rules),
        actives: { p1: null, p2: null, gen: rules.gen, mod: rules.mod },
      });
    };

    const t22 = await analyze(22);
    expect(t22.p1.regret === null || t22.p1.regret < TIER_THRESHOLDS.mistake ||
      t22.p1.tier === 'inaccuracy' || t22.p1.tier === undefined).toBe(true);

    const t26 = await analyze(26);
    // Sacking the redundant Jugulis keeps Rhydon, the sole answer to Salazzle.
    expect(t26.p2.tier === undefined || t26.p2.tier === 'inaccuracy' || !!t26.p2.sacrifice).toBe(true);

    const t29 = await analyze(29);
    // A 9%-HP Uxie is fed in as a sacrifice.
    expect(t29.p1.riskUnpunished).toBeFalsy();
    if (t29.p1.tier) expect(t29.p1.sacrifice).toBeTruthy();

    // Turns 38 and 39: correction drift left p2.pokemonLeft high and Rhydon's isActive false, so the search threw on both turns and
    // the graph ended at turn 37. Both must evaluate, decisively for the winner mopping up.
    await analyze(38);
    await analyze(39);
    expect(scoreByTurn.get(38)!).toBeGreaterThan(0);
    expect(scoreByTurn.get(39)!).toBeGreaterThan(0);

    // Turn 14: Cobalion was KO'd before it ever acted; the side prices through the stay-in phantom instead of reading "unclear
    // (a choice never surfaced)".
    const t14 = await analyze(14);
    expect(t14.p2.neverActed).toBe(true);
    expect(t14.p2.played?.label).toContain('stayed in');

    // Turn 35: the winner feeds a healthy Salazzle into Knock Off while the engine calls the game decisively won on both sides of
    // the sack; that is simplification, never a mistake-tier misplay. Rhydon stands at its true 100 % (the log's turn-36
    // switch line), not the sim's 88 %. The sacrifice stamp renders exactly when both scores hold the healthy-sack floor and
    // the regret keeps a tier after the decided-position leniency (the turn reads 0.82 before and 0.64 after the sack, regret
    // 0.171: the leniency alone clears the inaccuracy and no stamp renders).
    await analyze(36);
    const t35 = await analyze(35, scoreByTurn.get(36) ?? null);
    const floorHolds = scoreByTurn.get(35)! >= HEALTHY_SACK_FLOOR && scoreByTurn.get(36)! >= HEALTHY_SACK_FLOOR;
    const tieredAfterDecided = (t35.p1.regret ?? 0) >= (Math.abs(scoreByTurn.get(35)!) >= DECIDED_SCORE ? TIER_THRESHOLDS.mistake : TIER_THRESHOLDS.inaccuracy);
    expect(!!t35.p1.sacrifice).toBe(floorHolds && tieredAfterDecided);
    if (t35.p1.sacrifice) expect(t35.p1.sacrifice.healthy).toBe(true);
    expect(t35.p1.tier === undefined || t35.p1.tier === 'inaccuracy').toBe(true);

    // Turn 25: the ranked lists enumerate "U-turn → X" pivot pairs as first-class choices.
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
    for (const row of pairRows) expect(Number.isFinite(row.ev)).toBe(true);
  });
});
