import { useCallback, useEffect, useMemo, useState } from 'react';
import { getBranchSimulatorFormat, type ReplayData, type TurnSnapshot } from '@fulllifegames/replay-core';
import type { BranchSlotChoice } from '@fulllifegames/eval-engine';
import type { PickerBattle, PickerSource } from '../lib/picker-state';
import type { Bench } from '../lib/bench';
import { buildReplayTeams, type TeamBuildSources } from '../lib/eval-acquire';
import type { VariationSpan } from '../lib/timeline';
import type { BranchHistoryEntry, BranchSimState } from './useBranch';
import type { PlayedAtPosition, PlayedPick } from '../lib/played-pick';
import { mergeChoices, seedChoices } from '../lib/dock-seed';
import { turnEntryAt } from '../lib/variation-turns';

/** Picker state for the viewed position when the live sim is elsewhere: exact from the recorded position, else approximate from snapshot + guessed teams. */
export function usePositionPicker(args: {
  replayData: ReplayData | null;
  snapshots: TurnSnapshot[];
  sources: TeamBuildSources;
  bench: Bench | null;
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
  liveSimState: BranchSimState | null;
  played?: PlayedAtPosition | null;
}) {
  const {
    replayData, snapshots, sources, bench, replayGenNumber, liveTip, viewingVariation,
    serializedAtView, viewTurn, variationStartTurn, startSerialized, getExact, exactPositionsVersion,
    draftChoices, liveSimState, played,
  } = args;
  const [resolution, setResolution] = useState<{ viewKey: string; picker: ResolvedPicker | null } | null>(null);
  // Live-tip positions render the sim's own state, and a picker resolved for another position never stands for the viewed one;
  // both come by derivation (a synchronous clear would be a setState in an effect).
  const viewKey = `${viewingVariation ? 'variation' : 'main'}:${viewTurn}`;
  const landed = !liveTip && resolution?.viewKey === viewKey;
  const positionPicker = landed ? resolution!.picker : null;
  const standIn = useStandIn(liveTip, landed, resolution?.picker ?? null, liveSimState);
  const shownState = positionPicker?.simState ?? standIn;
  useEffect(() => {
    let cancelled = false;
    if (liveTip) return;
    const exactMainLine = !viewingVariation ? getExact(viewTurn) : null;
    const stored = viewingVariation
      ? serializedAtView
      : (viewTurn === variationStartTurn ? startSerialized : null) ?? exactMainLine;
    void resolvePickerState({
      stored, viewingVariation, viewTurn, snapshots, replayData, sources, replayGenNumber, bench,
    }).then(resolved => {
      if (!cancelled) setResolution({ viewKey, picker: resolved });
    });
    return () => {
      cancelled = true;
    };
  }, [
    liveTip, viewingVariation, viewKey, serializedAtView, variationStartTurn, startSerialized, viewTurn, snapshots,
    replayData, sources, replayGenNumber, getExact, exactPositionsVersion, bench,
  ]);

  const { pickerSeed, pickerSimState } = useEffectivePicker(shownState, positionPicker, played, draftChoices);

  const pickerBattle = positionPicker?.battle ?? null;
  const getPickerBattle = useCallback(() => pickerBattle, [pickerBattle]);
  // The main line shows the replay's own turn at a stored position: the log's dice come from the replay's lines. A variation's
  // position is no turn of the replay.
  const pickerReplayLog = pickerBattle && !viewingVariation ? replayData?.log : undefined;
  return { positionPicker, pickerSimState, pickerSeed, pickerStale: standIn !== null, getPickerBattle: pickerBattle ? getPickerBattle : undefined, pickerReplayLog };
}

/**
 * The seed is derived, never stored: a slot without a draft entry shows the choice the viewed line played; the draft wins slot by
 * slot, and navigation clearing it brings the seed back. The seed reads the resolved picker only (a stand-in belongs to another
 * position).
 */
