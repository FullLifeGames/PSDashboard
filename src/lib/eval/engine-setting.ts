import type { EngineEntry } from '../engines/registry';

/**
 * Round 77 (user gate 28.10.2026, 5a): the engine the Evaluation panel chose, read by the worker client
 * for every evaluation (Evaluate, Analyze game, Let it play out). Null is the dashboard's own search.
 */
let selected: EngineEntry | null = null;

export function setSelectedEngine(engine: EngineEntry | null): void {
  selected = engine?.url ? engine : null;
}

export function selectedEngine(): EngineEntry | null {
  return selected;
}

/** Another engine's results never share a cache key with the own search's; those keys stay as they were. */
export function engineCacheTag(): string {
  return selected ? `|engine:${selected.id}` : '';
}

/**
 * The loaded replay's format, which a request names beside the simulator's: the dashboard rebuilds a
 * VGC game on the doubles format, and an engine wants to know it plays VGC.
 */
let gameFormat: string | null = null;

export function setEngineGameFormat(format: string | null): void {
  gameFormat = format;
}

export function engineGameFormat(): string | null {
  return gameFormat;
}
