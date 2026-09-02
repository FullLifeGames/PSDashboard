import { useEffect, useMemo, useState } from 'react';
import type { ReplayData, TurnSnapshot } from '@fulllifegames/replay-core';
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
}) {
  const {
    replayData, snapshots, sources, bringOnlyLists, replayGenNumber, liveTip, viewingVariation,
    serializedAtView, viewTurn, variationStartTurn, startSerialized, getExact, exactPositionsVersion,
    draftChoices,
  } = args;
  const [resolvedPicker, setPositionPicker] = useState<{ simState: BranchSimState; source: PickerSource } | null>(null);
  // Live-tip positions render the sim's own state: the resolved picker is
  // hidden by derivation (a synchronous clear here would be a setState in
  // an effect, which the react-hooks gate forbids).
  const positionPicker = liveTip ? null : resolvedPicker;
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
      if (!cancelled) setPositionPicker(resolved);
    });
    return () => {
      cancelled = true;
    };
  }, [
    liveTip, viewingVariation, serializedAtView, variationStartTurn, startSerialized, viewTurn, snapshots,
    replayData, sources, replayGenNumber, getExact, exactPositionsVersion, bringOnlyLists,
  ]);

  /** Non-live positions render the resolved picker state with the DRAFT
   *  choices mirrored in — the panel's selection logic reads simState. */
  // (resolver lives below the hook to keep this function under the caps)
  const pickerSimState = useMemo(() => (positionPicker ? {
    ...positionPicker.simState,
    p1Choice: draftChoices.p1[0] ?? null,
    p1Choices: draftChoices.p1,
    p2Choice: draftChoices.p2[0] ?? null,
    p2Choices: draftChoices.p2,
  } : null), [positionPicker, draftChoices]);

  return { positionPicker, pickerSimState };
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
  const snapshot = snapshots[Math.min(viewTurn - 1, snapshots.length - 1)] ?? null;
  if (!snapshot || !replayData) return null;
  const [{ pickerStateFromSnapshot }, teams] = await Promise.all([
    import('../lib/picker-state'),
    buildReplayTeams(replayData, sources),
  ]);
  return { simState: pickerStateFromSnapshot(snapshot, teams.p1Team, teams.p2Team, replayGenNumber, bringOnlyLists), source: 'snapshot' };
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
