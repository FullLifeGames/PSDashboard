import { useState, useCallback, useRef } from 'react';
import type { BattleStreams, PokemonSet } from '@pkmn/sim';
import type { TurnSnapshot } from '../types';
import type { ChoiceLockContext } from '../lib/choice-lock';
import type {
  BranchChoiceErrorLog,
  BranchRuntime,
  BranchSimState,
  SimPokemonInfo,
} from '../lib/branch-engine';
import {
  branchSideChoicesReady,
  requiredChoicesForActiveSlots,
  type BranchSlotChoice,
} from '../lib/branch-choices';

export type {
  BranchMoveOption,
  BranchSwitchOption,
  BranchSimState,
  SimPokemonInfo,
} from '../lib/branch-engine';

type SideId = 'p1' | 'p2';
type BattleStream = BattleStreams.BattleStream;
type PlayerStreams = ReturnType<typeof BattleStreams.getPlayerStreams>;
type BranchEngineModule = typeof import('../lib/branch-engine');

interface StartBranchOptions {
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
}

export interface BranchHistoryEntry {
  turnNumber: number;
  /** 'forced' entries record single-side forced-switch interludes (B15). */
  kind?: 'turn' | 'forced';
  forcedSide?: SideId;
  /** Identity-based choices used to replay this entry after a team edit (B1). */
  p1SlotChoices?: (BranchSlotChoice | null)[];
  p2SlotChoices?: (BranchSlotChoice | null)[];
  /** The resolved commands actually sent to the sim (display/share only). */
  p1Choice: string;
  p2Choice: string;
  /** Serialized position AFTER this entry executed (unified timeline);
   *  null when capture failed — navigation still works via the sim log. */
  serializedPosition?: string | null;
  p1Active: SimPokemonInfo | null;
  p1ActiveSlots: (SimPokemonInfo | null)[];
  p2Active: SimPokemonInfo | null;
  p2ActiveSlots: (SimPokemonInfo | null)[];
  p1Pokemon: SimPokemonInfo[];
  p2Pokemon: SimPokemonInfo[];
}

function sideIndex(side: SideId): 0 | 1 {
  return side === 'p1' ? 0 : 1;
}

function forceSwitches(battle: NonNullable<BattleStreams.BattleStream['battle']>, side: SideId): boolean[] {
  const sideState = battle.sides[sideIndex(side)];
  return sideState.active.map((_, index) => sideState.activeRequest?.forceSwitch?.[index] ?? false);
}

function requiredChoices(battle: NonNullable<BattleStreams.BattleStream['battle']>, side: SideId): boolean[] {
  const sideState = battle.sides[sideIndex(side)];
  const forced = forceSwitches(battle, side);
  return requiredChoicesForActiveSlots(sideState.active, forced);
}

function hasAllChoices(
  battle: NonNullable<BattleStreams.BattleStream['battle']>,
  side: SideId,
  choices: (BranchSlotChoice | null)[],
): boolean {
  return branchSideChoicesReady(choices, requiredChoices(battle, side));
}

function makeHistoryEntry(
  turnNumber: number,
  p1Choice: string,
  p2Choice: string,
  nextState: BranchSimState,
): BranchHistoryEntry {
  return {
    turnNumber,
    p1Choice,
    p2Choice,
    p1Active: nextState.p1Active,
    p1ActiveSlots: nextState.p1ActiveSlots,
    p2Active: nextState.p2Active,
    p2ActiveSlots: nextState.p2ActiveSlots,
    p1Pokemon: nextState.p1Pokemon,
    p2Pokemon: nextState.p2Pokemon,
  };
}

