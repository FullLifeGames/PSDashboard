import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect } from 'react';
import { toId } from '@fulllifegames/replay-core';
import type { AppController } from '../../src/hooks/useAppController';
import { replayData, type ReplayKind } from '../fixtures/replay';
import { stubReplayFetch } from '../fixtures/network';
import { realReplayWorkerClient } from '../fixtures/worker';

const worker = vi.hoisted(() => ({ current: null as null | ReturnType<typeof import('../fixtures/worker').realReplayWorkerClient> }));
vi.mock('../../src/hooks/useReplayWorker', () => ({ useReplayWorker: () => worker.current!.client }));
// The legal move pool is heavy dex data the what-if row loads lazily; a fixed pool keeps the workspace render cheap.
vi.mock('../../src/lib/pokemon-options', () => ({ getMovePool: async () => ['Dragon Claw'] }));

const { useAppController } = await import('../../src/hooks/useAppController');
const { ReplayWorkspace } = await import('../../src/components/ReplayWorkspace');

/** The workspace over the real controller; the ref always holds the newest render's controller. */
function Workspace({ latestRef }: { latestRef: { current: AppController | null } }) {
  const app = useAppController();
  useEffect(() => { latestRef.current = app; });
  const replay = app.ctx.replay.replayData;
  return replay ? <ReplayWorkspace app={app} replayData={replay} /> : <p>No replay loaded</p>;
}

beforeEach(() => {
  worker.current = realReplayWorkerClient();
  window.history.replaceState(null, '', '/');
  let counter = 0;
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => `blob:test/${++counter}`), revokeObjectURL: vi.fn() }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function mountLoaded(kind: ReplayKind) {
  const replay = replayData(kind);
  stubReplayFetch([replay]);
  const latest = { current: null as AppController | null };
  render(<Workspace latestRef={latest} />);
  expect(screen.getByText('No replay loaded')).toBeInTheDocument();
  await act(async () => { await latest.current!.ctx.replay.loadReplay(replay.id); });
  await waitFor(() => expect(latest.current!.engine.smogonPending).toBe(false));
  return { app: () => latest.current!, replay };
}

const sideLabels = () => [...document.querySelectorAll('.ps-side-label')].map(label => label.textContent);

describe('ReplayWorkspace', () => {
  test('a loaded singles replay shows the top bar, the battle frame, the timeline, the loader, the pickers, and the evaluation column', async () => {
    const { app, replay } = await mountLoaded('singles');
    expect(screen.getByRole('button', { name: 'Edit Opp' })).toBeInTheDocument();
    expect(screen.getByTitle('PS Replay')).toHaveAttribute('src', expect.stringMatching(/^blob:/));
    expect(screen.getByRole('slider', { name: 'Timeline turn selector' })).toBeInTheDocument();
    expect((screen.getByRole('textbox', { name: 'Replay URL or ID' }) as HTMLInputElement).value).toContain(replay.id);
    expect(screen.getByText('Evaluation')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Let it play out/ })).toBeInTheDocument();
    expect(screen.getByText('Battle Statistics')).toBeInTheDocument();
    expect(screen.queryByText('Variation moves')).toBeNull();
    expect(screen.queryByTitle('Branch Simulation')).toBeNull();

    // Off the live tip the pickers come from the position source: approximated first, exact once rebuilt.
    act(() => app().board.timeline.navigateTo({ turn: 2, line: 'main' }));
    await waitFor(() => expect(app().engine.pickerSimState).not.toBeNull(), { timeout: 30_000 });
    expect(sideLabels()).toEqual(['P1', 'P2']);
    expect(screen.getByRole('button', { name: /^Select/ })).toBeDisabled();
    expect(screen.getByText(/^Choices/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Advanced ▸' })).toBeInTheDocument();
  }, 90_000);

  test('a variation opens the branch panels; its first executed turn swaps the frame to the branch simulation; a pending confirm shows its banner', async () => {
    const { app } = await mountLoaded('singles');
    act(() => app().board.timeline.navigateTo({ turn: 2, line: 'main' }));
    act(() => app().board.deviation.requestDeviation(null));
    await waitFor(() => expect(app().analysis.showBranch).toBe(true), { timeout: 60_000 });
    expect(screen.getByText('Variation moves')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save Branch' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy Share Link' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Evaluate' })).toBeInTheDocument();
    expect(screen.queryByText(/^Choices/)).toBeNull();
    // The branch start is still the replay's own position: the replay frame stays until the variation has a turn of its own.
    expect(screen.getByTitle('PS Replay')).toBeInTheDocument();

    const sim = app().ctx.branch.simState!;
    const firstLegal = (moves: typeof sim.p1MovesBySlot[0]) => {
      const move = moves.find(candidate => !candidate.disabled)!;
      return { kind: 'move' as const, moveId: toId(move.name), moveName: move.name };
    };
    act(() => app().board.deviation.handleSetChoice('p1', firstLegal(sim.p1MovesBySlot[0]), 0));
    act(() => app().board.deviation.handleSetChoice('p2', firstLegal(sim.p2MovesBySlot[0]), 0));
    await userEvent.click(screen.getByRole('button', { name: 'Execute Turn' }));
    await waitFor(() => expect(app().ctx.branch.history).toHaveLength(1), { timeout: 30_000 });
    expect(await screen.findByTitle('Branch Simulation', {}, { timeout: 10_000 })).toHaveAttribute('src', expect.stringMatching(/^blob:/));
    expect(screen.queryByTitle('PS Replay')).toBeNull();
    expect(app().board.timeline.viewingVariation).toBe(true);
    expect(screen.getByRole('button', { name: /Main line \(turn 3\)/ })).toBeInTheDocument();

    const proceed = vi.fn();
    act(() => app().transients.setPendingConfirm({ message: 'Deviating here replaces your variation.', proceed }));
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Deviating here replaces your variation.');
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(proceed).not.toHaveBeenCalled();
  }, 90_000);

  test('a doubles replay renders two slot columns per side', async () => {
    const { app } = await mountLoaded('doubles');
    act(() => app().board.timeline.navigateTo({ turn: 2, line: 'main' }));
    await waitFor(() => expect(app().engine.pickerSimState).not.toBeNull(), { timeout: 30_000 });
    expect(sideLabels()).toEqual(['P1A', 'P1B', 'P2A', 'P2B']);
    expect(screen.getByRole('button', { name: 'Select all active choices' })).toBeDisabled();
  }, 90_000);
});
