import { describe, expect, test } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useEffect, useRef, useState } from 'react';
import { getBranchSimulatorFormat, parseReplayLog, type ReplayData } from '@fulllifegames/replay-core';
import { adoptSerializedRuntime } from '@fulllifegames/eval-engine';
import { useBranch } from '../../../src/hooks/useBranch';
import { useGameState, useNewGame } from '../../../src/hooks/useNewGame';
import { gameAdoptSnapshot } from '../../../src/hooks/branch/game-rebuild';
import { gameReplayData } from '../../../src/lib/new-game/record';
import { picks, SIX, startedRecord } from '../fixtures/new-game';

/**
 * Round 89 (lane H, #105), stage H3: the game in the hooks. The real branch simulator over the real @pkmn/sim, composed with the
 * game hook as the app composes them (the replay state and the exact store are fakes that record what the game gives them): a turn
 * played at the tip joins the main line, a turn played from another turn stays a variation, a replacement settles its turn, and
 * the position source never asks for a replay job.
 */

const set = <T,>(cell: { current: T }, value: T) => { cell.current = value; };
const newProbe = () => ({
  store: new Map<number, string>(), replayData: { current: null as ReplayData | null }, extended: { current: 0 },
  saved: { current: 0 }, openCalls: { current: 0 },
});

/** What the game hands the replay state and the exact store is recorded in a probe the spec owns. */
function useGame(probe: ReturnType<typeof newProbe>) {
  const state = useGameState();
  const afterTurnRef = useRef<(() => Promise<void>) | null>(null);
  const branch = useBranch(null, afterTurnRef);
  const { store, replayData, extended, saved, openCalls } = probe;
  const [replay] = useState(() => ({
    openGame: async (data: ReplayData) => { set(replayData, data); set(openCalls, openCalls.current + 1); },
    extendGame: async (data: ReplayData) => { set(replayData, data); set(extended, extended.current + 1); },
  }));
  const game = useNewGame({
    state, replay, storePosition: (turn, position) => { store.set(turn, position); },
    branch: { getHistory: branch.getHistory, getLog: branch.getLog, getStartTurn: branch.getStartTurn, getStream: branch.getStream, rebaseAtTip: branch.rebaseAtTip },
    save: () => { set(saved, saved.current + 1); return true; },
  });
  const { promote } = game;
  useEffect(() => {
    afterTurnRef.current = async () => { await promote(); };
  }, [promote]);
  return { state, branch, game, store, replayData, extended, saved, openCalls };
}

type Rendered = ReturnType<typeof renderHook<ReturnType<typeof useGame>, unknown>>;

async function startGame(format: string, leads: { p1: string[]; p2: string[]; bring?: boolean }): Promise<Rendered> {
  const probe = newProbe();
  const rendered = renderHook(() => useGame(probe));
  const record = await startedRecord(format);
  await act(async () => { await rendered.result.current.game.openRecord(record); });
  await act(async () => {
    await rendered.result.current.branch.startBranch(getBranchSimulatorFormat(gameReplayData(record)), record.teams.p1, record.teams.p2, gameReplayData(record).log, 0, null, {
      playerNames: ['Alice', 'Bob'], leadOverride: leads, ...(leads.bring ? { bringOnly: leads } : {}), seed: record.seed,
    });
  });
  return rendered;
}

const forcedNow = (rendered: Rendered) => {
  const state = rendered.result.current.branch.simState!;
  return state.p1ForceSwitch || state.p2ForceSwitch;
};

/** Answers the request in front of the branch: the replacement a side waits for, else both sides' moves and the turn. */
async function playRequest(rendered: Rendered, rotate = 0): Promise<void> {
  const state = rendered.result.current.branch.simState!;
  const replacing = state.p1ForceSwitch || state.p2ForceSwitch;
  await act(async () => {
    for (const side of ['p1', 'p2'] as const) {
      if (replacing && !(side === 'p1' ? state.p1ForceSwitch : state.p2ForceSwitch)) continue;
      picks(state, side, rotate).forEach((choice, slot) => { if (choice) rendered.result.current.branch.setChoice(side, choice, slot); });
    }
  });
  if (!replacing) await act(async () => { await rendered.result.current.branch.executeTurn(); });
  await waitFor(() => expect(rendered.result.current.branch.executing).toBe(false));
}

