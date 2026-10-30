import { readFileSync } from 'fs';
import {
  buildTeamsFromReplay, getBranchSimulatorFormat, parseReplayLog, parseReplayLogWithObservations, replayBringOnly, type ReplayData,
} from '@fulllifegames/replay-core';
import { reconstructBranchRuntime, type ReplacementPoint } from '../src/branch-engine';
import { buildChoiceLockContext } from '../src/choice-lock';
import { serializeLiveBattle } from '../src/serialize';
import { loadSimMods } from '../src/forward/sim-mods';

/**
 * Round 79 (T290): the replacement points of a replay, twice. `reconstructWithPoints` plays the app's reconstruction of a
 * fixture with the capture hook on; `logRounds` reads the same points from the protocol alone, the oracle the hook is held to.
 */

export const loadFixture = (name: string) =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf-8')) as ReplayData;

export interface CapturedPoint { point: ReplacementPoint; serialized: string; serializedAgain: string }

/** The app's reconstruction of a fixture up to `targetTurn` (default: past the last turn), with or without the hook. */
export async function reconstructWithPoints(fixture: string, options: { hook?: boolean; targetTurn?: number } = {}) {
  const replay = loadFixture(fixture);
  // The app's worker loads the game's mod before it builds the sets (round 75).
  await loadSimMods(getBranchSimulatorFormat(replay));
  const { snapshots, observations, speedOrders } = parseReplayLogWithObservations(replay.log);
  const { p1Team, p2Team } = buildTeamsFromReplay(replay.log, { observations, speedOrders });
  const snapshotAt = (turn: number) => snapshots[Math.min(turn - 1, snapshots.length - 1)] ?? null;
  const targetTurn = options.targetTurn ?? (replay.log.match(/^\|turn\|/gm)?.length ?? 1) + 2;
  const positions = new Map<number, string>();
  const points: CapturedPoint[] = [];
  const runtime = await reconstructBranchRuntime({
    format: getBranchSimulatorFormat(replay),
    p1Team, p2Team,
    replayLog: replay.log,
    targetTurn,
    snapshot: snapshotAt(targetTurn),
    playerNames: [replay.players[0], replay.players[1]],
    bringOnly: replayBringOnly(replay, parseReplayLog(replay.log)) ?? undefined,
    choiceLocks: buildChoiceLockContext(replay.log, { p1Team, p2Team }, observations),
    capturePositions: {
      snapshotFor: snapshotAt,
      onPosition: (turn, battle) => positions.set(turn, serializeLiveBattle(battle)),
      ...(options.hook === false ? {} : {
        onReplacement: (point, battle) => {
          points.push({ point, serialized: serializeLiveBattle(battle), serializedAgain: serializeLiveBattle(battle) });
        },
      }),
    },
  });
  return { replay, runtime, positions, points, final: serializeLiveBattle(runtime.battleStream.battle!) };
}

export interface LogRound {
  turn: number;
  ordinal: number;
  /** Slot indexes the round refills, per side. */
  slots: { p1: number[]; p2: number[] };
  /** The species the log sends in, per side, in log order. */
  species: { p1: string[]; p2: string[] };
}

/**
 * A plain read of the protocol: a request round is the set of fainted slots that are open when the first replacement enters.
 * A replacement that faints again (an entry hazard) opens the next round; a faint that no switch answers closes with its block.
 */
export function logRounds(log: string): LogRound[] {
  const rounds: LogRound[] = [];
  let turn = 0;
  let ordinal = 0;
  let pending = new Set<string>();
  let filling: Set<string> | null = null;
  let current: LogRound | null = null;
  const settle = () => {
    pending = new Set();
    filling = null;
    current = null;
  };
  for (const line of log.replace(/\r\n/g, '\n').split('\n')) {
    const turnLine = line.match(/^\|turn\|(\d+)/);
    if (turnLine) {
      turn = Number(turnLine[1]);
      ordinal = 0;
      settle();
      continue;
    }
    const faint = line.match(/^\|faint\|(p[12])([a-d]):/);
    if (faint) {
      pending.add(`${faint[1]}${faint[2]}`);
      continue;
    }
    const entry = line.match(/^\|switch\|(p[12])([a-d]):[^|]*\|([^,|]+)/);
    if (!entry) continue;
    const slot = `${entry[1]}${entry[2]}`;
    if (!filling && pending.has(slot)) {
      filling = new Set(pending);
      pending = new Set();
      current = { turn, ordinal: ordinal++, slots: { p1: [], p2: [] }, species: { p1: [], p2: [] } };
      rounds.push(current);
    }
    if (filling?.has(slot) && current) {
      filling.delete(slot);
      const side = entry[1] as 'p1' | 'p2';
      current.slots[side].push(entry[2].charCodeAt(0) - 97);
      current.species[side].push(entry[3].trim());
      if (filling.size === 0) filling = null;
    }
  }
  for (const round of rounds) {
    round.slots.p1.sort();
    round.slots.p2.sort();
  }
  return rounds;
}
