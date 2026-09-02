import { useCallback } from 'react';
import type { PokemonSet } from '@pkmn/sim';
import type { TurnSnapshot } from '../../types';
import type { ChoiceLockContext } from '../../lib/choice-lock';
import type { BranchRuntime } from '../../lib/branch-engine';
import type { BranchSlotChoice } from '../../lib/branch-choices';
import {
  makeHistoryEntry, requiredChoices,
  type BranchEngineModule, type BranchHistoryEntry, type BranchRefs, type BranchSetters, type BattleStream, type SideId,
} from './shared';

export interface StartBranchOptions {
  replayHistory?: BranchHistoryEntry[];
  p1Choices?: (BranchSlotChoice | null)[];
  p2Choices?: (BranchSlotChoice | null)[];
  playerNames?: [string, string];
  onProgress?: (turn: number, targetTurn: number) => void;
  abort?: AbortSignal;
  /**
   * Per-turn snapshots for boundary correction during the replay — without
   * them a long reconstruction drifts (guessed sets force different replays)
   * and the branch can open with the wrong Pokémon on the field.
   */
  snapshotFor?: (turn: number) => TurnSnapshot | null;
  /** Protocol-truth lock context (③) for the boundary corrections. */
  choiceLocks?: ChoiceLockContext;
  /**
   * Turn-0 branching (targetTurn 0): start a FRESH game with these leads
   * (one per side in singles, two in doubles, slot order preserved). With
   * `bring` the lists are the whole brought selection (VGC 4 of 6) and the
   * teams trim to them. The runtime rebuilds to turn 1 without snapshot
   * corrections, and the lead decision is history entry 0 (turnNumber 0).
   */
  leadOverride?: { p1: string[]; p2: string[]; bring?: boolean };
  /**
   * Bring-limited formats (VGC 4 of 6): field only the species the real
   * game brought — on any branch turn, so evaluations and play-outs on the
   * live battle can never switch into a never-brought Pokémon.
   */
  bringOnly?: { p1: string[]; p2: string[] };
}

type ReplayEntryOutcome =
  | { ok: true; entry: BranchHistoryEntry }
  | { ok: false; error: string };

/** The commands one recorded entry resolves to against the rebuilt battle. */
function resolveEntryCommands(
  branchEngine: BranchEngineModule, battle: NonNullable<BattleStream['battle']>, entry: BranchHistoryEntry,
): { ok: true; commands: { side: SideId; command: string }[]; p1Command: string; p2Command: string } | { ok: false; error: string } {
  if (entry.kind === 'forced' && entry.forcedSide) {
    const side = entry.forcedSide;
    const slotChoices = side === 'p1' ? entry.p1SlotChoices : entry.p2SlotChoices;
    if (!slotChoices) return { ok: false, error: 'Missing forced-switch data in the branch history.' };
    const resolved = branchEngine.resolveSideChoices(battle, side, slotChoices, requiredChoices(battle, side));
    if (!resolved.ok) return resolved;
    return {
      ok: true,
      commands: [{ side, command: resolved.command }],
      p1Command: side === 'p1' ? resolved.command : '—',
      p2Command: side === 'p2' ? resolved.command : '—',
    };
  }
  if (entry.p1SlotChoices && entry.p2SlotChoices) {
    const p1 = branchEngine.resolveSideChoices(battle, 'p1', entry.p1SlotChoices, requiredChoices(battle, 'p1'));
    if (!p1.ok) return p1;
    const p2 = branchEngine.resolveSideChoices(battle, 'p2', entry.p2SlotChoices, requiredChoices(battle, 'p2'));
    if (!p2.ok) return p2;
    return {
      ok: true,
      commands: [
        { side: 'p1', command: p1.command },
        { side: 'p2', command: p2.command },
      ],
      p1Command: p1.command,
      p2Command: p2.command,
    };
  }
  // Entries recorded before identity-based choices existed: replay verbatim.
  return {
    ok: true,
    commands: [
      { side: 'p1', command: entry.p1Choice },
      { side: 'p2', command: entry.p2Choice },
    ],
    p1Command: entry.p1Choice,
    p2Command: entry.p2Choice,
  };
}

/**
 * Re-applies one recorded history entry against a freshly rebuilt runtime.
 * Choices are re-resolved by identity against the current request, so a team
 * edit can never silently replay the wrong move — mismatches abort with a
 * visible error instead (B1).
 */
