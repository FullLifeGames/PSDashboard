import { useCallback, useRef, useState } from 'react';
import { autoTurnSettings, searchBudget, type EvalPreferences, type EvalSettings } from '@fulllifegames/eval-engine';
import { opponentReadsEnabled } from '../../lib/feature-flags';

const PREFS_KEY = 'ps-replay-interceptor:eval-prefs';
const DEFAULT_PREFS: EvalPreferences = { depth: 2, samples: 3, mode: 'auto', auto: false, autoAnalyze: false, tera: 'auto' };

function loadPrefs(): EvalPreferences {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return DEFAULT_PREFS;
    const parsed = JSON.parse(raw) as Partial<EvalPreferences>;
    return {
      depth: parsed.depth === 1 ? 1 : 2,
      samples: parsed.samples === 1 || parsed.samples === 5 ? parsed.samples : 3,
      mode: parsed.mode === 'mcts' || parsed.mode === 'auto' ? parsed.mode : 'matrix',
      auto: !!parsed.auto,
      autoAnalyze: !!parsed.autoAnalyze,
      tera: parsed.tera === 'on' || parsed.tera === 'off' || parsed.tera === 'revealed' ? parsed.tera : 'auto',
      ...(parsed.hardMode === true && opponentReadsEnabled() ? { hardMode: true } : {}),
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

// A stored hardMode is kept while the flag hides it: a write of the other preferences must not drop it.
function storedHardMode(): true | undefined {
  try {
    return (JSON.parse(localStorage.getItem(PREFS_KEY) ?? 'null') as { hardMode?: unknown } | null)?.hardMode === true ? true : undefined;
  } catch {
    return undefined;
  }
}

/** The panel preferences; `persistPrefs` returns whether an engine-relevant setting changed (hard mode is not one). */
export function usePrefsState() {
  const [prefs, setPrefsState] = useState<EvalPreferences>(loadPrefs);
  const prefsRef = useRef(prefs);
  const persistPrefs = useCallback((next: EvalPreferences) => {
    const changed = next.depth !== prefsRef.current.depth ||
      next.samples !== prefsRef.current.samples ||
      next.mode !== prefsRef.current.mode ||
      next.tera !== prefsRef.current.tera;
    prefsRef.current = next;
    setPrefsState(next);
    try {
      const kept = opponentReadsEnabled() ? undefined : storedHardMode();
      localStorage.setItem(PREFS_KEY, JSON.stringify(kept ? { ...next, hardMode: kept } : next));
    } catch {
      // Storage full or blocked: the prefs still apply for this session.
    }
    return changed;
  }, []);
  return { prefs, prefsRef, persistPrefs };
}

export type EngineMode = NonNullable<EvalSettings['mode']>;

export interface TurnEvalSettings {
  depth: EvalSettings['depth'];
  samples: EvalSettings['samples'];
  mode: EngineMode;
}

/** The auto mode's verified line configuration at one position; independent of the depth prefs. */
export function resolveAutoTurnSettings(faintedFraction: number, doubles: boolean): TurnEvalSettings {
  return autoTurnSettings(faintedFraction, doubles);
}

/** The team-preview lead under auto: the budget's lead matrix in both game types. */
export function resolveAutoLeadSettings(): TurnEvalSettings {
  const { depth, samples } = searchBudget().lead;
  return { depth, samples, mode: 'matrix' };
}

/** Auto's routing signals from a serialized battle, sim-free; singles when it names no game type. */
export function serializedAutoRouting(serialized: string): { faintedFraction: number; doubles: boolean } {
  const battle = JSON.parse(serialized) as { gameType?: string; sides?: { pokemon?: { hp?: number; fainted?: boolean }[] }[] };
  let fainted = 0;
  let total = 0;
  for (const side of battle.sides ?? []) {
    for (const pokemon of side.pokemon ?? []) {
      total += 1;
      if (pokemon.fainted || (pokemon.hp ?? 0) <= 0) fainted += 1;
    }
  }
  return { faintedFraction: total > 0 ? fainted / total : 0, doubles: battle.gameType === 'doubles' };
}

export function serializedFaintedFraction(serialized: string): number {
  return serializedAutoRouting(serialized).faintedFraction;
}

// null: auto prefs with no recorded fainted fraction; callers stay conservative until a sweep resolves it.
const configuredTarget = (
  mode: EvalPreferences['mode'],
  faintedFraction: number | null | undefined,
  doubles: boolean,
): EngineMode | null =>
  mode !== 'auto' ? mode : faintedFraction == null ? null : resolveAutoTurnSettings(faintedFraction, doubles).mode;

/** Monotone merge: a shallower result never replaces a deeper one; a cross-mode result needs the configured mode. */
export function supersedesStored(
  stored: TurnEvalSettings | null,
  incoming: TurnEvalSettings,
  configuredMode: EvalPreferences['mode'],
  faintedFraction?: number | null,
  doubles = false,
): boolean {
  if (!stored) return true;
  if (stored.mode !== incoming.mode) {
    return incoming.mode === configuredTarget(configuredMode, faintedFraction, doubles);
  }
  if (incoming.mode === 'mcts') return true;
  return incoming.depth >= stored.depth && incoming.samples >= stored.samples;
}
