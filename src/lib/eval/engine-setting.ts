import type { EngineEntry } from '../engines/registry';

/** The engine the Evaluation panel chose, read by the worker client for every evaluation; null is the dashboard's own search. */
let selected: EngineEntry | null = null;

export function setSelectedEngine(engine: EngineEntry | null): void {
  selected = engine?.url ? engine : null;
}

export function selectedEngine(): EngineEntry | null {
  return selected;
}

/** The cache key suffix of the chosen engine: another engine's results never share a key with the own search's. */
export function engineCacheTag(): string {
  return selected ? `|engine:${selected.id}` : '';
}

/**
 * The loaded replay's format, named in a request beside the simulator's: a VGC game is rebuilt on the doubles format, and an engine
 * wants to know it plays VGC.
 */
let gameFormat: string | null = null;

export function setEngineGameFormat(format: string | null): void {
  gameFormat = format;
}

export function engineGameFormat(): string | null {
  return gameFormat;
}