type ReplayEntryOutcome =
  | { ok: true; entry: BranchHistoryEntry }
  | { ok: false; error: string };

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
  let commands: { side: SideId; command: string }[];
  let p1Command = entry.p1Choice;
  let p2Command = entry.p2Choice;

  if (entry.kind === 'forced' && entry.forcedSide) {
    const side = entry.forcedSide;
    const slotChoices = side === 'p1' ? entry.p1SlotChoices : entry.p2SlotChoices;
    if (!slotChoices) return { ok: false, error: 'Missing forced-switch data in the branch history.' };
    const resolved = branchEngine.resolveSideChoices(battle, side, slotChoices, requiredChoices(battle, side));
    if (!resolved.ok) return resolved;
    commands = [{ side, command: resolved.command }];
    p1Command = side === 'p1' ? resolved.command : '—';
    p2Command = side === 'p2' ? resolved.command : '—';
  } else if (entry.p1SlotChoices && entry.p2SlotChoices) {
    const p1 = branchEngine.resolveSideChoices(battle, 'p1', entry.p1SlotChoices, requiredChoices(battle, 'p1'));
    if (!p1.ok) return p1;
    const p2 = branchEngine.resolveSideChoices(battle, 'p2', entry.p2SlotChoices, requiredChoices(battle, 'p2'));
    if (!p2.ok) return p2;
    commands = [
      { side: 'p1', command: p1.command },
      { side: 'p2', command: p2.command },
    ];
    p1Command = p1.command;
    p2Command = p2.command;
  } else {
    // Entries recorded before identity-based choices existed: replay verbatim.
    commands = [
      { side: 'p1', command: entry.p1Choice },
      { side: 'p2', command: entry.p2Choice },
    ];
  }

  const result = await branchEngine.executeBranchChoices({
    streams: runtime.streams,
    log: runtime.log,
    choiceErrors: runtime.choiceErrors,
    commands,
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
      ...makeHistoryEntry(turnNumber, p1Command, p2Command, nextState),
      serializedPosition,
      kind: entry.kind ?? 'turn',
      ...(entry.forcedSide ? { forcedSide: entry.forcedSide } : {}),
      ...(entry.p1SlotChoices ? { p1SlotChoices: entry.p1SlotChoices } : {}),
      ...(entry.p2SlotChoices ? { p2SlotChoices: entry.p2SlotChoices } : {}),
    },
  };
}

