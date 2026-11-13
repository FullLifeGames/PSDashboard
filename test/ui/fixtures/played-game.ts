import { expect } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useEffect, useRef, useState } from 'react';
import { getBranchSimulatorFormat } from '@fulllifegames/replay-core';
import { useBranch } from '../../../src/hooks/useBranch';
import { useGameState, useNewGame } from '../../../src/hooks/useNewGame';
import { gameReplayData, type NewGameRecord } from '../../../src/lib/new-game/record';
import { saveGame } from '../../../src/lib/new-game/store';
import { picks, startedRecord } from './new-game';

/**
 * Round 89 (lane H, #105, step H4e): a game saved in the browser's store after its leads and `turns` finished turns, played through
 * the real branch simulator and the game hook as the app composes them (the replay state is a fake, the save is the store's own).
 * The record has entries, so the app opens it on its tip (turn `turns + 1`), not at Team Preview.
 */
export async function playedRecord(turns = 1, format = 'gen9ou'): Promise<NewGameRecord> {
  const rendered = renderHook(() => {
    const state = useGameState();
    const afterTurnRef = useRef<(() => Promise<void>) | null>(null);
    const branch = useBranch(null, afterTurnRef);
    const [replay] = useState(() => ({ openGame: async () => {}, extendGame: async () => {} }));
    const game = useNewGame({
      state, replay, storePosition: () => {},
      branch: { getHistory: branch.getHistory, getLog: branch.getLog, getStartTurn: branch.getStartTurn, getStream: branch.getStream, rebaseAtTip: branch.rebaseAtTip },
      save: saveGame,
    });
    const { promote } = game;
    useEffect(() => { afterTurnRef.current = async () => { await promote(); }; }, [promote]);
    return { state, branch, game };
  });
  const record = await startedRecord(format);
  await act(async () => { await rendered.result.current.game.openRecord(record); });
  await act(async () => {
    await rendered.result.current.branch.startBranch(getBranchSimulatorFormat(gameReplayData(record)), record.teams.p1, record.teams.p2, gameReplayData(record).log, 0, null, {
      playerNames: ['Alice', 'Bob'], leadOverride: { p1: ['Snorlax'], p2: ['Snorlax'] }, seed: record.seed,
    });
  });
  for (let turn = 0; turn < turns; turn += 1) {
    const state = rendered.result.current.branch.simState!;
    await act(async () => {
      for (const side of ['p1', 'p2'] as const) picks(state, side, turn).forEach((choice, slot) => { if (choice) rendered.result.current.branch.setChoice(side, choice, slot); });
    });
    await act(async () => { await rendered.result.current.branch.executeTurn(); });
    await waitFor(() => expect(rendered.result.current.branch.executing).toBe(false));
  }
  const played = rendered.result.current.state.record!;
  rendered.unmount();
  if (played.turns !== turns) throw new Error(`the game played ${played.turns} turns, not ${turns}`);
  return played;
}
