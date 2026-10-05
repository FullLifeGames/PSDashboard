import { useCallback, useRef, useState } from 'react';
import { autoTurnSettings, searchBudget, type EvalPreferences, type EvalSettings } from '@fulllifegames/eval-engine';

const PREFS_KEY = 'ps-replay-interceptor:eval-prefs';
// Default line engine: 'auto' — the measured-best line per game type from
// the search budget (search/budget.ts). depth/samples apply when the user
// picks an explicit matrix mode; stored user prefs always win over this
// default.
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
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

/**
 * The panel preferences with their synchronous ref (evaluate and the sweep
 * are stable callbacks and read the CURRENT prefs through it) and the
 * localStorage persistence. `persistPrefs` returns whether an
 * engine-relevant setting changed — the caller marks a done result stale.
 */
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
      localStorage.setItem(PREFS_KEY, JSON.stringify(next));
    } catch {
      // Storage full/blocked — the prefs still apply for this session.
    }
    return changed;
  }, []);
  return { prefs, prefsRef, persistPrefs };
}

/** A concrete engine — what actually runs and what stored results carry ('auto' resolves before dispatch). */
export type EngineMode = NonNullable<EvalSettings['mode']>;

/** The engine settings that produced a stored per-turn result (always concrete — never 'auto'). */
export interface TurnEvalSettings {
  depth: EvalSettings['depth'];
  samples: EvalSettings['samples'];
  mode: EngineMode;
}

/**
 * Resolve the auto mode at one position: the VERIFIED line configuration
 * from the search budget (search/budget.ts). Since round 63 (T110) each game
 * type has its own split: below its tree threshold auto runs its early
 * matrix, at or above it the DUCT tree. Auto is a complete engine spec,
 * independent of the depth prefs, which apply to the explicit matrix modes
 * only.
 */
export function resolveAutoTurnSettings(faintedFraction: number, doubles: boolean): TurnEvalSettings {
  return autoTurnSettings(faintedFraction, doubles);
}

/**
 * The team-preview lead under auto: the budget's lead matrix in both game
 * types, whatever the early splits. Measured in round 61 on the 128 bank
 * games with a team preview (gen 5 on): the tree read doubles previews
 * worse (hq +267 bp [+20, +534]) and singles no differently (-9 bp,
 * unresolved).
 */
export function resolveAutoLeadSettings(): TurnEvalSettings {
  const { depth, samples } = searchBudget().lead;
  return { depth, samples, mode: 'matrix' };
}

/**
 * Auto's two routing signals on a serialized battle (sim-free for the UI
 * chunk): the engine's battleFaintedFraction and the game type (a battle
 * without one is singles, the simulator's default).
 */
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

/** Mirror of the engine's battleFaintedFraction on a serialized battle. */
export function serializedFaintedFraction(serialized: string): number {
  return serializedAutoRouting(serialized).faintedFraction;
}

/**
 * The turn's configured target engine: 'auto' resolves through the
 * position's fainted fraction and the game type when the fraction is known;
 * null = unresolvable (auto prefs but the fraction was never recorded for
 * this turn — callers stay conservative until a sweep resolves it).
 */
const configuredTarget = (
  mode: EvalPreferences['mode'],
  faintedFraction: number | null | undefined,
  doubles: boolean,
): EngineMode | null =>
  mode !== 'auto' ? mode : faintedFraction == null ? null : resolveAutoTurnSettings(faintedFraction, doubles).mode;

/**
 * The stored result is SHALLOWER than the panel preferences — the turn can
 * be re-run at full settings (the explicit deepen button offers exactly
 * that). Deeper/heavier stored results never downgrade (a depth-2 result
 * stays shown under depth-1 prefs); that includes a matrix escalation of
 * depth ≥ 2 sitting on an MCTS-target turn (a think-deeper product stored
 * before round 32, when the ladder still crossed engines): settled, not
 * stale. Auto prefs resolve through the turn's
 * fainted fraction and the game type (`doubles`, read by auto only); with
 * the fraction unknown the answer is conservative (no upgrade claimed — the
 * next sweep resolves it).
 */
export function needsSettingsUpgrade(
  stored: TurnEvalSettings | null,
  prefs: EvalPreferences,
  faintedFraction?: number | null,
  doubles = false,
): boolean {
  if (!stored) return true;
  const escalatedPastMcts = (target: EngineMode) =>
    target === 'mcts' && stored.mode === 'matrix' && stored.depth >= 2;
  if (prefs.mode === 'auto') {
    const target = configuredTarget('auto', faintedFraction, doubles);
    if (target === null) return false;
    const resolved = resolveAutoTurnSettings(faintedFraction!, doubles);
    if (stored.mode !== resolved.mode) return !escalatedPastMcts(resolved.mode);
    if (resolved.mode === 'mcts') return false;
    return stored.depth < resolved.depth || stored.samples < resolved.samples;
  }
  if (stored.mode !== prefs.mode) return !escalatedPastMcts(prefs.mode);
  if (prefs.mode === 'mcts') return false;
  return stored.depth < prefs.depth || stored.samples < prefs.samples;
}

/**
 * May a sweep pass replace the graph's stored per-turn data? Monotone merge:
 * a shallower result never overwrites a deeper one — the fast re-scan of a
 * later "Analyze game" must not downgrade an explicitly deepened turn.
 * Cross-mode results replace only when the incoming pass carries the
 * CONFIGURED engine mode (the user's stated intent beats a stale result
 * from the other engine) — except that a matrix escalation of depth ≥ 2
 * outranks the d1s1-grade MCTS tier in BOTH directions: the think-deeper
 * click's d2s3 pass LANDS on a stored MCTS turn even though matrix is not
 * that turn's configured engine, and once stored it survives the next
 * MCTS-target sweep. Auto resolves per turn via the fainted fraction and
 * the game type (`doubles`, read by auto only); unresolvable cross-mode
 * conflicts keep the stored result (fail closed).
 */
export function supersedesStored(
  stored: TurnEvalSettings | null,
  incoming: TurnEvalSettings,
  configuredMode: EvalPreferences['mode'],
  faintedFraction?: number | null,
  doubles = false,
): boolean {
  if (!stored) return true;
  if (stored.mode !== incoming.mode) {
    if (incoming.mode === 'matrix' && incoming.depth >= 2 && stored.mode === 'mcts') return true;
    if (incoming.mode !== configuredTarget(configuredMode, faintedFraction, doubles)) return false;
    return !(incoming.mode === 'mcts' && stored.mode === 'matrix' && stored.depth >= 2);
  }
  if (incoming.mode === 'mcts') return true;
  return incoming.depth >= stored.depth && incoming.samples >= stored.samples;
}
