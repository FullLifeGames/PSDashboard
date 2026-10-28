import { useEffect, useMemo, useState } from 'react';
import { getBranchSimulatorFormat, type ReplayData, type TurnSnapshot } from '@fulllifegames/replay-core';
import type { BranchSlotChoice } from '@fulllifegames/eval-engine';
import type { PickerSource } from '../lib/picker-state';
import { buildReplayTeams, type TeamBuildSources } from '../lib/eval-acquire';
import type { VariationSpan } from '../lib/timeline';
import type { BranchHistoryEntry, BranchSimState } from './useBranch';
import type { PlayedPick } from '../components/BranchPanel';

/**
 * Picker state for the viewed position when the live sim is elsewhere
 * (variant B): exact from the recorded position where one exists, else
 * approximate from snapshot + guessed teams. Live-tip positions render
 * the sim's own state and skip this entirely.
 */
export function usePositionPicker(args: {
  replayData: ReplayData | null;
  snapshots: TurnSnapshot[];
  sources: TeamBuildSources;
  bringOnlyLists: { p1: string[]; p2: string[] } | null;
  replayGenNumber: number;
  liveTip: boolean;
  viewingVariation: boolean;
  serializedAtView: string | null;
  viewTurn: number;
  variationStartTurn: number | null;
  startSerialized: string | null;
  getExact: (turn: number) => string | null;
  exactPositionsVersion: number;
  draftChoices: { p1: (BranchSlotChoice | null)[]; p2: (BranchSlotChoice | null)[] };
  /** The live sim's state: the panel's stand-in for the first frames after leaving the tip. */
  liveSimState: BranchSimState | null;
}) {
  const {
    replayData, snapshots, sources, bringOnlyLists, replayGenNumber, liveTip, viewingVariation,
    serializedAtView, viewTurn, variationStartTurn, startSerialized, getExact, exactPositionsVersion,
    draftChoices, liveSimState,
  } = args;
  const [resolvedPicker, setPositionPicker] = useState<ResolvedPicker | null>(null);
  // Live-tip positions render the sim's own state, and a picker resolved
  // for another position never stands for the viewed one: both by
  // derivation (a synchronous clear here would be a setState in an effect,
  // which the react-hooks gate forbids).
  const viewKey = `${viewingVariation ? 'variation' : 'main'}:${viewTurn}`;
  const positionPicker = !liveTip && resolvedPicker?.viewKey === viewKey ? resolvedPicker : null;
  const standIn = useStandIn(liveTip, positionPicker, resolvedPicker, liveSimState);
  const shownState = positionPicker?.simState ?? standIn;
  useEffect(() => {
    let cancelled = false;
    if (liveTip) return;
    const exactMainLine = !viewingVariation ? getExact(viewTurn) : null;
    const stored = viewingVariation
      ? serializedAtView
      : (viewTurn === variationStartTurn ? startSerialized : null) ?? exactMainLine;
    void resolvePickerState({
      stored, viewingVariation, viewTurn, snapshots, replayData, sources, replayGenNumber, bringOnlyLists,
    }).then(resolved => {
      if (!cancelled) setPositionPicker(resolved ? { ...resolved, viewKey } : null);
    });
    return () => {
      cancelled = true;
    };
  }, [
    liveTip, viewingVariation, viewKey, serializedAtView, variationStartTurn, startSerialized, viewTurn, snapshots,
    replayData, sources, replayGenNumber, getExact, exactPositionsVersion, bringOnlyLists,
  ]);

  /** Non-live positions render the resolved picker state with the DRAFT
   *  choices mirrored in — the panel's selection logic reads simState. */
  // (resolver lives below the hook to keep this function under the caps)
  const pickerSimState = useMemo(() => (shownState ? {
    ...shownState,
    p1Choice: draftChoices.p1[0] ?? null,
    p1Choices: draftChoices.p1,
    p2Choice: draftChoices.p2[0] ?? null,
    p2Choices: draftChoices.p2,
  } : null), [shownState, draftChoices]);

  return { positionPicker, pickerSimState, pickerStale: standIn !== null };
}

type ResolvedPicker = { simState: BranchSimState; source: PickerSource; viewKey: string };

/**
 * Round 77 (user report 28.10.2026): one turn back from the tip showed the
 * last resolved position's picker (another turn, another Pokémon) until the
 * viewed one resolved, and a click there chose a move of a Pokémon that was
 * not on the field. While the viewed position resolves, the panel keeps what
 * it showed last, the live tip or the last resolved position, so it keeps
 * its height; the stand-in is stale and the panel takes no input.
 */
function useStandIn(
  liveTip: boolean, positionPicker: ResolvedPicker | null, resolvedPicker: ResolvedPicker | null, liveSimState: BranchSimState | null,
): BranchSimState | null {
  const shownNow = liveTip ? 'live' : positionPicker ? 'resolved' : null;
  const [shownLast, setShownLast] = useState<'live' | 'resolved'>(shownNow ?? 'resolved');
  if (shownNow !== null && shownNow !== shownLast) setShownLast(shownNow);
  if (shownNow !== null) return null;
  return shownLast === 'live' ? liveSimState : resolvedPicker?.simState ?? null;
}