function useEffectivePicker(
  shownState: BranchSimState | null, positionPicker: ResolvedPicker | null, played: PlayedAtPosition | null | undefined,
  draftChoices: { p1: (BranchSlotChoice | null)[]; p2: (BranchSlotChoice | null)[] },
) {
  const pickerSeed = useMemo(
    () => (positionPicker && played ? seedChoices(played, positionPicker.simState) : null),
    [positionPicker, played],
  );
  const pickerSimState = useMemo(() => {
    if (!shownState) return null;
    const effective = pickerSeed ? mergeChoices(pickerSeed, draftChoices) : draftChoices;
    return {
      ...shownState,
      p1Choice: effective.p1[0] ?? null,
      p1Choices: effective.p1,
      p2Choice: effective.p2[0] ?? null,
      p2Choices: effective.p2,
    };
  }, [shownState, pickerSeed, draftChoices]);
  return { pickerSeed, pickerSimState };
}

type ResolvedPicker = { simState: BranchSimState; source: PickerSource; battle?: PickerBattle };

/**
 * While the viewed position resolves, the panel keeps what it showed last (the live tip or the last resolved position) so it keeps
 * its height. The stand-in is stale and the panel takes no input: a click on the last resolved picker would choose a move of a
 * Pokémon that is not on the field. Once the viewed position lands, with a picker or without one, the stand-in ends.
 */
function useStandIn(
  liveTip: boolean, landed: boolean, lastPicker: ResolvedPicker | null, liveSimState: BranchSimState | null,
): BranchSimState | null {
  const shownNow = liveTip ? 'live' : landed ? 'resolved' : null;
  const [shownLast, setShownLast] = useState<'live' | 'resolved'>(shownNow ?? 'resolved');
  if (shownNow !== null && shownNow !== shownLast) setShownLast(shownNow);
  if (shownNow !== null) return null;
  return shownLast === 'live' ? liveSimState : lastPicker?.simState ?? null;
}

async function resolvePickerState(args: {
  stored: string | null;
  viewingVariation: boolean;
  viewTurn: number;
  snapshots: TurnSnapshot[];
  replayData: ReplayData | null;
  sources: TeamBuildSources;
  replayGenNumber: number;
  bench: Bench | null;
}): Promise<ResolvedPicker | null> {
  const { stored, viewingVariation, viewTurn, snapshots, replayData, sources, replayGenNumber, bench } = args;
  if (stored) {
    const { pickerFromSerialized } = await import('../lib/picker-state');
    try {
      const { state, battle } = await pickerFromSerialized(stored, bench);
      return { simState: state, source: 'stored', battle };
    } catch {
      // Falls through to the snapshot approximation.
    }
  }
  if (viewingVariation) {
    return null;
  }
  const index = Math.min(viewTurn - 1, snapshots.length - 1);
  const snapshot = snapshots[index] ?? null;
  if (!snapshot || !replayData) return null;
  // The approximation uses solved spreads when a solve exists and never starts one (the solve ran three times per load).
  const [{ pickerStateFromSnapshot, teraUsedSides }, teams] = await Promise.all([
    import('../lib/picker-state'),
    buildReplayTeams(replayData, sources, undefined, { cachedOnly: true }),
  ]);
  // The fast picker offers Tera where the simulator will: the branch format allows it and the side has not terastallized so far.
  const rules = { format: getBranchSimulatorFormat(replayData), teraUsed: teraUsedSides(snapshots.slice(0, index + 1)) };
  // A Champions format exists in the simulator only once its mod is loaded.
  const { loadSimMods } = await import('../lib/lazy/branch-engine');
  await loadSimMods(rules.format);
  return { simState: pickerStateFromSnapshot(snapshot, teams.p1Team, teams.p2Team, replayGenNumber, bench?.lists ?? null, rules), source: 'snapshot' };
}

