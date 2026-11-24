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
    expect(t26.p2.tier === undefined || t26.p2.tier === 'inaccuracy' || !!t26.p2.sacrifice).toBe(true);

    const t29 = await analyze(29);
    expect(t29.p1.riskUnpunished).toBeFalsy();
    if (t29.p1.tier) expect(t29.p1.sacrifice).toBeTruthy();

    await analyze(38);
    await analyze(39);
    expect(scoreByTurn.get(38)!).toBeGreaterThan(0);
    expect(scoreByTurn.get(39)!).toBeGreaterThan(0);

    const t14 = await analyze(14);
    expect(t14.p2.neverActed).toBe(true);
    expect(t14.p2.played?.label).toContain('stayed in');

    await analyze(36);
    const t35 = await analyze(35, scoreByTurn.get(36) ?? null);
    const floorHolds = scoreByTurn.get(35)! >= HEALTHY_SACK_FLOOR && scoreByTurn.get(36)! >= HEALTHY_SACK_FLOOR;
    const tieredAfterDecided = (t35.p1.regret ?? 0) >= (Math.abs(scoreByTurn.get(35)!) >= DECIDED_SCORE ? TIER_THRESHOLDS.mistake : TIER_THRESHOLDS.inaccuracy);
    expect(!!t35.p1.sacrifice).toBe(floorHolds && tieredAfterDecided);
    if (t35.p1.sacrifice) expect(t35.p1.sacrifice.healthy).toBe(true);
    expect(t35.p1.tier === undefined || t35.p1.tier === 'inaccuracy').toBe(true);

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

describe('draft replay end-to-end verdicts', () => {
  test('the trend layers surface the Heatran switch over the Recover stall', { timeout: 240000 }, async () => {
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
    expect(d1.heatran.ev).toBeGreaterThan(d1.recover.ev);
    expect(d1.p2.indexOf(d1.heatran)).toBeLessThan(d1.p2.indexOf(d1.recover));

    const d2 = rows(2);
    expect(d2.heatran.ev).toBeGreaterThan(d2.recover.ev);
    // Near-tied walls (ev gap ~0.001) price as class means: only "a wall switch leads" is pinned.
    expect(d2.p2[0].label).toMatch(/^→ (Heatran|Slowking)$/);
  });
});