/** Exact recording first, then the snapshot approximation; null when the
 *  position cannot be shown (variation gap, missing snapshot). */
async function resolvePickerState(args: {
  stored: string | null;
  viewingVariation: boolean;
  viewTurn: number;
  snapshots: TurnSnapshot[];
  replayData: ReplayData | null;
  sources: TeamBuildSources;
  replayGenNumber: number;
  bringOnlyLists: { p1: string[]; p2: string[] } | null;
}): Promise<{ simState: BranchSimState; source: PickerSource } | null> {
  const { stored, viewingVariation, viewTurn, snapshots, replayData, sources, replayGenNumber, bringOnlyLists } = args;
  if (stored) {
    const { pickerStateFromSerialized } = await import('../lib/picker-state');
    try {
      const state = await pickerStateFromSerialized(stored);
      return { simState: state, source: 'stored' };
    } catch {
      // Fall through to the snapshot approximation.
    }
  }
  if (viewingVariation) {
    // A variation position without a usable capture has no snapshot
    // either — the pickers stay empty until a rebuild passes through.
    return null;
  }
  const index = Math.min(viewTurn - 1, snapshots.length - 1);
  const snapshot = snapshots[index] ?? null;
  if (!snapshot || !replayData) return null;
  // The approximation needs the guessed moves and items, not a spread
  // solve: it takes the solved spreads when a solve already exists and
  // never starts one (the solve used to run three times during a load,
  // once per arriving Smogon payload, before the dwell even fired).
  const [{ pickerStateFromSnapshot, teraUsedSides }, teams] = await Promise.all([
    import('../lib/picker-state'),
    buildReplayTeams(replayData, sources, undefined, { cachedOnly: true }),
  ]);
  // Round 67 (T136): the fast picker offers Tera where the simulator will: the branch format allows it,
  // and the side has not terastallized in any turn so far.
  const rules = { format: getBranchSimulatorFormat(replayData), teraUsed: teraUsedSides(snapshots.slice(0, index + 1)) };
  // Round 67 merge (T145): the fast picker asks the simulator whether the format offers Tera, and a Champions
  // format exists only once its mod is loaded.
  const { loadSimMods } = await import('../lib/lazy/branch-engine');
  await loadSimMods(rules.format);
  return { simState: pickerStateFromSnapshot(snapshot, teams.p1Team, teams.p2Team, replayGenNumber, bringOnlyLists, rules), source: 'snapshot' };
}

/**
 * What the viewed line actually played at this position — the answer to
 * "which move did they press here?". Main line: the replay protocol's
 * action for this turn. Variation (behind the tip): the recorded entry's
 * choices. The tip itself has no played move yet.
 */
export function usePlayedAtView(args: {
  viewingVariation: boolean;
  variationSpan: VariationSpan | null;
  viewTurn: number;
  history: BranchHistoryEntry[];
  snapshots: TurnSnapshot[];
  doubles: boolean;
  parseSingles: (lines: string[]) => { p1: PlayedAction | null; p2: PlayedAction | null };
  parseDoubles: (lines: string[]) => { p1: PlayedAction | null; p2: PlayedAction | null };
}) {
  const { viewingVariation, variationSpan, viewTurn, history, snapshots, doubles, parseSingles, parseDoubles } = args;
  return useMemo<{ p1: PlayedPick | null; p2: PlayedPick | null } | null>(() => {
    if (viewingVariation && variationSpan) {
      return playedFromHistory(history, viewTurn - variationSpan.startTurn);
    }
    const lines = snapshots[viewTurn]?.log;
    if (!lines || lines.length === 0) return null;
    const turn = doubles ? parseDoubles(lines) : parseSingles(lines);
    if (!turn.p1 && !turn.p2) return null;
    return { p1: fromAction(turn.p1), p2: fromAction(turn.p2) };
  }, [viewingVariation, variationSpan, viewTurn, history, snapshots, doubles, parseSingles, parseDoubles]);
}

type PlayedAction = { kind: 'move' | 'switch'; name: string; species?: string };

function fromAction(action: PlayedAction | null): PlayedPick | null {
  return action ? { kind: action.kind, name: action.name, ...(action.species ? { species: action.species } : {}) } : null;
}

function playedFromHistory(history: BranchHistoryEntry[], index: number): { p1: PlayedPick | null; p2: PlayedPick | null } | null {
  let count = 0;
  for (const entry of history) {
    if (entry.kind === 'forced') continue;
    if (count === index) {
      const fromSlots = (slots: (BranchSlotChoice | null)[] | undefined): PlayedPick | null => {
        const first = (slots ?? []).find(Boolean) ?? null;
        if (!first) return null;
        return first.kind === 'move'
          ? { kind: 'move', name: first.moveName }
          : { kind: 'switch', name: first.pokemonName, species: first.speciesId };
      };
      return { p1: fromSlots(entry.p1SlotChoices), p2: fromSlots(entry.p2SlotChoices) };
    }
    count += 1;
  }
  return null;
}
