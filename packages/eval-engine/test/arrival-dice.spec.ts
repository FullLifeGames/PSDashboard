import { test, expect, describe } from 'vitest';
import { readFileSync } from 'fs';
import { PRNG } from '@pkmn/sim';
import {
  buildTeamsFromReplay, getBranchSimulatorFormat, parseReplayLogWithObservations, type ReplayData,
} from '@fulllifegames/replay-core';
import { adoptSerializedRuntime, executeBranchChoices, reconstructBranchRuntime, type BranchRuntime } from '../src/branch-engine';
import { buildChoiceLockContext } from '../src/choice-lock';
import { serializeLiveBattle } from '../src/serialize';
import { extractProtocolEvents, scoreAlignment } from '../src/hax-alignment';
import { buildForcedSwitchChoice, hasForceSwitch } from '../src/branch/corrections';
import { collectForcedSwitchSpecies, getMainChoice, parseTurnBlocks } from '../src/branch/protocol-choices';
import { protocolNicknames, simNamedLines } from '../src/branch/protocol-names';
import { alignArrivalDice } from '../src/branch/arrival-dice';
import { deserializeBattleExact } from '../src/forward-model';

/**
 * Round 70: a branch opens with the dice its own turn has in the log. GPL DzBQ5azlO5l turn 13 (Air Slash against Heavy Slam,
 * no flinch in the game): the arrival carried the dice state the previous block left (there still 1,2,3,4), under which Air
 * Slash flinches Cobalion, so rebuilding the turn with the logged pair or with any other move for Cobalion showed a flinch
 * the log does not have. The replay itself already plays every block under the seed whose rolls reproduce the block (hax
 * alignment); the arrival now plays its own turn under that seed too, in singles and in doubles.
 */

const loadReplay = (name: string) =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf-8')) as ReplayData;

/** The scenes: turns the replay plays under another seed than 1,2,3,4 (the aligned seed is pinned), and one it plays under 1,2,3,4. */
const SINGLES = { label: 'singles (GPL DzBQ5azlO5l)', fixture: 'gpl-replay', turn: 13, seed: '5,9,13,17' };
const DOUBLES = { label: 'doubles (Doubles OU 912884)', fixture: 'smogtours-gen9doublesou-912884', turn: 10, seed: '5,9,13,17' };
const VGC = { label: 'VGC doubles (Regulation I 2630181744)', fixture: 'gen9vgc2026regi-2630181744', turn: 3, seed: '3,1,4,1' };
const QUIET = { fixture: 'gpl-replay', turn: 12 };

/** The app's reconstruction: healed, locked, boundaries captured. */
async function reconstruct(fixture: string, targetTurn: number) {
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
    choiceLocks: buildChoiceLockContext(replay.log, { p1Team, p2Team }, observations),
    capturePositions: {
      snapshotFor: snapshotAt,
      onPosition: (turn, battle) => captured.set(turn, serializeLiveBattle(battle)),
    },
  });
  return { replay, runtime, captured, snapshotAt };
}

const prngOf = (runtime: BranchRuntime) => runtime.battleStream.battle!.prng.getSeed();

/**
 * The logged turn through the branch's own execution path: the commands the replay would send (or `p2` instead of the logged
 * click), written to the live battle, the forced replacements answered from the log as the replay answers them. Scored the
 * way the replay scores its own blocks: the discrete events (faints, misses, crits, secondaries, cants, move order).
 */
