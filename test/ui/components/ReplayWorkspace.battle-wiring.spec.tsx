import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import type { AppController } from '../../../src/hooks/useAppController';
import { replayData, type ReplayKind } from '../fixtures/replay';
import { stubReplayFetch } from '../fixtures/network';
import { realReplayWorkerClient } from '../fixtures/worker';

const worker = vi.hoisted(() => ({ current: null as null | ReturnType<typeof import('../fixtures/worker').realReplayWorkerClient> }));
const panel = vi.hoisted(() => ({ props: [] as Array<{ source?: string; getBattle?: () => unknown; replayLog?: string }> }));
vi.mock('../../../src/hooks/useReplayWorker', () => ({ useReplayWorker: () => worker.current!.client }));
vi.mock('../../../src/lib/pokemon-options', () => ({ getMovePool: async () => ['Dragon Claw'] }));
vi.mock('../../../src/components/dock/TurnDock', () => ({
  TurnDock: (props: { source?: string; getBattle?: () => unknown; replayLog?: string }) => {
    panel.props.push(props);
    return <div data-testid="turn-dock-spy" />;
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

describe('ReplayWorkspace hands the battle to the picker', () => {
  for (const kind of ['singles', 'doubles'] as const) {
    test(`${kind}: the live tip gets the branch's getBattle, a stored position its own battle and the replay's log`, async () => {
      const app = await mountLoaded(kind);
      await waitFor(() => expect(screen.getByTestId('turn-dock-spy')).toBeInTheDocument());
      expect(app().board.timeline.liveTip).toBe(false);
      expect(lastProps().getBattle).toBeUndefined();

      act(() => app().board.timeline.navigateTo({ turn: kind === 'singles' ? 2 : 1, line: 'main' }));
      act(() => app().board.deviation.requestDeviation(null));
      await waitFor(() => expect(app().board.timeline.liveTip).toBe(true), { timeout: 60_000 });
      await waitFor(() => expect(lastProps().getBattle).toBe(app().ctx.branch.getBattle));

      expect(lastProps().replayLog).toBeUndefined();

      if (kind === 'singles') {
        act(() => app().board.timeline.navigateTo({ turn: 1, line: 'main' }));
        await waitFor(() => expect(app().board.timeline.liveTip).toBe(false));
        await waitFor(() => expect(lastProps().source).toBe('stored'));
        expect(lastProps().getBattle).not.toBe(app().ctx.branch.getBattle);
        expect((lastProps().getBattle!() as { turn: number }).turn).toBe(1);
        expect(lastProps().replayLog).toBe(app().ctx.replay.replayData!.log);
      }
    }, 90_000);
  }
});