export function useBranch() {
  const [branching, setBranching] = useState(false);
  const [simState, setSimState] = useState<BranchSimState | null>(null);
  const [history, setHistory] = useState<BranchHistoryEntry[]>([]);
  /** Turn the current branch runtime was started at (null = no runtime). */
  const [variationStartTurn, setVariationStartTurn] = useState<number | null>(null);
  /** Serialized position at the branch start, before entry 0. */
  const [startSerialized, setStartSerialized] = useState<string | null>(null);
  const [executeError, setExecuteError] = useState<string | null>(null);
  const [executing, setExecuting] = useState(false);
  // Concurrent sim writes commit unintended extra turns and desync the UI
  // from the battle (double clicks, rapid forced-switch clicks) — one execute
  // may run at a time.
  const executingRef = useRef(false);
  const branchEngineRef = useRef<BranchEngineModule | null>(null);
  const streamsRef = useRef<PlayerStreams | null>(null);
  const battleStreamRef = useRef<BattleStream | null>(null);
  const logRef = useRef<string[]>([]);
  const choiceErrorsRef = useRef<BranchChoiceErrorLog | null>(null);
  const p1ChoicesRef = useRef<(BranchSlotChoice | null)[]>([]);
  const p2ChoicesRef = useRef<(BranchSlotChoice | null)[]>([]);

  const loadBranchEngine = useCallback(async () => {
    branchEngineRef.current ??= await import('../lib/branch-engine');
    return branchEngineRef.current;
  }, []);

  const updateState = useCallback((battleStream: BattleStream | null) => {
    const branchEngine = branchEngineRef.current;
    if (!branchEngine) return;
    setSimState(branchEngine.createBranchState(battleStream, logRef.current, {
      p1Choices: p1ChoicesRef.current,
      p2Choices: p2ChoicesRef.current,
    }));
  }, []);

  const clearChoices = useCallback(() => {
    p1ChoicesRef.current = [];
    p2ChoicesRef.current = [];
  }, []);

  const executeTurn = useCallback(async () => {
    const streams = streamsRef.current;
    const battleStream = battleStreamRef.current;
    const branchEngine = branchEngineRef.current;
    const choiceErrors = choiceErrorsRef.current;
    const battle = battleStream?.battle;
    if (!streams || !battleStream || !branchEngine || !choiceErrors || !battle) return;
    if (executingRef.current) return;
    if (!hasAllChoices(battle, 'p1', p1ChoicesRef.current) || !hasAllChoices(battle, 'p2', p2ChoicesRef.current)) {
      return;
    }

    executingRef.current = true;
    setExecuting(true);
    try {
      const currentTurn = battle.turn ?? 0;
      const p1 = branchEngine.resolveSideChoices(battle, 'p1', p1ChoicesRef.current, requiredChoices(battle, 'p1'));
      if (!p1.ok) {
        setExecuteError(p1.error);
        return;
      }
      const p2 = branchEngine.resolveSideChoices(battle, 'p2', p2ChoicesRef.current, requiredChoices(battle, 'p2'));
      if (!p2.ok) {
        setExecuteError(p2.error);
        return;
      }

      const result = await branchEngine.executeBranchChoices({
        streams,
        log: logRef.current,
        choiceErrors,
        commands: [
          { side: 'p1', command: p1.command },
          { side: 'p2', command: p2.command },
        ],
      });

      if (!result.ok) {
        setExecuteError(branchEngine.annotateNicknames(result.error, battle));
        return;
      }

      setExecuteError(null);
      const p1SlotChoices = [...p1ChoicesRef.current];
      const p2SlotChoices = [...p2ChoicesRef.current];
      clearChoices();
      const nextState = branchEngine.createBranchState(battleStream, logRef.current, {
        p1Choices: p1ChoicesRef.current,
        p2Choices: p2ChoicesRef.current,
      });
      setHistory(prev => [...prev, {
        ...makeHistoryEntry(currentTurn, p1.command, p2.command, nextState),
        kind: 'turn' as const,
        p1SlotChoices,
        p2SlotChoices,
        serializedPosition: branchEngine.captureSerializedPosition(battleStream.battle),
      }]);
      setSimState(nextState);
    } finally {
      executingRef.current = false;
      setExecuting(false);
    }
  }, [clearChoices]);

  const executeForcedSide = useCallback(async (
    side: SideId,
    command: string,
    slotChoices: (BranchSlotChoice | null)[],
  ) => {
    const streams = streamsRef.current;
    const battleStream = battleStreamRef.current;
    const branchEngine = branchEngineRef.current;
    const choiceErrors = choiceErrorsRef.current;
    if (!streams || !battleStream || !branchEngine || !choiceErrors) return;
    if (executingRef.current) return;

    executingRef.current = true;
    setExecuting(true);
    try {
      const turnNumber = battleStream.battle?.turn ?? 0;
      const result = await branchEngine.executeBranchChoices({
        streams,
        log: logRef.current,
        choiceErrors,
        commands: [{ side, command }],
      });

      if (!result.ok) {
        setExecuteError(branchEngine.annotateNicknames(result.error, battleStream.battle));
        return;
      }

      setExecuteError(null);
      if (side === 'p1') p1ChoicesRef.current = [];
      if (side === 'p2') p2ChoicesRef.current = [];
      const nextState = branchEngine.createBranchState(battleStream, logRef.current, {
        p1Choices: p1ChoicesRef.current,
        p2Choices: p2ChoicesRef.current,
      });
      setHistory(prev => [...prev, {
        ...makeHistoryEntry(turnNumber, side === 'p1' ? command : '—', side === 'p2' ? command : '—', nextState),
        kind: 'forced' as const,
        forcedSide: side,
        ...(side === 'p1' ? { p1SlotChoices: slotChoices } : { p2SlotChoices: slotChoices }),
        serializedPosition: branchEngine.captureSerializedPosition(battleStream.battle),
      }]);
      setSimState(nextState);
    } finally {
      executingRef.current = false;
      setExecuting(false);
    }
  }, []);

  const setChoice = useCallback((side: SideId, choice: BranchSlotChoice, activeSlot = 0) => {
    if (executingRef.current) return;
    const ref = side === 'p1' ? p1ChoicesRef : p2ChoicesRef;
    ref.current = [...ref.current];
    ref.current[activeSlot] = choice;
    setExecuteError(null);

    const battleStream = battleStreamRef.current;
    const branchEngine = branchEngineRef.current;
    const battle = battleStream?.battle;
    if (!battle || !branchEngine) return;

    const p1Forced = forceSwitches(battle, 'p1').some(Boolean);
    const p2Forced = forceSwitches(battle, 'p2').some(Boolean);

    for (const forcedSide of ['p1', 'p2'] as const) {
      const isForced = forcedSide === 'p1' ? p1Forced && !p2Forced : p2Forced && !p1Forced;
      const choicesRef = forcedSide === 'p1' ? p1ChoicesRef : p2ChoicesRef;
      if (!isForced || side !== forcedSide || !hasAllChoices(battle, forcedSide, choicesRef.current)) continue;

      const resolved = branchEngine.resolveSideChoices(battle, forcedSide, choicesRef.current, requiredChoices(battle, forcedSide));
      if (!resolved.ok) {
        setExecuteError(resolved.error);
        return;
      }
      void executeForcedSide(forcedSide, resolved.command, [...choicesRef.current]);
      return;
    }

    if ((p1Forced || p2Forced) &&
      hasAllChoices(battle, 'p1', p1ChoicesRef.current) &&
      hasAllChoices(battle, 'p2', p2ChoicesRef.current)) {
      void executeTurn();
      return;
    }

    setSimState(prev => prev ? {
      ...prev,
      p1Choice: p1ChoicesRef.current[0] ?? null,
      p1Choices: [...p1ChoicesRef.current],
      p2Choice: p2ChoicesRef.current[0] ?? null,
      p2Choices: [...p2ChoicesRef.current],
    } : null);
  }, [executeForcedSide, executeTurn]);

  const startBranch = useCallback(async (
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
    const runtime = await branchEngine.reconstructBranchRuntime({
      format,
      p1Team,
      p2Team,
      replayLog,
      targetTurn,
      snapshot,
      playerNames: options?.playerNames,
      onProgress: options?.onProgress,
      abort: options?.abort,
      ...(options?.snapshotFor
        ? { capturePositions: { snapshotFor: options.snapshotFor, onPosition: () => {} } }
        : {}),
      choiceLocks: options?.choiceLocks,
    });

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
    if (!branchError) {
      for (const entry of options?.replayHistory ?? []) {
        const outcome = await replayHistoryEntry(runtime, branchEngine, entry);
        if (!outcome.ok) {
          branchError = `Rebuild stopped before branch turn ${entry.turnNumber}: ${outcome.error}`;
          break;
        }
        replayedHistory.push(outcome.entry);
      }
    }

    p1ChoicesRef.current = branchError ? [] : [...(options?.p1Choices ?? [])];
    p2ChoicesRef.current = branchError ? [] : [...(options?.p2Choices ?? [])];
    setBranching(true);
    setHistory(replayedHistory);
    setVariationStartTurn(targetTurn);
    setStartSerialized(startPosition);
    setExecuteError(branchError);
    updateState(runtime.battleStream);
  }, [clearChoices, loadBranchEngine, updateState]);

  /** Live sim battle of the current branch (null outside an active branch). */
  const getBattle = useCallback(() => battleStreamRef.current?.battle ?? null, []);

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
  }, [clearChoices]);

  return {
    branching, simState, history, executeError, executing,
    variationStartTurn, startSerialized,
    startBranch, setChoice, executeTurn, stopBranch, getBattle,
  };
}
