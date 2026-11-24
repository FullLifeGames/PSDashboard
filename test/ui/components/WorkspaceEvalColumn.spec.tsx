import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import type { EvalSettings } from '@fulllifegames/eval-engine';
import type { AppController } from '../../../src/hooks/useAppController';
import { evalResult } from '../fixtures/eval-result';
import { singlesReplay } from '../fixtures/replay';
import { stubReplayFetch } from '../fixtures/network';
import { realReplayWorkerClient } from '../fixtures/worker';

const worker = vi.hoisted(() => ({ current: null as null | ReturnType<typeof import('../fixtures/worker').realReplayWorkerClient> }));
vi.mock('../../../src/hooks/useReplayWorker', () => ({ useReplayWorker: () => worker.current!.client }));

// Positions rebuild for real; the search answers from a script, so the sweep fills the graph at once.
const searches = vi.hoisted(() => ({ settings: [] as EvalSettings[] }));
vi.mock('../../../src/lib/eval/worker-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/lib/eval/worker-client')>();
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

  test('at turn 0 the play-out hint names the picked leads, not a turn', async () => {
    const app = await mountLoaded();
    act(() => app().board.timeline.handleGraphSelectLine(0));
    await waitFor(() => expect(app().board.timeline.viewT0).toBe(true));
    expect(screen.getByText('engine plays the game from turn 0 with the leads picked above')).toBeInTheDocument();
    expect(screen.queryByText(/engine finishes the game from turn/)).toBeNull();
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

    act(() => app().board.timeline.navigateTo({ turn: 3, line: 'main' }));
    await waitFor(() => expect(app().analysis.turnAnalysis?.turn).toBe(3));
    expect(screen.getByText('Turn 3')).toBeInTheDocument();
    expect(screen.getByTitle('What produced the numbers shown for this turn.')).toHaveTextContent(/^depth 1 · 3 samples$/);
    expect(screen.queryByRole('button', { name: /Think deeper/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Evaluate/ })).toBeNull();

    act(() => app().board.timeline.handleGraphSelectLine(0));
    await waitFor(() => expect(app().board.timeline.analysisTurn).toBe(0));
    expect(app().analysis.leadAnalysisData).not.toBeNull();
    expect(screen.getByText('Team preview')).toBeInTheDocument();
    expect(screen.queryByText('Turn 3')).toBeNull();
    expect(document.querySelectorAll('.ps-eval-choice').length).toBeGreaterThan(0);
    expect(document.querySelectorAll('button.ps-eval-choice')).toHaveLength(0);
    expect(app().ctx.branch.simState).toBeNull();

    act(() => app().board.timeline.navigateTo({ turn: 2, line: 'main' }));
    act(() => app().board.deviation.requestDeviation(null));
    await waitFor(() => expect(app().board.timeline.liveEvalView).toBe(true), { timeout: 60_000 });
    // The dock's fill runs the engine at the tip by itself: Cancel while it runs, Re-evaluate after.
    expect(screen.getByRole('button', { name: /evaluate|cancel/i })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Auto' })).toBeInTheDocument();
    expect(screen.queryByText('Game report', { selector: 'span' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Think deeper/ })).toBeNull();
    expect(screen.queryByText(/^Turn \d$/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Back to the main line' })).toBeNull();
  }, 240_000);
});
