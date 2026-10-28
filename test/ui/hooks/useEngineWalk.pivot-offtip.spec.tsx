import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { toId } from '@fulllifegames/replay-core';
import type { EvalResult } from '@fulllifegames/eval-engine';
import { evalResult, rankedChoice } from '../fixtures/eval-result';
import { singlesReplay } from '../fixtures/replay';
import { stubReplayFetch } from '../fixtures/network';
import { realReplayWorkerClient } from '../fixtures/worker';
import type { AppController } from '../../../src/hooks/useAppController';

// Round 77 (C3): an engine line with a pivot, clicked off the tip of a variation, used to stop at the pivot's
// replacement ("Choose a replacement", the other side "(waiting)"); at the tip the click played the switch. The
// walk below runs over the real controller and a scripted search: the search answers with the pivot line on a
// normal position and with the one-sided replacement on a position that waits for it.
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

async function clickPivotLine(app: () => AppController) {
  const result = app().ctx.evaluation.result!;
  const pivot = result.perSide.p1[0];
  act(() => app().engine.walk.handleExploreChoice('p1', pivot, result.perSide.p2[0]));
}

const settled = (app: () => AppController) => {
  const sim = app().ctx.branch.simState;
  return !!sim && !sim.p1ForceSwitches.some(Boolean) && !app().ctx.branch.executing;
};

describe('an engine line with a pivot (C3)', () => {
  test('at the tip the click plays the pivot and its replacement', async () => {
    const { app } = await variationWithPivot();
    act(() => app().engine.evalView.handleEvaluate());
    await waitFor(() => expect(app().ctx.evaluation.status).toBe('done'), { timeout: 60_000 });
    await clickPivotLine(app);
    await waitFor(() => expect(app().ctx.branch.history.some(entry => entry.kind === 'forced')).toBe(true), { timeout: 60_000 });
    await waitFor(() => expect(settled(app)).toBe(true), { timeout: 60_000 });
  }, 240_000);

  test('off the tip the click plays the pivot and its replacement the same way', async () => {
    const { app } = await variationWithPivot();
    const tip = app().board.timeline.viewTurn;
    act(() => app().board.timeline.navigateTo({ turn: tip - 1, line: 'variation' }));
    await waitFor(() => expect(app().board.timeline.liveTip).toBe(false));
    act(() => app().engine.evalView.handleEvaluate());
    await waitFor(() => expect(app().ctx.evaluation.status).toBe('done'), { timeout: 60_000 });
    await clickPivotLine(app);
    await waitFor(() => expect(app().ctx.branch.history.some(entry => entry.kind === 'forced')).toBe(true), { timeout: 60_000 });
    await waitFor(() => expect(settled(app)).toBe(true), { timeout: 60_000 });
  }, 240_000);
});