async function replayHistoryEntry(
  runtime: BranchRuntime,
  branchEngine: BranchEngineModule,
  entry: BranchHistoryEntry,
): Promise<ReplayEntryOutcome> {
  const battle = runtime.battleStream.battle;
  if (!battle || battle.ended) {
    return { ok: false, error: 'The rebuilt battle ended before this turn.' };
  }

  const turnNumber = battle.turn ?? 0;
  const resolved = resolveEntryCommands(branchEngine, battle, entry);
  if (!resolved.ok) return resolved;

  const result = await branchEngine.executeBranchChoices({
    streams: runtime.streams,
    log: runtime.log,
    choiceErrors: runtime.choiceErrors,
    commands: resolved.commands,
  });
  if (!result.ok) return result;

  const nextState = branchEngine.createBranchState(runtime.battleStream, runtime.log, {
    p1Choices: [],
    p2Choices: [],
  });
  // The rebuild's own position replaces whatever the replayed entry carried —
  // after a team edit the old capture no longer describes this battle.
  const serializedPosition = branchEngine.captureSerializedPosition(runtime.battleStream.battle);
  return {
    ok: true,
    entry: {
      ...makeHistoryEntry(turnNumber, resolved.p1Command, resolved.p2Command, nextState),
      serializedPosition,
      kind: entry.kind ?? 'turn',
      ...(entry.forcedSide ? { forcedSide: entry.forcedSide } : {}),
      ...(entry.p1SlotChoices ? { p1SlotChoices: entry.p1SlotChoices } : {}),
      ...(entry.p2SlotChoices ? { p2SlotChoices: entry.p2SlotChoices } : {}),
    },
  };
}

/**
 * Turn-0 lead branch: a FRESH game (no replayed blocks, no snapshot
 * corrections — they would put the original leads right back) rebuilt to
 * the start of turn 1 with the chosen leads first in the team order. The
 * leads come from the caller or — on a rebuild of an existing turn-0
 * variation (team edit, truncation) — from the recorded lead entry,
 * which is re-seeded here instead of replaying through the sim.
 */
function resolveLeadPlan(isT0: boolean, options: StartBranchOptions | undefined) {
  const historyLead = isT0 ? options?.replayHistory?.[0]?.leadChoices : undefined;
  const leadOverride = isT0 ? options?.leadOverride ?? historyLead : undefined;
  const historyToReplay = historyLead ? (options?.replayHistory ?? []).slice(1) : options?.replayHistory ?? [];
  return { leadOverride, historyToReplay };
}

function resolveStartPlan(targetTurn: number, options: StartBranchOptions | undefined) {
  const isT0 = targetTurn === 0;
  const { leadOverride, historyToReplay } = resolveLeadPlan(isT0, options);
  // A T0 pick marked `bring` IS the brought selection; other branches get
  // theirs from the caller (derived from the replay's own switches).
  const bringOnly = leadOverride?.bring
    ? { p1: leadOverride.p1, p2: leadOverride.p2 }
    : options?.bringOnly;
  return { isT0, leadOverride, historyToReplay, bringOnly };
}

type StartPlan = ReturnType<typeof resolveStartPlan>;

interface StartArgs {
  format: string;
  p1Team: PokemonSet[];
  p2Team: PokemonSet[];
  replayLog: string;
  targetTurn: number;
  snapshot?: TurnSnapshot | null;
  options?: StartBranchOptions;
}

/** The runtime rebuild at the target turn (turn 1 for a lead branch, no corrections there). */
function reconstructForStart(branchEngine: BranchEngineModule, args: StartArgs, plan: StartPlan): Promise<BranchRuntime> {
  const { format, p1Team, p2Team, replayLog, targetTurn, snapshot, options } = args;
  const { isT0, leadOverride, bringOnly } = plan;
  return branchEngine.reconstructBranchRuntime({
    format,
    p1Team,
    p2Team,
    replayLog,
    targetTurn: isT0 ? 1 : targetTurn,
    snapshot: isT0 ? null : snapshot,
    playerNames: options?.playerNames,
    onProgress: options?.onProgress,
    abort: options?.abort,
    ...(options?.snapshotFor && !isT0
      ? { capturePositions: { snapshotFor: options.snapshotFor, onPosition: () => {} } }
      : {}),
    choiceLocks: isT0 ? undefined : options?.choiceLocks,
    leadOverride: leadOverride ? { p1: leadOverride.p1, p2: leadOverride.p2 } : undefined,
    bringOnly,
  });
}

/** The lead decision IS the variation's first entry: entry 0 plays
 *  "turn 0" and the position after it is the start of turn 1. */
function leadHistoryEntry(
  branchEngine: BranchEngineModule, runtime: BranchRuntime,
  leadOverride: NonNullable<StartBranchOptions['leadOverride']>, startPosition: string | null,
): BranchHistoryEntry {
  const startState = branchEngine.createBranchState(runtime.battleStream, runtime.log, {
    p1Choices: [],
    p2Choices: [],
  });
  // "lead A + B · back C + D" — the leads are the first active-count
  // picks, the rest is the brought back line (VGC's 4 of 6).
  const activeCount = runtime.battleStream.battle?.sides[0]?.active.length ?? 1;
  const leadLabel = (list: string[]) => {
    const back = list.slice(activeCount);
    return `lead ${list.slice(0, activeCount).join(' + ')}${back.length > 0 ? ` · back ${back.join(' + ')}` : ''}`;
  };
  return {
    ...makeHistoryEntry(0, leadLabel(leadOverride.p1), leadLabel(leadOverride.p2), startState),
    leadChoices: {
      p1: [...leadOverride.p1],
      p2: [...leadOverride.p2],
      ...(leadOverride.bring ? { bring: true } : {}),
    },
    serializedPosition: startPosition,
  };
}

