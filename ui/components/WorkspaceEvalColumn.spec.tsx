import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import type { EvalSettings } from '@fulllifegames/eval-engine';
import type { AppController } from '../../src/hooks/useAppController';
import { evalResult } from '../fixtures/eval-result';
import { singlesReplay } from '../fixtures/replay';
import { stubReplayFetch } from '../fixtures/network';
import { realReplayWorkerClient } from '../fixtures/worker';

const worker = vi.hoisted(() => ({ current: null as null | ReturnType<typeof import('../fixtures/worker').realReplayWorkerClient> }));
vi.mock('../../src/hooks/useReplayWorker', () => ({ useReplayWorker: () => worker.current!.client }));

// Positions rebuild for real on the test thread; the search itself answers
// from a script, so the sweep fills the graph in one go.
const searches = vi.hoisted(() => ({ settings: [] as EvalSettings[] }));
vi.mock('../../src/lib/eval/worker-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/lib/eval/worker-client')>();
  class ScriptedEvalWorkerClient {
    async evaluate(_serialized: string, settings: EvalSettings) {
      searches.settings.push(settings);
      return evalResult('singles', { score: 0.2 });
    }
    async evalPair() { return 0.2; }
    cancel() {}
    dispose() {}
  }
  return { ...actual, EvalWorkerClient: ScriptedEvalWorkerClient };
});

const { useAppController } = await import('../../src/hooks/useAppController');
const { WorkspaceEvalColumn } = await import('../../src/components/WorkspaceEvalColumn');

/** The evaluation column over the real controller; the ref always holds the newest render's controller. */
function Column({ latestRef }: { latestRef: { current: AppController | null } }) {
  const app = useAppController();
  useEffect(() => { latestRef.current = app; });
  const replay = app.ctx.replay.replayData;
  return replay ? <WorkspaceEvalColumn app={app} replayData={replay} /> : null;
}

beforeEach(() => {
  worker.current = realReplayWorkerClient();
  searches.settings = [];
  stubReplayFetch([singlesReplay()]);
  window.history.replaceState(null, '', '/');
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function mountLoaded() {
  const latest = { current: null as AppController | null };
  render(<Column latestRef={latest} />);
  await act(async () => { await latest.current!.ctx.replay.loadReplay(singlesReplay().id); });
  await waitFor(() => expect(latest.current!.engine.smogonPending).toBe(false));
  return () => latest.current!;
}

describe('WorkspaceEvalColumn', () => {
  test('before a sweep: the panel offers Analyze game, the play-out bar and the stats stand below, the analysis surface is empty', async () => {
    await mountLoaded();
    expect(screen.getByText('Evaluation')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Analyze game' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: /Evaluate/ })).toBeNull();
    expect(screen.queryByRole('checkbox', { name: 'Auto' })).toBeNull();
    expect(screen.getByRole('checkbox', { name: 'Always on' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Let it play out/ })).toBeInTheDocument();
    expect(screen.getByText('Battle Statistics')).toBeInTheDocument();
    expect(screen.queryByText('Game report', { selector: 'span' })).toBeNull();
    expect(screen.queryByRole('img', { name: /Evaluation over/ })).toBeNull();
  }, 60_000);

  test('a sweep fills the graph and the report; the selected turn shows its analysis, T0 the leads; a variation hands the panel to the live view', async () => {
    const app = await mountLoaded();
    await act(async () => { app().engine.evalView.handleAnalyzeGame(); });
    await waitFor(() => expect(app().analysis.gameReport).not.toBeNull(), { timeout: 120_000 });
    await waitFor(() => expect(app().ctx.evaluation.graph.running).toBe(false), { timeout: 60_000 });
    expect(searches.settings.length).toBeGreaterThan(0);
    expect(screen.getByRole('img', { name: /Evaluation over \d+ turns/ })).toBeInTheDocument();
    expect(screen.getByText('Game report', { selector: 'span' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Re-analyze' })).toBeInTheDocument();

    // The slider moves the analysis turn: that turn's view opens with its provenance and the deepen control.
    act(() => app().board.timeline.navigateTo({ turn: 3, line: 'main' }));
    await waitFor(() => expect(app().analysis.turnAnalysis?.turn).toBe(3));
    expect(screen.getByText('Turn 3')).toBeInTheDocument();
    expect(screen.getByTitle('What produced the numbers shown for this turn.')).toHaveTextContent(/^(depth \d · \d samples?|MCTS)$/);
    expect(screen.getByRole('button', { name: /Think deeper about this position/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Evaluate/ })).toBeNull();

    // The graph's T0 point opens the team-preview analysis: the replay has a preview, so the sweep graded the leads.
    act(() => app().board.timeline.handleGraphSelectLine(0));
    await waitFor(() => expect(app().board.timeline.analysisTurn).toBe(0));
    expect(app().analysis.leadAnalysisData).not.toBeNull();
    expect(screen.getByText('Team preview')).toBeInTheDocument();
    expect(screen.queryByText('Turn 3')).toBeNull();

    // Entering a variation: the live evaluation view owns the panel, the analysis block and report step back.
    act(() => app().board.timeline.navigateTo({ turn: 2, line: 'main' }));
    act(() => app().board.deviation.requestDeviation(null));
    await waitFor(() => expect(app().board.timeline.liveEvalView).toBe(true), { timeout: 60_000 });
    expect(screen.getByRole('button', { name: /Evaluate/ })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Auto' })).toBeInTheDocument();
    expect(screen.queryByText('Game report', { selector: 'span' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Think deeper/ })).toBeNull();
    expect(screen.queryByText(/^Turn \d$/)).toBeNull();
  }, 240_000);
});
