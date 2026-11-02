import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect } from 'react';
import { toId } from '@fulllifegames/replay-core';
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

// Round 84 (turn dock): the slot labels sit on the dock's chips.
const sideLabels = () => [...document.querySelectorAll('.ps-dock-label')].map(label => label.textContent);
const chip = (label: string) => screen.getByRole('button', { name: new RegExp(`^${label}\\b`) });

describe('ReplayWorkspace', () => {
  test('a loaded singles replay shows the top bar with the Load button, the battle frame, the timeline, the pickers, and the evaluation column', async () => {
    const { app, replay } = await mountLoaded('singles');
    expect(screen.getByRole('button', { name: 'Setup' })).toBeInTheDocument();
    expect(screen.getByTitle('PS Replay')).toHaveAttribute('src', expect.stringMatching(/^blob:/));
    expect(screen.getByRole('slider', { name: 'Timeline turn selector' })).toBeInTheDocument();
    // Round 84 (Q20 a): the column holds no loader; the Load button in the top bar opens it with the loaded link.
    expect(document.querySelector('.ps-main-left .ps-panel input[aria-label="Replay URL or ID"]')).toBeNull();
    expect(screen.queryByRole('textbox', { name: 'Replay URL or ID' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Load' }));
    expect((screen.getByRole('textbox', { name: 'Replay URL or ID' }) as HTMLInputElement).value).toContain(replay.id);
    expect(document.querySelector('.ps-topbar-actions .ps-loader-panel')).not.toBeNull();
    await userEvent.keyboard('{Escape}');
    expect(screen.getByText('Evaluation')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Let it play out/ })).toBeInTheDocument();
    expect(screen.getByText('Battle Statistics')).toBeInTheDocument();
    expect(screen.queryByText('Variation moves')).toBeNull();
    expect(screen.queryByTitle('Branch Simulation')).toBeNull();

    // Off the live tip the pickers come from the position source: approximated first, exact once rebuilt.
    act(() => app().board.timeline.navigateTo({ turn: 2, line: 'main' }));
    await waitFor(() => expect(app().engine.pickerSimState).not.toBeNull(), { timeout: 30_000 });
    expect(sideLabels()).toEqual(['P1', 'P2']);
    // Round 84 (turn dock, gate list 1 and 3): every slot starts with the choice the log played, so Execute is ready at once
    // (it used to wait for a pick on each side).
    await waitFor(() => expect(screen.getByRole('button', { name: 'Execute Turn' })).toBeEnabled(), { timeout: 30_000 });
    expect(screen.getByText(/^Choices/)).toBeInTheDocument();
    // The dock is the last child of the replay column, and the Advanced toggle is gone.
    expect(document.querySelector('.ps-main-left')!.lastElementChild).toHaveClass('ps-dock');
    expect(screen.queryByRole('button', { name: /^Advanced/ })).toBeNull();
    // Ruling C6 (integrator, 01.11.2026): the Raw Protocol Log toggle stays at every position, directly above the dock.
    expect(screen.getByRole('button', { name: 'Show Raw Protocol Log' }).closest('.ps-dock-log')!.nextElementSibling).toHaveClass('ps-dock');
  }, 90_000);

  test('a variation opens the branch panels; its first executed turn swaps the frame to the branch simulation; a pending confirm shows its banner', async () => {
    const { app } = await mountLoaded('singles');
    act(() => app().board.timeline.navigateTo({ turn: 2, line: 'main' }));
    act(() => app().board.deviation.requestDeviation(null));
    await waitFor(() => expect(app().analysis.showBranch).toBe(true), { timeout: 60_000 });
    expect(screen.getByText('Variation moves')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save Branch' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy Share Link' })).toBeInTheDocument();
    // Round 84 (A6a): the engine fill starts a run at the variation's tip by itself, so the entry reads Cancel while it goes.
    expect(screen.getByRole('button', { name: /^(Evaluate|Cancel|Re-evaluate)$/ })).toBeInTheDocument();
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

  test('an armed Tera toggle falls back when the timeline moves to another position (T124 point 2)', async () => {
    const { app } = await mountLoaded('singles');
    // The Tera toggles come with the exact position (the snapshot approximation names no Tera type).
    const exactAt = async (turn: number) => {
      act(() => app().board.timeline.navigateTo({ turn, line: 'main' }));
      await waitFor(() => expect(app().engine.positionPicker?.source).toBe('stored'), { timeout: 60_000 });
      await waitFor(() => expect(app().engine.pickerSimState?.turnNumber).toBe(turn), { timeout: 30_000 });
    };
    // Round 84 (turn dock): the toggle sits in the open slot's tray, and a new position closes the tray.
    const tera = () => screen.getAllByRole('button', { name: /^Tera \(/ })[0];
    const openTray = async () => {
      await userEvent.click(chip('P1'));
      await screen.findAllByRole('button', { name: /^Tera \(/ }, { timeout: 10_000 });
    };
    // Both positions rebuilt once: the way back reads them from the store, with no snapshot step in between.
    await exactAt(3);
    await exactAt(2);
    await openTray();
    await userEvent.click(tera());
    expect(tera()).toHaveAttribute('aria-pressed', 'true');
    // Turn 3 keeps the same two actives, both still able to terastallize, and comes from the store at once:
    // only the move to a new position can release the toggle.
    await exactAt(3);
    expect(document.querySelector('.ps-tray')).toBeNull();
    await openTray();
    expect(sideLabels()).toEqual(['P1', 'P2']);
    expect(tera()).toHaveAttribute('aria-pressed', 'false');
  }, 90_000);

  // Round 77 (C2): the turn 0 picker hands its selection to the play-out, for singles and doubles.
  test.each([['singles', 1], ['doubles', 2]] as const)('%s: the lead picker publishes its selection while the turn 0 view is open', async (kind, leads) => {
    const { app } = await mountLoaded(kind);
    expect(app().transients.leadPicksRef.current).toBeNull();
    act(() => app().board.timeline.handleGraphSelect(0));
    const published = () => app().transients.leadPicksRef.current;
    await waitFor(() => expect(published()).not.toBeNull());
    expect(published()!.p1).toHaveLength(leads);
    const before = published()!.p1;
    const benched = [...document.querySelectorAll<HTMLButtonElement>('.ps-lead-side button[aria-pressed="false"]')][0];
    await userEvent.click(benched);
    await waitFor(() => expect(published()!.p1).not.toEqual(before));
    act(() => app().board.timeline.navigateTo({ turn: 2, line: 'main' }));
    await waitFor(() => expect(published()).toBeNull());
  }, 90_000);

  test('a doubles replay renders two rows of two chips', async () => {
    const { app } = await mountLoaded('doubles');
    act(() => app().board.timeline.navigateTo({ turn: 2, line: 'main' }));
    await waitFor(() => expect(app().engine.pickerSimState).not.toBeNull(), { timeout: 30_000 });
    expect(sideLabels()).toEqual(['P1A', 'P1B', 'P2A', 'P2B']);
    expect([...document.querySelectorAll('.ps-dock-row')].map(row => row.querySelectorAll('.ps-dock-chip').length)).toEqual([2, 2]);
    // The fixture's turn 2 logs no action for some slot, so that chip starts empty and Execute waits for its pick (gate list 7).
    expect(document.querySelector('.ps-dock-chip[data-empty="true"]')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Select all active choices' })).toBeDisabled();
  }, 90_000);
});
