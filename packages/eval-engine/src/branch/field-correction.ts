import { type TurnSnapshot, toId } from '@fulllifegames/replay-core';
import type { SimBattle } from './types.ts';
import { terrainIdFromSnapshot, weatherIdFromSnapshot } from './field-ids.ts';

/**
 * Field and side conditions from the turn snapshot (moved out of
 * corrections.ts in round 60, T92). The snapshot comes from @pkmn/client:
 * side conditions carry `level` (a repeated setter) and the remaining
 * minimum and maximum turns; weather and terrain carry theirs in
 * weatherState and terrainState (absent before round 60).
 */

type EffectEntry = { id?: string; duration?: number; effectOrder?: number; layers?: number };

/** Remaining turns: the minimum while it runs, else the maximum (an extended weather), else none (unbounded). */
export function snapshotConditionDuration(value: unknown): number | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const maybeDuration = value as { minDuration?: unknown; maxDuration?: unknown; duration?: unknown };
  for (const duration of [maybeDuration.duration, maybeDuration.minDuration, maybeDuration.maxDuration]) {
    if (typeof duration === 'number' && Number.isFinite(duration) && duration > 0) return duration;
  }
  return undefined;
}

/**
 * Whether the sim stacks this condition: its dex condition restarts
 * (onSideRestart, in 0.10.11 exactly Spikes and Toxic Spikes, which count
 * layers there). The client counts the same setter as `level`.
 */
function stacks(battle: SimBattle, id: string): boolean {
  // Side handlers are not on the dex's Condition type; the data object carries them.
  const condition = battle.dex.conditions.get(id);
  return 'onSideRestart' in condition && typeof condition.onSideRestart === 'function';
}

function snapshotLevel(value: unknown): number | undefined {
  const level = (value as { level?: unknown } | null)?.level;
  return typeof level === 'number' && Number.isFinite(level) && level > 0 ? level : undefined;
}

function syncEffectTableFromSnapshot(battle: SimBattle, table: Record<string, EffectEntry>, snapshotTable: Record<string, unknown>) {
  const desiredIds = new Set(Object.keys(snapshotTable).map(key => toId(key)));
  for (const key of Object.keys(table)) {
    if (!desiredIds.has(toId(key))) delete table[key];
  }
  for (const [key, value] of Object.entries(snapshotTable)) {
    const id = toId(key);
    const duration = snapshotConditionDuration(value);
    const layers = stacks(battle, id) ? snapshotLevel(value) : undefined;
    table[id] = {
      ...(table[id] ?? {}),
      id,
      effectOrder: table[id]?.effectOrder ?? 0,
      ...(duration ? { duration } : {}),
      ...(layers ? { layers } : {}),
    };
  }
}

/** Weather the sim disagrees about takes the snapshot's id and remaining turns; matching weather keeps the rebuild's state. */
function syncWeather(battle: SimBattle, snapshot: TurnSnapshot) {
  const weather = weatherIdFromSnapshot(snapshot.field.weather);
  if ((battle.field.weather as string) === weather) return;
  battle.field.weather = weather as SimBattle['field']['weather'];
  battle.field.weatherState.id = weather as typeof battle.field.weatherState.id;
  const duration = weather ? snapshotConditionDuration(snapshot.field.weatherState) : undefined;
  if (duration) battle.field.weatherState.duration = duration;
  else delete battle.field.weatherState.duration;
}

/** Terrain the sim disagrees about: a cleared state (the sim's own helper), then the snapshot's id and remaining turns. */
function syncTerrain(battle: SimBattle, snapshot: TurnSnapshot) {
  const terrain = terrainIdFromSnapshot(snapshot.field.terrain);
  if ((battle.field.terrain as string) === terrain) return;
  battle.field.terrain = terrain as SimBattle['field']['terrain'];
  battle.clearEffectState(battle.field.terrainState);
  battle.field.terrainState.id = terrain as typeof battle.field.terrainState.id;
  const duration = terrain ? snapshotConditionDuration(snapshot.field.terrainState) : undefined;
  if (duration) battle.field.terrainState.duration = duration;
}

export function correctFieldFromSnapshot(battle: SimBattle, snapshot: TurnSnapshot) {
  battle.turn = snapshot.turn;
  syncWeather(battle, snapshot);
  syncTerrain(battle, snapshot);
  syncEffectTableFromSnapshot(battle, battle.field.pseudoWeather as Record<string, EffectEntry>, snapshot.field.pseudoWeather);
  syncEffectTableFromSnapshot(battle, battle.sides[0].sideConditions as Record<string, EffectEntry>, snapshot.p1.sideConditions);
  syncEffectTableFromSnapshot(battle, battle.sides[1].sideConditions as Record<string, EffectEntry>, snapshot.p2.sideConditions);
}
