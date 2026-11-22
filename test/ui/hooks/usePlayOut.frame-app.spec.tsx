import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { toId } from '@fulllifegames/replay-core';
import type { EvalResult } from '@fulllifegames/eval-engine';
import { evalResult, rankedChoice } from '../fixtures/eval-result';
import { singlesReplay } from '../fixtures/replay';
import { stubReplayFetch } from '../fixtures/network';
import { realReplayWorkerClient } from '../fixtures/worker';
import type { AppController } from '../../../src/hooks/useAppController';

// Round 89 (#112): a play-out without Fast play-out stopped for good when the replay frame reported a turn before the tip
// (the user stepped the frame back and paused). The run below plays over the real controller (timeline, evaluation view,
// walk, loop) and a scripted search: the frame's report parks the pointer behind the tip right after the run armed, and the
// run must still play its turns on the live sim. Singles only here: the unit rows (usePlayOut.frame, usePlayOut.evaluations,
// useEvalView) cover doubles, and the loop and the controllers do not branch on the game type.
const worker = vi.hoisted(() => ({ current: null as null | ReturnType<typeof import('../fixtures/worker').realReplayWorkerClient> }));
vi.mock('../../../src/hooks/useReplayWorker', () => ({ useReplayWorker: () => worker.current!.client }));

const live = vi.hoisted(() => ({ app: null as null | (() => AppController), evaluations: [] as string[] }));
vi.mock('../../../src/lib/eval/worker-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/lib/eval/worker-client')>();
  class ScriptedEvalWorkerClient {
    async evaluate(): Promise<EvalResult> {
      const sim = live.app?.().ctx.branch.simState ?? null;
      const forced = !!sim && sim.p1ForceSwitches.some(Boolean);
      live.evaluations.push(forced ? 'forced' : 'normal');
      if (forced) {
        const target = sim!.p1SwitchesBySlot[0].find(option => !option.fainted)!;
        return evalResult('singles', {
          perSide: { p1: [rankedChoice(`switch ${toId(target.species)}`, `→ ${target.species}`, 0.1)], p2: [rankedChoice('wait', 'wait', 0)] },
        });
      }
      const mover = sim?.p1MovesBySlot[0].find(move => move.name === 'U-turn');
      const reply = sim?.p2MovesBySlot[0][0];
      return evalResult('singles', {
        perSide: {
          p1: mover ? [rankedChoice('move uturn', 'U-turn → Heatran', 0.3)] : [rankedChoice('move swordsdance', 'Swords Dance', 0.3)],
          p2: reply ? [rankedChoice(`move ${toId(reply.name)}`, reply.name, -0.3)] : [rankedChoice('move ironhead', 'Iron Head', -0.3)],
        },
      });
    }
    async evalPair() { return 0.2; }
    cancel() {}
    dispose() {}
  }
  return { ...actual, EvalWorkerClient: ScriptedEvalWorkerClient };
});

const { useAppController } = await import('../../../src/hooks/useAppController');

beforeEach(() => {
  worker.current = realReplayWorkerClient();
  stubReplayFetch([singlesReplay()]);
  window.history.replaceState(null, '', '/');
  live.evaluations = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** A loaded replay with a variation from turn 2 that knows U-turn and has played two turns by hand. */
async function variationWithPivot() {
  const replay = singlesReplay();
  const { result } = renderHook(() => useAppController());
  live.app = () => result.current;
  await act(async () => { await result.current.ctx.replay.loadReplay(replay.id); });
  await waitFor(() => expect(result.current.engine.smogonPending).toBe(false));
  act(() => result.current.board.timeline.navigateTo({ turn: 2, line: 'main' }));
  const lead = result.current.ctx.knowledge.effectiveP1Info!.pokemon[0];
  act(() => result.current.handleHypotheticalMove('p1', 0, { species: lead.species, move: 'U-turn', replace: null }));
  await waitFor(() => expect(result.current.ctx.branch.branching).toBe(true), { timeout: 60_000 });
  await waitFor(() => expect(result.current.ctx.refreshQueue.pendingBranchRefresh).toBeNull());
  await waitFor(() => expect(result.current.ctx.branch.simState?.p1MovesBySlot[0].map(move => move.name)).toContain('U-turn'), { timeout: 20_000 });

  const playQuietTurn = async () => {
    await waitFor(() => expect(result.current.ctx.branch.simState?.p2MovesBySlot[0]?.some(move => !move.disabled)).toBe(true), { timeout: 60_000 });
    const sim = result.current.ctx.branch.simState!;
    const quiet = sim.p1MovesBySlot[0].find(move => move.name === 'Swords Dance')!;
    act(() => result.current.ctx.branch.setChoice('p1', { kind: 'move', moveId: toId(quiet.name), moveName: quiet.name }, 0));
    const reply = sim.p2MovesBySlot[0].find(move => move.name === 'Sucker Punch')!; // fails against a status move: the quiet turns hurt nobody
    act(() => result.current.ctx.branch.setChoice('p2', { kind: 'move', moveId: toId(reply.name), moveName: reply.name }, 0));
    const before = result.current.ctx.branch.history.length;
    await act(async () => { await result.current.handleExecuteTurn(); });
    await waitFor(() => expect(result.current.ctx.branch.history.length).toBe(before + 1), { timeout: 60_000 });
  };
  await playQuietTurn();
  await playQuietTurn();
  await waitFor(() => expect(result.current.board.timeline.liveTip).toBe(true));
  return { app: () => result.current };
}

describe('a play-out with the frame parked behind the tip (#112)', () => {
  test('the run keeps playing turns on the live sim', async () => {
    const { app } = await variationWithPivot();
    const before = app().ctx.branch.history.length;
    const tip = app().board.timeline.viewTurn;
    act(() => app().engine.playOutControls.startPlayOut());
    // The frame reports an earlier turn (a Pause after stepping back), after the timeline's 20 second play-in guard of the
    // last landed turn: the pointer follows the report.
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now + 25_000);
    act(() => app().board.timeline.handleReplayTurn(tip - 1));
    clock.mockRestore();
    expect(app().board.timeline.viewTurn).toBe(tip - 1);
    expect(app().board.timeline.liveTip).toBe(false);
    await waitFor(() => expect(app().ctx.branch.history.length).toBeGreaterThanOrEqual(before + 2), { timeout: 120_000 });
    // The run took its two turns from the live sim; whichever way it ends, it ended by itself and not by the pointer.
    act(() => app().engine.playOutControls.stopPlayOut());
  }, 240_000);
});
