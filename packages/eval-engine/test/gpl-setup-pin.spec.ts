import { appendFileSync } from 'node:fs';
import { readFileSync } from 'fs';
import { describe, expect, test } from 'vitest';
import type { Battle } from '@pkmn/sim';
import {
  type ReplayData, buildTeamsFromReplay, formatEnforcesSleepClause, getBranchSimulatorFormat, inferReplayFormatId, logRules,
  parseReplayLogWithObservations, replayRuleset,
} from '@fulllifegames/replay-core';
import { reconstructBranchRuntime } from '../src/branch-engine';
import { analyzeTurn, TIER_THRESHOLDS } from '../src/analysis';
import { buildChoiceLockContext } from '../src/choice-lock';
import { createMatchupCache, evaluatePosition } from '../src/eval-function';
import { parsePlayedActions, turnEvents, detectSacks } from '../src/played';
import { serializeLiveBattle } from '../src/serialize';
import { autoTurnSettings } from '../src/search/budget';
import { createLocalTreeExecutor, searchTreesOrchestrated } from '../src/tree-orchestrator';
import { resolveTeraPreference } from '../src/tera';

/**
 * Round 79 (T288), the pin of the user gate (30.10.2026, "5a") on the GPL game: Clefable at 71% faces a Rhydon that sleeps
 * at 78% and Rests and Sleep Talks. Cosmic Power (+1 Defense, +1 Special Defense) leaves the Rhydon's Earthquake and
 * Avalanche unable to KO Clefable for the rest of the game, and the user's own click graded as an inaccuracy (regret 0.108
 * against Moonblast, because the static read a defensive stage as 0 whenever the holder could not also win within three
 * turns). The played Cosmic Power must not read as an inaccuracy and must rank in the top two rows or within 0.05 of the best.
 * The size of the stage in the static score is written to GPL_SIZE_OUT when the variable is set (the ledger of the round).
 */

const TURN = 27;
const replay = JSON.parse(readFileSync(new URL('./fixtures/gpl-replay.json', import.meta.url), 'utf-8')) as ReplayData;

async function boardAtT27(): Promise<{ battle: Battle; position: Awaited<ReturnType<typeof reconstructBranchRuntime>> }> {
  const { snapshots, observations, speedOrders } = parseReplayLogWithObservations(replay.log);
  const { p1Team, p2Team } = buildTeamsFromReplay(replay.log, { observations, speedOrders });
  const snapshotAt = (t: number) => snapshots[Math.min(t - 1, snapshots.length - 1)] ?? null;
  const position = await reconstructBranchRuntime({
    format: getBranchSimulatorFormat(replay), p1Team, p2Team, replayLog: replay.log, targetTurn: TURN, snapshot: snapshotAt(TURN),
    playerNames: [replay.players[0], replay.players[1]],
    choiceLocks: buildChoiceLockContext(replay.log, { p1Team, p2Team }, observations),
    capturePositions: { snapshotFor: snapshotAt, onPosition: () => {} },
  });
  return { battle: position.battleStream.battle!, position };
}

describe('GPL t27: setting up behind the sleeping Rhydon (T288)', () => {
  test('the static score reads the standing +1 Defense and +1 Special Defense above the board without them', { timeout: 120000 }, async () => {
    const { battle } = await boardAtT27();
    const ruleset = replayRuleset(replay);
    const clefable = battle.sides[0].active[0]!;
    expect(clefable.species.name).toBe('Clefable');
    const score = () => evaluatePosition(battle, createMatchupCache(ruleset));
    const base = score();
    clefable.boosts.def = 1;
    clefable.boosts.spd = 1;
    const one = score();
    clefable.boosts.def = 2;
    clefable.boosts.spd = 2;
    const two = score();
    if (process.env.GPL_SIZE_OUT) appendFileSync(process.env.GPL_SIZE_OUT, `GPL t27 static (p1 view): base ${base.toFixed(4)}, +1/+1 ${one.toFixed(4)}, +2/+2 ${two.toFixed(4)}\n`);
    expect(one).toBeGreaterThan(base);
  });

  test('the played Cosmic Power reads no inaccuracy and ranks in the top two rows or within 0.05 of the best', { timeout: 240000 }, async () => {
    const { battle } = await boardAtT27();
    const { snapshots } = parseReplayLogWithObservations(replay.log);
    const rules = logRules(replay.log);
    const settings = {
      tera: resolveTeraPreference('auto', inferReplayFormatId(replay), replay.log),
      sleepClause: formatEnforcesSleepClause(getBranchSimulatorFormat(replay)),
      ruleset: replayRuleset(replay),
    };
    let fainted = 0;
    let total = 0;
    for (const side of battle.sides) for (const mon of side.pokemon) { total++; if (mon.fainted || mon.hp <= 0) fainted++; }
    const resolved = autoTurnSettings(fainted / total, false);
    expect(resolved.mode).toBe('mcts');
    const result = await searchTreesOrchestrated(
      createLocalTreeExecutor(serializeLiveBattle(battle), settings.ruleset),
      { ...settings, depth: 1, samples: 1, mode: 'mcts' } as Parameters<typeof searchTreesOrchestrated>[1],
    );
    const events = turnEvents(replay.log, TURN);
    const turn = analyzeTurn({
      turn: TURN, result, played: parsePlayedActions(events, rules), playedOutcome: null, scoreBefore: result.score, scoreAfter: null,
      sacks: detectSacks(events, snapshots[TURN - 1] ?? null, rules), actives: { p1: null, p2: null, gen: rules.gen, mod: rules.mod },
    });
    const rows = result.perSide.p1.map(row => ({ label: row.label, ev: row.ev }));
    if (process.env.GPL_SIZE_OUT) appendFileSync(process.env.GPL_SIZE_OUT, `GPL t27 rows (p1): ${rows.map(row => `${row.label} ${row.ev.toFixed(3)}`).join(', ')}; regret ${turn.p1.regret}, tier ${turn.p1.tier}\n`);
    expect(turn.p1.played?.label).toBe('Cosmic Power');
    const played = rows.findIndex(row => row.label === 'Cosmic Power');
    expect(played).toBeGreaterThanOrEqual(0);
    expect(turn.p1.tier).not.toBe('inaccuracy');
    expect(turn.p1.tier).toBeUndefined();
    expect(turn.p1.regret ?? 0).toBeLessThan(TIER_THRESHOLDS.inaccuracy);
    const best = Math.max(...rows.map(row => row.ev));
    expect(played < 2 || best - rows[played].ev <= 0.05).toBe(true);
  });
});
