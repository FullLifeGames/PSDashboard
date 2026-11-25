import type { Battle } from '@pkmn/sim';
import { buildTeamsFromReplay, getBranchSimulatorFormat, parseReplayLog, toId, type TurnSnapshot } from '@fulllifegames/replay-core';
import { reconstructBranchRuntime } from '../src/branch-engine';
import { terrainIdFromSnapshot, weatherIdFromSnapshot } from '../src/branch/field-ids';

// A duration lies between the client's remaining min and max (Damp Rock extends it only in the sim); layers match.
// Only Dex conditions count: the client files Future Sight as a side condition, the sim as a slot condition.

type Turns = { minDuration?: number; maxDuration?: number } | undefined;

function fits(simDuration: number | undefined, turns: Turns): boolean {
  if (simDuration === undefined || !turns) return true;
  const min = turns.minDuration ?? 0;
  const max = turns.maxDuration ?? 0;
  if (min === 0 && max === 0) return true;
  return simDuration >= (min || 1) && simDuration <= Math.max(min, max);
}

function mismatches(battle: Battle, snapshot: TurnSnapshot): string[] {
  const out: string[] = [];
  battle.sides.forEach((side, index) => {
    const wanted = (index === 0 ? snapshot.p1 : snapshot.p2).sideConditions as Record<string, { level?: number } & Turns>;
    for (const [key, value] of Object.entries(wanted)) {
      const entry = side.sideConditions[toId(key)];
      if (!entry || !battle.dex.conditions.get(toId(key)).exists) continue;
      if (typeof entry.layers === 'number' && value.level !== undefined && entry.layers !== value.level) {
        out.push(`t${snapshot.turn} p${index + 1} ${key} layers sim ${entry.layers} snapshot ${value.level}`);
      }
      if (!fits(entry.duration, value)) out.push(`t${snapshot.turn} p${index + 1} ${key} duration sim ${entry.duration} snapshot ${JSON.stringify(value)}`);
    }
  });
  if (battle.field.weather && battle.field.weather === weatherIdFromSnapshot(snapshot.field.weather, battle.dex) &&
      !fits(battle.field.weatherState.duration, snapshot.field.weatherState)) {
    out.push(`t${snapshot.turn} weather ${battle.field.weather} sim ${battle.field.weatherState.duration} snapshot ${JSON.stringify(snapshot.field.weatherState)}`);
  }
  if (battle.field.terrain && battle.field.terrain === terrainIdFromSnapshot(snapshot.field.terrain, battle.dex) &&
      !fits(battle.field.terrainState.duration, snapshot.field.terrainState)) {
    out.push(`t${snapshot.turn} terrain ${battle.field.terrain} sim ${battle.field.terrainState.duration} snapshot ${JSON.stringify(snapshot.field.terrainState)}`);
  }
  return out;
}

export async function fieldMismatches(replay: { log: string; formatid?: string; id?: string }): Promise<{ checked: number; found: string[] }> {
  const snapshots = parseReplayLog(replay.log);
  const snapshotFor = (turn: number) => snapshots[Math.min(turn - 1, snapshots.length - 1)] ?? null;
  const { p1Team, p2Team } = buildTeamsFromReplay(replay.log);
  const found: string[] = [];
  let checked = 0;
  await reconstructBranchRuntime({
    format: getBranchSimulatorFormat(replay as never),
    p1Team, p2Team,
    replayLog: replay.log,
    targetTurn: snapshots.length + 1,
    capturePositions: { snapshotFor, onPosition: () => undefined },
    onRawBoundary: (turn, battle) => {
      const snapshot = snapshotFor(turn);
      if (!snapshot || snapshot.turn !== turn) return;
      checked++;
      found.push(...mismatches(battle as unknown as Battle, snapshot));
    },
  });
  return { checked, found };
}