/** One whole turn: its request and every replacement that finishes it. */
async function playTurn(rendered: Rendered, rotate = 0): Promise<void> {
  await playRequest(rendered, rotate);
  for (let guard = 0; guard < 4 && forcedNow(rendered); guard += 1) await playRequest(rendered, rotate);
}

const turnsOf = (rendered: Rendered) => rendered.result.current.state.record!.turns;

describe('useNewGame', () => {
  test('the lead pick is the first page of the main line: turn 1 stands, the tip is live, nothing is a variation', async () => {
    const rendered = await startGame('gen9ou', { p1: ['Snorlax'], p2: ['Snorlax'] });
    const { state, branch, replayData, store, saved } = rendered.result.current;
    expect(state.record!.entries).toHaveLength(1);
    expect(state.record!.turns).toBe(0);
    expect(parseReplayLog(replayData.current!.log)).toHaveLength(1);
    expect(branch.variationStartTurn).toBe(1);
    expect(branch.history).toEqual([]);
    expect(store.has(1)).toBe(true);
    expect(saved.current).toBe(1);
  });

  test('a turn played at the tip joins the main line: the record, the log, the store, the save and a live tip one turn on', async () => {
    const rendered = await startGame('gen9ou', { p1: ['Snorlax'], p2: ['Snorlax'] });
    await playTurn(rendered);
    const { state, branch, replayData, store, saved, extended } = rendered.result.current;
    expect(state.record!.turns).toBe(1);
    expect(parseReplayLog(replayData.current!.log)).toHaveLength(2);
    expect(extended.current).toBeGreaterThanOrEqual(2);
    expect(branch.variationStartTurn).toBe(2);
    expect(branch.history).toEqual([]);
    expect([...store.keys()].sort()).toEqual([1, 2]);
    expect(saved.current).toBe(2);
    // the grown log is the record's: no clock lines, the body ends on the new tip's turn line
    expect(replayData.current!.log).not.toContain('|t:|');
    expect(replayData.current!.log.split('\n').filter(line => line.startsWith('|turn|'))).toEqual(['|turn|1', '|turn|2']);
  });

  test('Let it play out from the tip: three more turns, three more main-line turns', async () => {
    const rendered = await startGame('gen9doublesou', { p1: ['Snorlax', 'Dragonite'], p2: ['Snorlax', 'Dragonite'] });
    for (let turn = 0; turn < 3; turn += 1) await playTurn(rendered, turn);
    expect(turnsOf(rendered)).toBe(3);
    expect(rendered.result.current.branch.variationStartTurn).toBe(4);
    expect(parseReplayLog(rendered.result.current.replayData.current!.log)).toHaveLength(4);
  });

  test('a turn played from turn 2 of a game that stands at turn 5 stays a variation: the record and the log do not move', async () => {
    const rendered = await startGame('gen9ou', { p1: ['Snorlax'], p2: ['Snorlax'] });
    for (let turn = 0; turn < 4; turn += 1) await playTurn(rendered, turn);
    const before = rendered.result.current.state.record!;
    const extendedBefore = rendered.result.current.extended.current;
    const { store } = rendered.result.current;
    await act(async () => {
      await rendered.result.current.branch.startBranch(getBranchSimulatorFormat(gameReplayData(before)), before.teams.p1, before.teams.p2, gameReplayData(before).log, 2, null, {
        playerNames: ['Alice', 'Bob'],
        acquireRuntime: async params => adoptSerializedRuntime({
          serialized: store.get(params.targetTurn)!, replayLog: params.replayLog, targetTurn: params.targetTurn,
          snapshot: gameAdoptSnapshot(),
        }),
      });
    });
    await playTurn(rendered, 1);
    const { state, branch, extended } = rendered.result.current;
    expect(state.record).toBe(before);
    expect(extended.current).toBe(extendedBefore);
    expect(branch.variationStartTurn).toBe(2);
    expect(branch.history).toHaveLength(1);
  });

  test('a replacement settles its turn: the turn joins once the replacement is chosen, not before', async () => {
    const rendered = await startGame('gen9doublesou', { p1: ['Garchomp', 'Gengar'], p2: ['Garchomp', 'Gengar'] });
    let paused = false;
    for (let turn = 0; turn < 12 && !paused; turn += 1) {
      const before = turnsOf(rendered);
      await playRequest(rendered, turn);
      paused = forcedNow(rendered);
      if (paused) {
        // the knockout turn has run, its replacement waits: the main line has not moved
        expect(turnsOf(rendered)).toBe(before);
        expect(rendered.result.current.branch.history.length).toBeGreaterThan(0);
        // ... but the record keeps the turn for a reload (H8, finding 8): its entries as the branch holds them, the main line as it was
        const kept = rendered.result.current.state.record!;
        expect(kept.pending).toHaveLength(rendered.result.current.branch.history.length);
        expect(kept.pending!.every(row => row.serializedPosition === undefined)).toBe(true);
        expect(rendered.result.current.saved.current).toBeGreaterThan(0);
      }
    }
    expect(paused).toBe(true);
    const before = turnsOf(rendered);
    await playRequest(rendered);
    await waitFor(() => expect(turnsOf(rendered)).toBe(before + 1));
    expect(rendered.result.current.branch.history).toEqual([]);
    expect(rendered.result.current.state.record!.pending).toBeUndefined();
  });

  test('a pending tip turn is given up when a variation of an earlier turn is played; the finished tip turns keep nothing pending (H8)', async () => {
    const rendered = await startGame('gen9doublesou', { p1: ['Garchomp', 'Gengar'], p2: ['Garchomp', 'Gengar'] });
    // play on until a knockout turn waits for its replacement after at least one finished turn
    for (let turn = 0; turn < 20 && !(forcedNow(rendered) && turnsOf(rendered) >= 1); turn += 1) {
      await playRequest(rendered, turn);
    }
    expect(forcedNow(rendered)).toBe(true);
    expect(turnsOf(rendered)).toBeGreaterThanOrEqual(1);
    const pending = rendered.result.current.state.record!;
    expect(pending.pending!.length).toBeGreaterThan(0);
    const { store } = rendered.result.current;
    await act(async () => {
      await rendered.result.current.branch.startBranch(getBranchSimulatorFormat(gameReplayData(pending)), pending.teams.p1, pending.teams.p2, gameReplayData(pending).log, 1, null, {
        playerNames: ['Alice', 'Bob'],
        acquireRuntime: async params => adoptSerializedRuntime({
          serialized: store.get(params.targetTurn)!, replayLog: params.replayLog, targetTurn: params.targetTurn, snapshot: gameAdoptSnapshot(),
        }),
      });
    });
    await playTurn(rendered, 2);
    await waitFor(() => expect(rendered.result.current.state.record!.pending).toBeUndefined());
    expect(rendered.result.current.state.record!.turns).toBe(pending.turns);
    expect(rendered.result.current.state.record!.entries).toEqual(pending.entries);
  }, 240_000);

  test('a team edit plays the record again on the new sets: the entries that still apply stay, the line ends before the first that does not', async () => {
    const rendered = await startGame('gen9ou', { p1: ['Snorlax'], p2: ['Snorlax'] });
    for (let turn = 0; turn < 3; turn += 1) await playTurn(rendered, turn);
    expect(turnsOf(rendered)).toBe(3);
    // turn 2 played Protect; Snorlax of side one forgets it
    const p1 = SIX.map(set => (set.species === 'Snorlax' ? { ...set, moves: ['Earthquake', 'Rest', 'Return', 'Substitute'] } : set));
    let outcome: Awaited<ReturnType<typeof rendered.result.current.game.editTeams>> = null;
    await act(async () => { outcome = await rendered.result.current.game.editTeams({ p1, p2: SIX }); });
    expect(outcome!.error).not.toBeNull();
    expect(outcome!.kept).toBe(1);
    const { record } = rendered.result.current.state;
    expect(record!.turns).toBe(1);
    expect(record!.teams.p1.find(set => set.species === 'Snorlax')!.moves).toContain('Rest');
    expect(parseReplayLog(rendered.result.current.replayData.current!.log)).toHaveLength(2);
    expect(rendered.result.current.openCalls.current).toBe(2);
  });

  test('an edit that every entry survives keeps the whole main line and its log', async () => {
    const rendered = await startGame('gen9ou', { p1: ['Snorlax'], p2: ['Snorlax'] });
    for (let turn = 0; turn < 2; turn += 1) await playTurn(rendered, turn);
    const before = rendered.result.current.state.record!;
    // an unused body changes: nothing the played turns touch
    const p2 = SIX.map(set => (set.species === 'Starmie' ? { ...set, item: 'Leftovers' } : set));
    await act(async () => { await rendered.result.current.game.editTeams({ p1: SIX, p2 }); });
    const { record } = rendered.result.current.state;
    expect(record!.turns).toBe(before.turns);
    expect(record!.body).toEqual(before.body);
  });
  test.each([
    ['gen9ou', { p1: ['Snorlax'], p2: ['Snorlax'] }],
    ['gen9doublesou', { p1: ['Snorlax', 'Dragonite'], p2: ['Snorlax', 'Dragonite'] }],
  ] as const)('planTeams (%s) reports how many turns a team edit keeps and changes nothing: no record, no save, no open (H14a)', async (format, leads) => {
    const rendered = await startGame(format, { p1: [...leads.p1], p2: [...leads.p2] });
    for (let turn = 0; turn < 3; turn += 1) await playTurn(rendered, turn);
    const before = rendered.result.current.state.record!;
    const saves = rendered.result.current.saved.current;
    const opens = rendered.result.current.openCalls.current;
    // a move a played turn used goes: the line ends before it (the first turn survives, the second played Protect)
    const p1 = SIX.map(set => (set.species === 'Snorlax' ? { ...set, moves: ['Earthquake', 'Rest', 'Return', 'Substitute'] } : set));
    let plan: Awaited<ReturnType<typeof rendered.result.current.game.planTeams>> = null;
    await act(async () => { plan = await rendered.result.current.game.planTeams({ p1, p2: SIX }); });
    expect(plan!.error).not.toBeNull();
    expect(plan!.kept).toBeLessThan(before.turns);
    expect(rendered.result.current.state.record).toBe(before);
    expect(rendered.result.current.saved.current).toBe(saves);
    expect(rendered.result.current.openCalls.current).toBe(opens);
    // an edit nothing touches keeps every turn
    await act(async () => { plan = await rendered.result.current.game.planTeams({ p1: SIX, p2: SIX }); });
    expect(plan!.error).toBeNull();
    expect(plan!.kept).toBe(before.turns);
  }, 240_000);

  test('opening a game asks the pointer to land once: a saved game on its tip, a fresh game on turn 0 (team preview); the same game again and an edit ask nothing', async () => {
    const played = await startGame('gen9ou', { p1: ['Snorlax'], p2: ['Snorlax'] });
    for (let turn = 0; turn < 2; turn += 1) await playTurn(played, turn);
    const saved = played.result.current.state.record!;
    const reopened = renderHook(() => useGame(newProbe()));
    expect(reopened.result.current.game.takeLanding(saved.id)).toBeNull();
    await act(async () => { await reopened.result.current.game.openRecord(saved); });
    // The landing belongs to the game's id (round 89, H4g): the reset runs of the board before the document arrives (no id, or the
    // id of another replay) leave it, and the run for the game's own id takes it, once.
    expect(reopened.result.current.game.takeLanding(undefined)).toBeNull();
    expect(reopened.result.current.game.takeLanding('someothergame')).toBeNull();
    expect(reopened.result.current.game.takeLanding(saved.id)).toBe(saved.turns + 1);
    expect(reopened.result.current.game.takeLanding(saved.id)).toBeNull();
    await act(async () => { await reopened.result.current.game.openRecord(saved); });
    expect(reopened.result.current.game.takeLanding(saved.id)).toBeNull();
    await act(async () => { await reopened.result.current.game.editTeams({ p1: SIX, p2: SIX }); });
    expect(reopened.result.current.game.takeLanding(saved.id)).toBeNull();
    const fresh = renderHook(() => useGame(newProbe()));
    await act(async () => { await fresh.result.current.game.openRecord(await startedRecord('gen9ou')); });
    const freshId = fresh.result.current.state.record!.id;
    expect(fresh.result.current.game.takeLanding(undefined)).toBeNull();
    expect(fresh.result.current.game.takeLanding(freshId)).toBe(0);
    expect(fresh.result.current.game.takeLanding(freshId)).toBeNull();
  });

  test('Start saves the record at once, with no entry played, so the address and the lists find a game still at team preview (D-E1)', async () => {
    const probe = newProbe();
    const rendered = renderHook(() => useGame(probe));
    const record = await startedRecord('gen9ou');
    expect(probe.saved.current).toBe(0);
    await act(async () => { await rendered.result.current.game.startGame(record); });
    expect(probe.saved.current).toBe(1);
    expect(probe.openCalls.current).toBe(1);
    expect(rendered.result.current.state.record?.entries).toEqual([]);
    expect(rendered.result.current.game.takeLanding(record.id)).toBe(0);
    // opening a saved game saves nothing: its row keeps its place in the list
    await act(async () => { await rendered.result.current.game.openRecord(record); });
    expect(probe.saved.current).toBe(1);
  });
});
