import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect } from 'react';
import type { PokemonSet } from '@pkmn/sim';
import type { AppController } from '../../../src/hooks/useAppController';
import { stubReplayFetch } from '../fixtures/network';
import { realReplayWorkerClient } from '../fixtures/worker';
import { SIX, picks, startedRecord } from '../fixtures/new-game';

const worker = vi.hoisted(() => ({ current: null as null | ReturnType<typeof import('../fixtures/worker').realReplayWorkerClient> }));
vi.mock('../../../src/hooks/useReplayWorker', () => ({ useReplayWorker: () => worker.current!.client }));
vi.mock('../../../src/lib/pokemon-options', () => ({ getMovePool: async () => ['Dragon Claw'] }));

const { useAppController } = await import('../../../src/hooks/useAppController');
const { ReplayWorkspace } = await import('../../../src/components/ReplayWorkspace');

/**
 * Round 89 (lane H, #105), H16a (user ruling 13.11.2026): loading a replay from the Game menu asks first when an unsaved variation of
 * the open game is open; Cancel keeps the variation, Save Branch makes the question go away. Singles and doubles run the same rows.
 */

function Workspace({ latestRef }: { latestRef: { current: AppController | null } }) {
  const app = useAppController();
  useEffect(() => { latestRef.current = app; });
  const replay = app.ctx.replay.replayData;
  return replay ? <ReplayWorkspace app={app} replayData={replay} onNewGame={() => {}} /> : <p>No game open</p>;
}

beforeEach(() => {
  localStorage.clear();
  worker.current = realReplayWorkerClient();
  stubReplayFetch([]);
  window.history.replaceState(null, '', '/');
  let counter = 0;
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => `blob:test/${++counter}`), revokeObjectURL: vi.fn() }));
});
afterEach(() => { vi.unstubAllGlobals(); });

/** P1 plays level 100, P2 level 1: the first move of the first turn knocks out P2's lead (singles) or both of its leads (doubles). */
const level = (team: PokemonSet[], value: number): PokemonSet[] => team.map(set => ({ ...set, level: value }));

const CASES = [
  { name: 'singles', format: 'gen9ou', leads: { p1: ['Snorlax'], p2: ['Snorlax'] } },
  { name: 'doubles', format: 'gen9doublesou', leads: { p1: ['Snorlax', 'Garchomp'], p2: ['Snorlax', 'Garchomp'] } },
];

async function mountGame(format: string) {
  const record = await startedRecord(format, level(SIX, 100), level(SIX, 1));
  const latest = { current: null as AppController | null };
  render(<Workspace latestRef={latest} />);
  await act(async () => { await latest.current!.ctx.newGame.openRecord(record); });
  await waitFor(() => expect(latest.current!.ctx.replay.replayData?.id).toBe(record.id), { timeout: 30_000 });
  return { app: () => latest.current!, record };
}

/** The leads, then a first turn whose first move knocks out the opponent: its replacement is pending. */
async function playKnockoutTurn(app: () => AppController, leads: { p1: string[]; p2: string[] }) {
  act(() => app().board.deviation.startLeadVariation(leads));
  await waitFor(() => expect(app().ctx.branch.branching).toBe(true), { timeout: 60_000 });
  await waitFor(() => expect(app().board.deviation.branchPreparing).toBe(false), { timeout: 60_000 });
  await waitFor(() => expect(app().ctx.branch.executing).toBe(false));
  const state = app().ctx.branch.simState!;
  await act(async () => {
    for (const side of ['p1', 'p2'] as const) picks(state, side).forEach((choice, slot) => { if (choice) app().ctx.branch.setChoice(side, choice, slot); });
  });
  await act(async () => { await app().ctx.branch.executeTurn(); });
  await waitFor(() => expect(app().ctx.branch.executing).toBe(false), { timeout: 30_000 });
}


/** A game with one finished turn, then a different first turn from turn 1: a variation of the game (as the H7 row builds it). */
async function openVariation(format: string, leads: { p1: string[]; p2: string[] }) {
  const { app } = await mountGame(format);
  await playKnockoutTurn(app, leads);
  await act(async () => {
    picks(app().ctx.branch.simState!, 'p2').forEach((choice, slot) => { if (choice) app().ctx.branch.setChoice('p2', choice, slot); });
  });
  await act(async () => { await app().ctx.branch.executeTurn(); });
  await waitFor(() => expect(app().ctx.newGame.record!.turns).toBe(1), { timeout: 30_000 });
  act(() => app().board.timeline.navigateTo({ turn: 1, line: 'main' }));
  act(() => app().board.deviation.requestDeviation(null));
  await waitFor(() => expect(app().analysis.showBranch).toBe(true), { timeout: 60_000 });
  await act(async () => {
    const state = app().ctx.branch.simState!;
    for (const side of ['p1', 'p2'] as const) picks(state, side, 1).forEach((choice, slot) => { if (choice) app().ctx.branch.setChoice(side, choice, slot); });
  });
  await act(async () => { await app().ctx.branch.executeTurn(); });
  await waitFor(() => expect(app().ctx.branch.history.length).toBeGreaterThan(0), { timeout: 30_000 });
  return app;
}

async function typeReplayId(id: string) {
  await userEvent.click(screen.getByRole('button', { name: 'Game' }));
  const field = screen.getByRole('textbox', { name: 'Replay URL or ID' });
  await userEvent.clear(field);
  await userEvent.type(field, `${id}{Enter}`);
}

describe('loading a replay while an unsaved variation is open (H16a)', () => {
  test.each(CASES)('$name: the question comes first; Cancel keeps the variation; after Save Branch nothing is asked', async ({ format, leads }) => {
    const app = await openVariation(format, leads);
    await typeReplayId('gen9ou-777');
    const question = await screen.findByRole('alertdialog');
    expect(question).toHaveTextContent('The open variation is not saved. Loading a replay closes it.');
    // nothing was loaded: the game and its variation stand
    expect(app().ctx.replay.error).toBeNull();
    expect(app().ctx.branch.history.length).toBeGreaterThan(0);
    await userEvent.click(within(question).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.getByRole('button', { name: 'Discard variation' })).toBeInTheDocument();
    expect(app().ctx.branch.history.length).toBeGreaterThan(0);
    // saved: the same variation no longer asks
    await userEvent.keyboard('{Escape}');
    await userEvent.click(screen.getByRole('button', { name: 'Save Branch' }));
    await typeReplayId('gen9ou-777');
    expect(screen.queryByRole('alertdialog')).toBeNull();
    await waitFor(() => expect(app().ctx.replay.error).not.toBeNull(), { timeout: 30_000 });
    await act(async () => {});
  }, 300_000);
});
