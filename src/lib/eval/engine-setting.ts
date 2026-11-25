import type { EngineEntry } from '../engines/registry';

let selected: EngineEntry | null = null;

export function setSelectedEngine(engine: EngineEntry | null): void {
  selected = engine?.url ? engine : null;
}

export function selectedEngine(): EngineEntry | null {
  return selected;
}

export function engineCacheTag(): string {
  return selected ? `|engine:${selected.id}` : '';
}

// A VGC game is rebuilt on the doubles format, so a request names the replay's format for the engine.
let gameFormat: string | null = null;

export function setEngineGameFormat(format: string | null): void {
  gameFormat = format;
}

export function engineGameFormat(): string | null {
  return gameFormat;
}