/** What the viewed line played at this position: main line from the replay protocol, variation from the recorded entry. */
export function usePlayedAtView(args: {
  viewingVariation: boolean;
  variationSpan: VariationSpan | null;
  viewTurn: number;
  history: BranchHistoryEntry[];
  snapshots: TurnSnapshot[];
  doubles: boolean;
  parseSingles: (lines: string[]) => PlayedActions;
  parseDoubles: (lines: string[]) => PlayedActions;
}) {
  const { viewingVariation, variationSpan, viewTurn, history, snapshots, doubles, parseSingles, parseDoubles } = args;
  return useMemo<PlayedAtPosition | null>(() => {
    if (viewingVariation && variationSpan) {
      return playedFromHistory(history, viewTurn - variationSpan.startTurn);
    }
    return playedFromLines(snapshots[viewTurn]?.log, doubles, parseSingles, parseDoubles);
  }, [viewingVariation, variationSpan, viewTurn, history, snapshots, doubles, parseSingles, parseDoubles]);
}

export function playedFromLines(
  lines: string[] | undefined, doubles: boolean,
  parseSingles: (lines: string[]) => PlayedActions, parseDoubles: (lines: string[]) => PlayedActions,
): PlayedAtPosition | null {
  if (!lines || lines.length === 0) return null;
  const turn = doubles ? parseDoubles(lines) : parseSingles(lines);
  if (!doubles) return turn.p1 || turn.p2 ? { p1: fromAction(turn.p1), p2: fromAction(turn.p2) } : null;
  const p1Slots = (turn.p1Slots ?? []).map(fromAction);
  const p2Slots = (turn.p2Slots ?? []).map(fromAction);
  if (![...p1Slots, ...p2Slots].some(Boolean)) return null;
  return withSlots(p1Slots, p2Slots);
}

type PlayedAction = {
  kind: 'move' | 'switch'; name: string; species?: string;
  tera?: boolean; mega?: boolean; ultra?: boolean; targetLoc?: number | null;
};
export type PlayedActions = {
  p1: PlayedAction | null;
  p2: PlayedAction | null;
  p1Slots?: (PlayedAction | null)[];
  p2Slots?: (PlayedAction | null)[];
};

function fromAction(action: PlayedAction | null): PlayedPick | null {
  if (!action) return null;
  const modifier = action.tera ? 'terastallize' : action.mega ? 'mega' : action.ultra ? 'ultra' : undefined;
  return {
    kind: action.kind, name: action.name,
    ...(action.species ? { species: action.species } : {}),
    ...(action.targetLoc !== undefined ? { targetLoc: action.targetLoc } : {}),
    ...(modifier ? { modifier } : {}),
  };
}

function withSlots(p1Slots: (PlayedPick | null)[], p2Slots: (PlayedPick | null)[]): PlayedAtPosition {
  return { p1: p1Slots.find(Boolean) ?? null, p2: p2Slots.find(Boolean) ?? null, p1Slots, p2Slots };
}

function fromChoice(choice: BranchSlotChoice | null): PlayedPick | null {
  if (!choice) return null;
  return choice.kind === 'move'
    ? {
      kind: 'move', name: choice.moveName,
      ...(choice.targetLoc !== undefined ? { targetLoc: choice.targetLoc } : {}),
      ...(choice.modifier ? { modifier: choice.modifier } : {}),
      recorded: choice,
    }
    : { kind: 'switch', name: choice.pokemonName, species: choice.speciesId, recorded: choice };
}

export function playedFromHistory(history: BranchHistoryEntry[], index: number): PlayedAtPosition | null {
  // The entry that plays the turn, whatever the interludes before it (a replacement on both sides is one).
  const entry = turnEntryAt(history, index);
  if (!entry) return null;
  const p1Slots = (entry.p1SlotChoices ?? []).map(fromChoice);
  const p2Slots = (entry.p2SlotChoices ?? []).map(fromChoice);
  if (p1Slots.length <= 1 && p2Slots.length <= 1) return { p1: p1Slots[0] ?? null, p2: p2Slots[0] ?? null };
  return withSlots(p1Slots, p2Slots);
}
