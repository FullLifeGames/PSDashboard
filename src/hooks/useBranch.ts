import { useState, useCallback, useRef, type RefObject } from 'react';
import type { BattleStreams, PokemonSet } from '@pkmn/sim';
import type { TurnSnapshot } from '../types';
import type { BranchSimState, SimPokemonInfo } from '../lib/branch-engine';
import {
  branchSideChoicesReady,
  buildBranchSideCommand,
  requiredChoicesForActiveSlots,
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

export interface BranchHistoryEntry {
  turnNumber: number;
  p1Choice: string;
  p2Choice: string;
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
  choices: (string | null)[],
): boolean {
  return branchSideChoicesReady(choices, requiredChoices(battle, side));
}

function sideCommand(
  battle: NonNullable<BattleStreams.BattleStream['battle']>,
  side: SideId,
  choices: (string | null)[],
): string {
  return buildBranchSideCommand(choices, requiredChoices(battle, side));
}

async function waitForLogAppend(logRef: RefObject<string[]>, previousLength: number) {
  const deadline = Date.now() + 1500;
  while (Date.now() < deadline) {
    if (logRef.current.length > previousLength) return;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
}

export function useBranch() {
  const [branching, setBranching] = useState(false);
  const [simState, setSimState] = useState<BranchSimState | null>(null);
  const [history, setHistory] = useState<BranchHistoryEntry[]>([]);
  const branchEngineRef = useRef<BranchEngineModule | null>(null);
  const streamsRef = useRef<PlayerStreams | null>(null);
  const battleStreamRef = useRef<BattleStream | null>(null);
  const logRef = useRef<string[]>([]);
  const p1ChoicesRef = useRef<(string | null)[]>([]);
  const p2ChoicesRef = useRef<(string | null)[]>([]);

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
    const battle = battleStream?.battle;
    if (!streams || !battleStream || !branchEngine || !battle) return;
    if (!hasAllChoices(battle, 'p1', p1ChoicesRef.current) || !hasAllChoices(battle, 'p2', p2ChoicesRef.current)) {
      return;
    }

    const currentTurn = battle.turn ?? 0;
    const previousLogLength = logRef.current.length;
    const p1 = sideCommand(battle, 'p1', p1ChoicesRef.current);
    const p2 = sideCommand(battle, 'p2', p2ChoicesRef.current);
    void streams.omniscient.write(`>p1 ${p1}\n>p2 ${p2}`);
    clearChoices();

    await waitForLogAppend(logRef, previousLogLength);

    const nextState = branchEngine.createBranchState(battleStream, logRef.current, {
      p1Choices: p1ChoicesRef.current,
      p2Choices: p2ChoicesRef.current,
    });
    setHistory(prev => [
      ...prev,
      {
        turnNumber: currentTurn,
        p1Choice: p1,
        p2Choice: p2,
        p1Active: nextState.p1Active,
        p1ActiveSlots: nextState.p1ActiveSlots,
        p2Active: nextState.p2Active,
        p2ActiveSlots: nextState.p2ActiveSlots,
        p1Pokemon: nextState.p1Pokemon,
        p2Pokemon: nextState.p2Pokemon,
      },
    ]);
    setSimState(nextState);
  }, [clearChoices]);

  const executeForcedSide = useCallback((side: SideId, choice: string) => {
    const streams = streamsRef.current;
    const battleStream = battleStreamRef.current;
    if (!streams || !battleStream) return;

    void streams.omniscient.write(`>${side} ${choice}`);
    if (side === 'p1') p1ChoicesRef.current = [];
    if (side === 'p2') p2ChoicesRef.current = [];
    setTimeout(() => updateState(battleStream), 200);
  }, [updateState]);

  const setChoice = useCallback((side: SideId, choice: string, activeSlot = 0) => {
    const ref = side === 'p1' ? p1ChoicesRef : p2ChoicesRef;
    ref.current = [...ref.current];
    ref.current[activeSlot] = choice;

    const battleStream = battleStreamRef.current;
    const battle = battleStream?.battle;
    if (!battle) return;

    const p1Forced = forceSwitches(battle, 'p1').some(Boolean);
    const p2Forced = forceSwitches(battle, 'p2').some(Boolean);

    if (p1Forced && !p2Forced && side === 'p1' && hasAllChoices(battle, 'p1', p1ChoicesRef.current)) {
      executeForcedSide('p1', sideCommand(battle, 'p1', p1ChoicesRef.current));
      return;
    }
    if (p2Forced && !p1Forced && side === 'p2' && hasAllChoices(battle, 'p2', p2ChoicesRef.current)) {
      executeForcedSide('p2', sideCommand(battle, 'p2', p2ChoicesRef.current));
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
  ) => {
    logRef.current = [];
    clearChoices();
    setHistory([]);

    const branchEngine = await loadBranchEngine();
    const runtime = await branchEngine.reconstructBranchRuntime({
      format,
      p1Team,
      p2Team,
      replayLog,
      targetTurn,
      snapshot,
    });

    logRef.current = runtime.log;
    battleStreamRef.current = runtime.battleStream;
    streamsRef.current = runtime.streams;
    setBranching(true);
    updateState(runtime.battleStream);
  }, [clearChoices, loadBranchEngine, updateState]);

  const stopBranch = useCallback(() => {
    setBranching(false);
    setSimState(null);
    setHistory([]);
    streamsRef.current = null;
    battleStreamRef.current = null;
    logRef.current = [];
    clearChoices();
  }, [clearChoices]);

  return { branching, simState, history, startBranch, setChoice, executeTurn, stopBranch };
}
