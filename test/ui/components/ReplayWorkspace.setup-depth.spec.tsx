import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect } from 'react';
import type { AppController } from '../../../src/hooks/useAppController';
import { replayData, type ReplayKind } from '../fixtures/replay';
import { stubReplayFetch } from '../fixtures/network';
import { realReplayWorkerClient } from '../fixtures/worker';

const worker = vi.hoisted(() => ({ current: null as null | ReturnType<typeof import('../fixtures/worker').realReplayWorkerClient> }));
vi.mock('../../../src/hooks/useReplayWorker', () => ({ useReplayWorker: () => worker.current!.client }));
// The legal move pool is heavy dex data the what-if row loads lazily; a fixed pool keeps the workspace render cheap.
vi.mock('../../../src/lib/pokemon-options', () => ({ getMovePool: async () => ['Dragon Claw'] }));

const { useAppController } = await import('../../../src/hooks/useAppController');
const { ReplayWorkspace } = await import('../../../src/components/ReplayWorkspace');

/** The workspace over the real controller; the ref always holds the newest render's controller. */
function Workspace({ latestRef }: { latestRef: { current: AppController | null } }) {
  const app = useAppController();
  useEffect(() => { latestRef.current = app; });
  const replay = app.ctx.replay.replayData;
  return replay ? <ReplayWorkspace app={app} replayData={replay} /> : <p>No replay loaded</p>;
}

beforeEach(() => {
  localStorage.clear();
  worker.current = realReplayWorkerClient();
  window.history.replaceState(null, '', '/');
  let counter = 0;
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => `blob:test/${++counter}`), revokeObjectURL: vi.fn() }));
});

afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});

async function mountLoaded(kind: ReplayKind, link?: (id: string) => string) {
  const replay = replayData(kind);
  stubReplayFetch([replay]);
  const latest = { current: null as AppController | null };
  render(<Workspace latestRef={latest} />);
  expect(screen.getByText('No replay loaded')).toBeInTheDocument();
  await act(async () => { await latest.current!.ctx.replay.loadReplay(link ? link(replay.id) : replay.id); });
  await waitFor(() => expect(latest.current!.engine.smogonPending).toBe(false));
  return { app: () => latest.current!, replay };
}

describe('ReplayWorkspace: Depth and Samples in the Setup menu', () => {
  test.each([['singles'], ['doubles']] as const)('%s: Depth 2 brings Samples and updates the preferences; Auto takes the matrix depth back', async kind => {
    const { app } = await mountLoaded(kind);
    expect(screen.queryByText('Depth')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Setup' }));
    const depth = within(screen.getByText('Depth')).getByRole('combobox');
    await userEvent.selectOptions(depth, '2');
    await waitFor(() => expect(app().ctx.evaluation.prefs).toMatchObject({ mode: 'matrix', depth: 2 }));
    await userEvent.selectOptions(within(screen.getByText('Samples')).getByRole('combobox'), '3');
    await waitFor(() => expect(app().ctx.evaluation.prefs.samples).toBe(3));
    await userEvent.selectOptions(depth, 'auto');
    await waitFor(() => expect(app().ctx.evaluation.prefs).toMatchObject({ mode: 'auto', depth: 2, samples: 3 }));
    expect(screen.queryByText('Samples')).toBeNull();
    expect(screen.queryByText('Depth', { selector: '.ps-eval-controls *' })).toBeNull();
  });

  test('another engine hides both selects in the menu', async () => {
    const { app } = await mountLoaded('singles');
    act(() => app().ctx.engines.add('My bot', 'http://localhost:8765/'));
    await waitFor(() => expect(app().ctx.engines.selected.name).toBe('My bot'));
    await userEvent.click(screen.getByRole('button', { name: 'Setup' }));
    expect(screen.getByRole('button', { name: 'Edit Player' })).toBeInTheDocument();
    expect(screen.queryByText('Depth')).toBeNull();
    expect(screen.queryByText('Samples')).toBeNull();
  });
});