/** Replays the kept history onto the rebuilt runtime; stops at the first entry that no longer applies. */
async function replayKeptHistory(
  runtime: BranchRuntime, branchEngine: BranchEngineModule, historyToReplay: BranchHistoryEntry[],
  replayedHistory: BranchHistoryEntry[],
): Promise<string | null> {
  for (const entry of historyToReplay) {
    const outcome = await replayHistoryEntry(runtime, branchEngine, entry);
    if (!outcome.ok) {
      return `Rebuild stopped before branch turn ${entry.turnNumber}: ${outcome.error}`;
    }
    replayedHistory.push(outcome.entry);
  }
  return null;
}

interface SessionSetters extends BranchSetters {
  setBranching: React.Dispatch<React.SetStateAction<boolean>>;
  setVariationStartTurn: React.Dispatch<React.SetStateAction<number | null>>;
  setStartSerialized: React.Dispatch<React.SetStateAction<string | null>>;
}

function useStartBranch(
  refs: BranchRefs, setters: SessionSetters, clearChoices: () => void,
  loadBranchEngine: () => Promise<BranchEngineModule>, updateState: (battleStream: BattleStream | null) => void,
) {
  const { logRef, battleStreamRef, streamsRef, choiceErrorsRef, p1ChoicesRef, p2ChoicesRef } = refs;
  const { setExecuteError, setBranching, setHistory, setVariationStartTurn, setStartSerialized } = setters;
  return useCallback(async (
    format: string,
    p1Team: PokemonSet[],
    p2Team: PokemonSet[],
    replayLog: string,
    targetTurn: number,
    snapshot?: TurnSnapshot | null,
    options?: StartBranchOptions,
  ) => {
    logRef.current = [];
    clearChoices();
    setExecuteError(null);

    const branchEngine = await loadBranchEngine();
    const plan = resolveStartPlan(targetTurn, options);
    const { isT0, leadOverride, historyToReplay } = plan;
    const runtime = await reconstructForStart(branchEngine, { format, p1Team, p2Team, replayLog, targetTurn, snapshot, options }, plan);

    if (options?.abort?.aborted) return;

    logRef.current = runtime.log;
    battleStreamRef.current = runtime.battleStream;
    streamsRef.current = runtime.streams;
    choiceErrorsRef.current = runtime.choiceErrors;
    // Captured BEFORE any history replay — after it the battle stands at the
    // tip, and the start position is the one every truncation returns to.
    const startPosition = branchEngine.captureSerializedPosition(runtime.battleStream.battle);

    let branchError = branchEngine.validateBranchRuntime(runtime);

    const replayedHistory: BranchHistoryEntry[] = [];
    if (isT0 && leadOverride && !branchError) {
      replayedHistory.push(leadHistoryEntry(branchEngine, runtime, leadOverride, startPosition));
    }
    if (!branchError) {
      branchError = await replayKeptHistory(runtime, branchEngine, historyToReplay, replayedHistory);
    }

    p1ChoicesRef.current = branchError ? [] : [...(options?.p1Choices ?? [])];
    p2ChoicesRef.current = branchError ? [] : [...(options?.p2Choices ?? [])];
    setBranching(true);
    setHistory(replayedHistory);
    setVariationStartTurn(targetTurn);
    setStartSerialized(startPosition);
    setExecuteError(branchError);
    updateState(runtime.battleStream);
  }, [clearChoices, loadBranchEngine, updateState, logRef, battleStreamRef, streamsRef, choiceErrorsRef,
    p1ChoicesRef, p2ChoicesRef, setExecuteError, setBranching, setHistory, setVariationStartTurn, setStartSerialized]);
}

/** The session side of the branch: rebuilding a runtime at a turn, reading its battle, and tearing it down. */
export function useBranchSession(
  refs: BranchRefs, setters: SessionSetters, clearChoices: () => void,
  updateState: (battleStream: BattleStream | null) => void,
) {
  const { branchEngineRef, battleStreamRef, streamsRef, logRef, choiceErrorsRef } = refs;
  const { setBranching, setSimState, setHistory, setVariationStartTurn, setStartSerialized, setExecuteError } = setters;

  const loadBranchEngine = useCallback(async () => {
    branchEngineRef.current ??= await import('../../lib/branch-engine');
    return branchEngineRef.current;
  }, [branchEngineRef]);

  const startBranch = useStartBranch(refs, setters, clearChoices, loadBranchEngine, updateState);

  /** Live sim battle of the current branch (null outside an active branch). */
  const getBattle = useCallback(() => battleStreamRef.current?.battle ?? null, [battleStreamRef]);

  const stopBranch = useCallback(() => {
    setBranching(false);
    setSimState(null);
    setHistory([]);
    setVariationStartTurn(null);
    setStartSerialized(null);
    setExecuteError(null);
    streamsRef.current = null;
    battleStreamRef.current = null;
    logRef.current = [];
    choiceErrorsRef.current = null;
    clearChoices();
  }, [clearChoices, setBranching, setSimState, setHistory, setVariationStartTurn, setStartSerialized, setExecuteError,
    streamsRef, battleStreamRef, logRef, choiceErrorsRef]);

  return { startBranch, getBattle, stopBranch };
}