async function playTurn(runtime: BranchRuntime, replayLog: string, turn: number, p2?: string) {
  const block = parseTurnBlocks(replayLog).turns.find(entry => entry.turn === turn)!;
  const battle = runtime.battleStream.battle!;
  const send = (commands: { side: 'p1' | 'p2'; command: string }[]) =>
    executeBranchChoices({ streams: runtime.streams, log: runtime.log, choiceErrors: runtime.choiceErrors, commands });
  const logStart = battle.log.length;
  const first = await send([
    { side: 'p1', command: getMainChoice(block.preUpkeep, 'p1', battle) },
    { side: 'p2', command: p2 ?? getMainChoice(block.preUpkeep, 'p2', battle) },
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
  const expected = extractProtocolEvents(simNamedLines([...block.preUpkeep, ...block.postUpkeep], protocolNicknames(replayLog), battle));
  return { lines, score: scoreAlignment(expected, extractProtocolEvents(lines)) };
}

const PERFECT = { endedMismatch: false, faintMismatches: 0, softMismatches: 0 };

describe.each([SINGLES, DOUBLES, VGC])('a branch plays the logged turn as the log has it: $label', ({ fixture, turn, seed }) => {
  test('the arrival carries the seed the replay plays this turn under', { timeout: 300000 }, async () => {
    const { runtime: arrival } = await reconstruct(fixture, turn);
    const { runtime: past } = await reconstruct(fixture, turn + 1);
    const aligned = past.haxAlignment.find(record => record.turn === turn)!;
    expect(aligned.seed).toBe(seed);
    expect(aligned.trialPerfect).toBe(true);
    expect(prngOf(arrival)).toBe(aligned.seed);
  });

  test('the logged pair, played from the single-turn arrival, shows the log\'s rolls', { timeout: 300000 }, async () => {
    const { replay, runtime } = await reconstruct(fixture, turn);
    expect((await playTurn(runtime, replay.log, turn)).score).toEqual(PERFECT);
  });

  test('the logged pair, played from the worker\'s serialized arrival, shows the log\'s rolls', { timeout: 300000 }, async () => {
    const { replay, runtime, snapshotAt } = await reconstruct(fixture, turn);
    const adopted = adoptSerializedRuntime({
      serialized: serializeLiveBattle(runtime.battleStream.battle!), replayLog: replay.log, targetTurn: turn, snapshot: snapshotAt(turn),
    });
    expect((await playTurn(adopted, replay.log, turn)).score).toEqual(PERFECT);
  });

  test('the logged pair, played from a sweep boundary the arrival never saw aligned, shows the log\'s rolls', { timeout: 300000 }, async () => {
    const { replay, captured, snapshotAt } = await reconstruct(fixture, turn + 1);
    const adopted = adoptSerializedRuntime({
      serialized: captured.get(turn)!, replayLog: replay.log, targetTurn: turn, snapshot: snapshotAt(turn),
    });
    expect(prngOf(adopted)).toBe(seed);
    expect((await playTurn(adopted, replay.log, turn)).score).toEqual(PERFECT);
  });
});

describe('the unchanged first mover keeps its logged roll when the other side clicks another move', () => {
  test('GPL turn 13: Air Slash neither flinches nor changes its damage when Cobalion clicks Swords Dance instead of Heavy Slam', { timeout: 300000 }, async () => {
    const logged = await reconstruct(SINGLES.fixture, SINGLES.turn);
    const asLogged = await playTurn(logged.runtime, logged.replay.log, SINGLES.turn);
    const other = await reconstruct(SINGLES.fixture, SINGLES.turn);
    const battle = other.runtime.battleStream.battle!;
    const swordsDance = battle.sides[1].active[0]!.getMoveRequestData().moves.findIndex(move => move.id === 'swordsdance');
    expect(swordsDance).toBeGreaterThanOrEqual(0);
    const changed = await playTurn(other.runtime, other.replay.log, SINGLES.turn, `move ${swordsDance + 1}`);

    for (const lines of [asLogged.lines, changed.lines]) {
      expect(lines.some(line => line.startsWith('|cant|p2a'))).toBe(false);
    }
    expect(changed.lines.some(line => /^\|move\|p2a: [^|]+\|Swords Dance/.test(line))).toBe(true);
    const airSlashHit = (lines: string[]) => lines.filter(line => /^\|-damage\|p2a/.test(line)).slice(0, 2);
    expect(airSlashHit(changed.lines)).toEqual(airSlashHit(asLogged.lines));
  });
});

describe('an arrival whose turn no trial can play keeps its dice', () => {
  // Review of round 70: with every trial failed (an edited set that lost the logged move), the arrival landed on 1,2,3,4.
  test('GPL turn 13 with Air Slash taken out of Noivern\'s set: the dice stay as they were', { timeout: 300000 }, async () => {
    const { replay, captured } = await reconstruct(SINGLES.fixture, SINGLES.turn + 1);
    const battle = deserializeBattleExact(captured.get(SINGLES.turn)!);
    const noivern = battle.sides[0].active[0]!;
    noivern.moveSlots = noivern.moveSlots.filter(slot => slot.id !== 'airslash');
    noivern.baseMoveSlots = noivern.baseMoveSlots.filter(slot => slot.id !== 'airslash');
    battle.prng = new PRNG('7,7,7,7');
    expect(alignArrivalDice(battle, replay.log, SINGLES.turn)).toBeNull();
    expect(battle.prng.getSeed()).toBe('7,7,7,7');
  });
});

describe('a turn the replay plays under 1,2,3,4 arrives on 1,2,3,4', () => {
  // Before round 70 the arrival carried the state the previous block's dice left, not a seed of its own turn.
  test('GPL turn 12: the arrival and the adopted position start on 1,2,3,4', { timeout: 300000 }, async () => {
    const { replay, runtime, captured, snapshotAt } = await reconstruct(QUIET.fixture, QUIET.turn + 1);
    const arrival = await reconstruct(QUIET.fixture, QUIET.turn);
    expect(prngOf(arrival.runtime)).toBe('1,2,3,4');
    const adopted = adoptSerializedRuntime({
      serialized: captured.get(QUIET.turn)!, replayLog: replay.log, targetTurn: QUIET.turn, snapshot: snapshotAt(QUIET.turn),
    });
    expect(prngOf(adopted)).toBe('1,2,3,4');
    expect(runtime.haxAlignment.find(record => record.turn === QUIET.turn)!.seed).toBe('1,2,3,4');
  });
});
