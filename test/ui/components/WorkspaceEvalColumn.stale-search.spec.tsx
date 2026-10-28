import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, render, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { toId } from '@fulllifegames/replay-core';
import type { EvalResult } from '@fulllifegames/eval-engine';
import type { AppController } from '../../../src/hooks/useAppController';
import { evalResult, rankedChoice } from '../fixtures/eval-result';
import { singlesReplay } from '../fixtures/replay';
import { stubReplayFetch } from '../fixtures/network';
import { realReplayWorkerClient } from '../fixtures/worker';

// Round 77 (code-reading note of lane C): a search for a position the user just left kept its partial lines clickable.
// A click mapped the old position's choice onto the new position. The panel reads one evaluation for singles and
// doubles alike (the click handlers do not look at the game type), so the singles replay stands for both.
const worker = vi.hoisted(() => ({ current: null as null | ReturnType<typeof import('../fixtures/worker').realReplayWorkerClient> }));
vi.mock('../../../src/hooks/useReplayWorker', () => ({ useReplayWorker: () => worker.current!.client }));

// The search streams one partial result and never finishes.
vi.mock('../../../src/lib/eval/worker-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/lib/eval/worker-client')>();
  class HangingEvalWorkerClient {
    evaluate(_serialized: string, _settings: unknown, handlers?: { onPartial?(result: EvalResult): void }) {
      handlers?.onPartial?.(evalResult('singles', {
        perSide: { p1: [rankedChoice('move swordsdance', 'Swords Dance', 0.3)], p2: [rankedChoice('move suckerpunch', 'Sucker Punch', -0.3)] },
      }));
      return new Promise<EvalResult>(() => {});
    }
    async evalPair() { return 0.2; }
    cancel() {}
    dispose() {}
  }
  return { ...actual, EvalWorkerClient: HangingEvalWorkerClient };
});

const { useAppController } = await import('../../../src/hooks/useAppController');
const { WorkspaceEvalColumn } = await import('../../../src/components/WorkspaceEvalColumn');

function Column({ latestRef }: { latestRef: { current: AppController | null } }) {
  const app = useAppController();
  useEffect(() => { latestRef.current = app; });
  const replay = app.ctx.replay.replayData;
  return replay ? <WorkspaceEvalColumn app={app} replayData={replay} /> : null;
}

beforeEach(() => {
  worker.current = realReplayWorkerClient();
  stubReplayFetch([singlesReplay()]);
  window.history.replaceState(null, '', '/');
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('a search for a position the user left', () => {
  test('its partial lines are clickable on their own position and plain text once the pointer moved on', async () => {
    const latest = { current: null as AppController | null };
    render(<Column latestRef={latest} />);
    const app = () => latest.current!;
    await act(async () => { await app().ctx.replay.loadReplay(singlesReplay().id); });
    await waitFor(() => expect(app().engine.smogonPending).toBe(false));
    act(() => app().board.timeline.navigateTo({ turn: 2, line: 'main' }));
    act(() => app().board.deviation.requestDeviation(null));
    await waitFor(() => expect(app().ctx.branch.branching).toBe(true), { timeout: 60_000 });
    await waitFor(() => expect(app().ctx.branch.simState?.p2MovesBySlot[0]?.length).toBeGreaterThan(0));

    // Two quiet turns: Swords Dance against Sucker Punch, which fails against a status move.
    for (let played = 1; played <= 2; played += 1) {
      await waitFor(() => expect(app().ctx.branch.simState?.p1MovesBySlot[0]?.some(move => move.name === 'Swords Dance')).toBe(true), { timeout: 60_000 });
      act(() => app().ctx.branch.setChoice('p1', { kind: 'move', moveId: toId('Swords Dance'), moveName: 'Swords Dance' }, 0));
      act(() => app().ctx.branch.setChoice('p2', { kind: 'move', moveId: toId('Sucker Punch'), moveName: 'Sucker Punch' }, 0));
      await act(async () => { await app().handleExecuteTurn(); });
      await waitFor(() => expect(app().ctx.branch.history).toHaveLength(played), { timeout: 60_000 });
    }
    await waitFor(() => expect(app().board.timeline.liveTip).toBe(true));
    // Auto off: the search below starts only from the button.
    act(() => app().ctx.evaluation.setPrefs({ ...app().ctx.evaluation.prefs, auto: false, autoAnalyze: false }));

    act(() => app().engine.evalView.handleEvaluate());
    await waitFor(() => expect(app().ctx.evaluation.status).toBe('searching'));
    await waitFor(() => expect(document.querySelectorAll('.ps-eval-panel button.ps-eval-choice').length).toBeGreaterThan(0));
    expect(app().ctx.evaluation.status).toBe('searching');

    act(() => app().board.timeline.navigateTo({ turn: app().board.timeline.viewTurn - 1, line: 'variation' }));
    await waitFor(() => expect(app().board.timeline.liveTip).toBe(false));
    expect(app().board.evalResultMatchesView).toBe(false);
    // The lines stay on screen, as plain text.
    expect(document.querySelectorAll('.ps-eval-panel .ps-eval-choice').length).toBeGreaterThan(0);
    expect(document.querySelectorAll('.ps-eval-panel button.ps-eval-choice')).toHaveLength(0);
  }, 240_000);
});
