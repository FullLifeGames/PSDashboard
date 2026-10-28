import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import type { AppController } from '../../../src/hooks/useAppController';
import { replayData, type ReplayKind } from '../fixtures/replay';
import { stubReplayFetch } from '../fixtures/network';
import { realReplayWorkerClient } from '../fixtures/worker';

/**
 * Round 73 (T202, design gate 3a): the picker's preview prices a forced spread on a lone foe behind a screen on a copy of the
 * branch's live battle. The workspace hands that battle to the picker at the live tip only; a stored or reconstructed position has
 * no matching battle. The panel is a spy here, so the test reads the prop the workspace gives it.
 */
const worker = vi.hoisted(() => ({ current: null as null | ReturnType<typeof import('../fixtures/worker').realReplayWorkerClient> }));
const panel = vi.hoisted(() => ({ props: [] as Array<{ source?: string; getBattle?: () => unknown }> }));
vi.mock('../../../src/hooks/useReplayWorker', () => ({ useReplayWorker: () => worker.current!.client }));
vi.mock('../../../src/lib/pokemon-options', () => ({ getMovePool: async () => ['Dragon Claw'] }));
vi.mock('../../../src/components/BranchPanel', () => ({
  BranchPanel: (props: { source?: string; getBattle?: () => unknown }) => {
    panel.props.push(props);
    return <div data-testid="branch-panel-spy" />;
  },
}));

const { useAppController } = await import('../../../src/hooks/useAppController');
const { ReplayWorkspace } = await import('../../../src/components/ReplayWorkspace');

function Workspace({ latestRef }: { latestRef: { current: AppController | null } }) {
  const app = useAppController();
  useEffect(() => { latestRef.current = app; });
  const replay = app.ctx.replay.replayData;
  return replay ? <ReplayWorkspace app={app} replayData={replay} /> : <p>No replay loaded</p>;
}

beforeEach(() => {
  worker.current = realReplayWorkerClient();
  panel.props.length = 0;
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
  await act(async () => { await latest.current!.ctx.replay.loadReplay(replay.id); });
  await waitFor(() => expect(latest.current!.engine.smogonPending).toBe(false));
  return () => latest.current!;
}

const lastProps = () => panel.props[panel.props.length - 1];

describe('ReplayWorkspace hands the live battle to the picker (T202)', () => {
  for (const kind of ['singles', 'doubles'] as const) {
    test(`${kind}: the live tip gets the branch's getBattle, a stored position gets none`, async () => {
      const app = await mountLoaded(kind);
      await waitFor(() => expect(screen.getByTestId('branch-panel-spy')).toBeInTheDocument());
      // A loaded replay is not at a live tip: its pickers read the stored position.
      expect(app().board.timeline.liveTip).toBe(false);
      expect(lastProps().getBattle).toBeUndefined();

      // A variation owns a live battle, and the viewed position is its tip.
      act(() => app().board.timeline.navigateTo({ turn: kind === 'singles' ? 2 : 1, line: 'main' }));
      act(() => app().board.deviation.requestDeviation(null));
      await waitFor(() => expect(app().board.timeline.liveTip).toBe(true), { timeout: 60_000 });
      await waitFor(() => expect(lastProps().getBattle).toBe(app().ctx.branch.getBattle));

      // Stepping back to an earlier turn leaves the tip: that position has no matching battle. The doubles fixture has one turn.
      if (kind === 'singles') {
        act(() => app().board.timeline.navigateTo({ turn: 1, line: 'main' }));
        await waitFor(() => expect(app().board.timeline.liveTip).toBe(false));
        await waitFor(() => expect(lastProps().getBattle).toBeUndefined());
      }
    }, 90_000);
  }
});
