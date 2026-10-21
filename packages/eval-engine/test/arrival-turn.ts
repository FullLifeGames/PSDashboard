import { expect } from 'vitest';
import { readFileSync } from 'fs';
import {
  buildTeamsFromReplay, getBranchSimulatorFormat, parseReplayLogWithObservations, replayBringOnly, type ReplayData,
} from '@fulllifegames/replay-core';
import { executeBranchChoices, reconstructBranchRuntime, type BranchRuntime } from '../src/branch-engine';
import { buildChoiceLockContext } from '../src/choice-lock';
import { serializeLiveBattle } from '../src/serialize';
import { extractProtocolEvents, scoreAlignment } from '../src/hax-alignment';
import { buildForcedSwitchChoice, hasForceSwitch } from '../src/branch/corrections';
import { actionKey } from '../src/branch/logged-rolls';
import type { SimBattle } from '../src/branch/types';
import { collectForcedSwitchSpecies, getMainChoice, parseTurnBlocks } from '../src/branch/protocol-choices';

/**
 * The branch's first turn as the specs play it (round 70, arrival-dice.spec.ts; round 73, logged-rolls.spec.ts): the app's
 * reconstruction of a fixture up to a turn, and the logged turn played through the branch's own execution path.
 */

export const loadReplay = (name: string) =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf-8')) as ReplayData;

/** The app's reconstruction: healed, locked, boundaries captured. Champions replays bring what the app brings. */
export async function reconstruct(fixture: string, targetTurn: number) {
  const replay = loadReplay(fixture);
  const { snapshots, observations, speedOrders } = parseReplayLogWithObservations(replay.log);
  const { p1Team, p2Team } = buildTeamsFromReplay(replay.log, { observations, speedOrders });
  const snapshotAt = (turn: number) => snapshots[Math.min(turn - 1, snapshots.length - 1)] ?? null;
  const captured = new Map<number, string>();
  const runtime = await reconstructBranchRuntime({
    format: getBranchSimulatorFormat(replay),
    p1Team, p2Team,
    replayLog: replay.log,
    targetTurn,
    snapshot: snapshotAt(targetTurn),
    playerNames: [replay.players[0], replay.players[1]],
    bringOnly: fixture.startsWith('champions/') ? replayBringOnly(replay, snapshots) : undefined,
    choiceLocks: buildChoiceLockContext(replay.log, { p1Team, p2Team }, observations),
    capturePositions: {
      snapshotFor: snapshotAt,
      onPosition: (turn, battle) => captured.set(turn, serializeLiveBattle(battle)),
    },
  });
  return { replay, runtime, captured, snapshotAt };
}

export const prngOf = (runtime: BranchRuntime) => runtime.battleStream.battle!.prng.getSeed();

/**
 * The logged turn through the branch's own execution path: the commands the replay would send (or `p2` instead of the logged
 * click), written to the live battle, the forced replacements answered from the log as the replay answers them. Scored the
 * way the replay scores its own blocks: the discrete events (faints, misses, crits, secondaries, cants, move order).
 * `choices` replaces a side's logged click.
 */
export async function playTurn(
  runtime: BranchRuntime, replayLog: string, turn: number, choices?: string | { p1?: string; p2?: string },
) {
  const replaced = typeof choices === 'string' ? { p2: choices } : choices ?? {};
  const block = parseTurnBlocks(replayLog).turns.find(entry => entry.turn === turn)!;
  const battle = runtime.battleStream.battle!;
  const send = (commands: { side: 'p1' | 'p2'; command: string }[]) =>
    executeBranchChoices({ streams: runtime.streams, log: runtime.log, choiceErrors: runtime.choiceErrors, commands });
  const logStart = battle.log.length;
  const first = await send([
    { side: 'p1', command: replaced.p1 ?? getMainChoice(block.preUpkeep, 'p1', battle) },
    { side: 'p2', command: replaced.p2 ?? getMainChoice(block.preUpkeep, 'p2', battle) },
  ]);
  expect(first.ok).toBe(true);
  const forced = {
    p1: collectForcedSwitchSpecies(block.preUpkeep, block.postUpkeep, 'p1'),
    p2: collectForcedSwitchSpecies(block.preUpkeep, block.postUpkeep, 'p2'),
  };
  const cursors = { p1: { current: 0 }, p2: { current: 0 } };
  for (let guard = 0; guard < 6; guard++) {
    const commands = (['p1', 'p2'] as const).flatMap((side, index) => {
      const choice = hasForceSwitch(battle, index) ? buildForcedSwitchChoice(battle, index, forced[side], cursors[side]) : null;
      return choice ? [{ side, command: choice }] : [];
    });
    if (commands.length === 0) break;
    await send(commands);
  }
  const lines = battle.log.slice(logStart);
  const expected = extractProtocolEvents([...block.preUpkeep, ...block.postUpkeep]);
  return { lines, score: scoreAlignment(expected, extractProtocolEvents(lines)) };
}

export interface Draw { key: string | null; from?: number; to?: number; value: number }

/** Every number the battle's PRNG draws from now on, with the action (slot and move) it was drawn for; null outside an action. */
export function observeDraws(battle: SimBattle): Draw[] {
  const draws: Draw[] = [];
  const prng = battle.prng;
  const original = prng.random.bind(prng);
  prng.random = (from?: number, to?: number) => {
    const value = original(from, to);
    draws.push({ key: actionKey(battle), from, to, value });
    return value;
  };
  return draws;
}

/** The draws of each action, in order. */
export function drawsByAction(draws: Draw[]): Map<string, Draw[]> {
  const byAction = new Map<string, Draw[]>();
  for (const draw of draws) {
    if (draw.key === null) continue;
    byAction.set(draw.key, [...(byAction.get(draw.key) ?? []), draw]);
  }
  return byAction;
}
