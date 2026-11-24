import { test, expect, describe } from 'vitest';
import { readFileSync } from 'fs';
import {
  buildTeamsFromReplay, getBranchSimulatorFormat, parseReplayLogWithObservations, type ReplayData,
} from '@fulllifegames/replay-core';
import {
  adoptSerializedRuntime, createBranchState, executeBranchChoices, reconstructBranchRuntime, type BranchRuntime,
} from '../src/branch-engine';
import { buildChoiceLockContext } from '../src/choice-lock';
import { serializeLiveBattle } from '../src/serialize';

const TURN = 12;
const noChoices = { p1Choices: [], p2Choices: [] };

function loadReplay(): ReplayData {
  return JSON.parse(readFileSync(new URL('./fixtures/draft-replay.json', import.meta.url), 'utf-8')) as ReplayData;
}

async function liveRuntime(targetTurn: number) {
  const replay = loadReplay();
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

const withoutTimestamps = (log: string[]) => log.filter(line => !line.startsWith('|t:|'));
const pickers = (runtime: BranchRuntime) => {
  const state = createBranchState(runtime.battleStream, runtime.log, noChoices);
  return { ...state, log: withoutTimestamps(state.log) };
};
const serialized = (runtime: BranchRuntime) => serializeLiveBattle(runtime.battleStream.battle!);

// Serialization drops the `|t:|` lines (the send cursor and last-move index count fewer lines), and deserialization
// leaves `formatid` as an own key in another position: both differ legitimately from a live battle.
function comparable(runtime: BranchRuntime): string {
  const state = JSON.parse(serialized(runtime)) as Record<string, unknown>;
  delete state.sentLogPos;
  delete state.lastMoveLine;
  delete state.formatid;
  return JSON.stringify(state);
}

async function play(runtime: BranchRuntime, p1: string, p2: string) {
  return executeBranchChoices({
    streams: runtime.streams, log: runtime.log, choiceErrors: runtime.choiceErrors,
    commands: [{ side: 'p1', command: p1 }, { side: 'p2', command: p2 }],
  });
}

describe('adoptSerializedRuntime', () => {
  test('renders the same pickers and protocol log as the live reconstruction, then plays on identically', { timeout: 300000 }, async () => {
    const { replay, runtime: live, snapshotAt } = await liveRuntime(TURN);
    const adopted = adoptSerializedRuntime({
      serialized: serialized(live), replayLog: replay.log, targetTurn: TURN, snapshot: snapshotAt(TURN),
    });

    expect(adopted.log).toEqual(live.log);
    expect(pickers(adopted)).toEqual(pickers(live));
    expect(adopted.battleStream.battle?.turn).toBe(TURN);

    for (let step = 0; step < 2; step++) {
      const [liveResult, adoptedResult] = await Promise.all([play(live, 'default', 'default'), play(adopted, 'default', 'default')]);
      expect(adoptedResult).toEqual(liveResult);
      expect(liveResult.ok).toBe(true);
      expect(withoutTimestamps(adopted.log)).toEqual(withoutTimestamps(live.log));
      expect(comparable(adopted)).toBe(comparable(live));
      expect(pickers(adopted)).toEqual(pickers(live));
    }
  });

  test('rejected choices surface as the same errors after adoption', { timeout: 300000 }, async () => {
    const { replay, runtime: live, snapshotAt } = await liveRuntime(TURN);
    const adopted = adoptSerializedRuntime({
      serialized: serialized(live), replayLog: replay.log, targetTurn: TURN, snapshot: snapshotAt(TURN),
    });
    const [liveResult, adoptedResult] = await Promise.all([play(live, 'switch 9', 'switch 9'), play(adopted, 'switch 9', 'switch 9')]);
    expect(liveResult.ok).toBe(false);
    expect(adoptedResult).toEqual(liveResult);
    expect(adopted.choiceErrors.count).toBe(live.choiceErrors.count);
  });

  test('a sweep-captured boundary adopts to the same playable position as a single-turn arrival', { timeout: 300000 }, async () => {
    const [{ replay, captured, snapshotAt }, { runtime: arrival }] = await Promise.all([liveRuntime(TURN + 1), liveRuntime(TURN)]);
    const boundary = captured.get(TURN);
    expect(boundary).toBeTruthy();
    const fromBoundary = adoptSerializedRuntime({
      serialized: boundary!, replayLog: replay.log, targetTurn: TURN, snapshot: snapshotAt(TURN),
    });
    const fromArrival = adoptSerializedRuntime({
      serialized: serialized(arrival), replayLog: replay.log, targetTurn: TURN, snapshot: snapshotAt(TURN),
    });
    expect(fromBoundary.log).toEqual(fromArrival.log);
    expect(pickers(fromBoundary)).toEqual(pickers(fromArrival));
    for (let step = 0; step < 2; step++) {
      const [a, b] = await Promise.all([play(fromBoundary, 'default', 'default'), play(fromArrival, 'default', 'default')]);
      expect(a).toEqual(b);
      expect(serialized(fromBoundary)).toBe(serialized(fromArrival));
    }
  });

  test('a worker-provided log is taken verbatim', { timeout: 300000 }, async () => {
    const { replay, runtime: live, snapshotAt } = await liveRuntime(TURN);
    const adopted = adoptSerializedRuntime({
      serialized: serialized(live), replayLog: replay.log, targetTurn: TURN, snapshot: snapshotAt(TURN),
      log: ['|custom|line', '|turn|12'],
    });
    expect(adopted.log).toEqual(['|custom|line', '|turn|12']);
    const result = await play(adopted, 'default', 'default');
    expect(result.ok).toBe(true);
    expect(adopted.log.length).toBeGreaterThan(2);
  });
});
