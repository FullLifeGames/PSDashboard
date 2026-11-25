import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, render, screen, waitFor, within, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect } from 'react';
import type { PokemonSet } from '@pkmn/sim';
import type { AppController } from '../../../src/hooks/useAppController';
import { stubReplayFetch } from '../fixtures/network';
import { realReplayWorkerClient } from '../fixtures/worker';
import { SIX, picks, startedRecord } from '../fixtures/new-game';
import { readShare } from '../../../src/lib/branch-share';
import { loadGame } from '../../../src/lib/new-game/store';

const worker = vi.hoisted(() => ({ current: null as null | ReturnType<typeof import('../fixtures/worker').realReplayWorkerClient> }));
vi.mock('../../../src/hooks/useReplayWorker', () => ({ useReplayWorker: () => worker.current!.client }));
vi.mock('../../../src/lib/pokemon-options', () => ({ getMovePool: async () => ['Dragon Claw'] }));

const { useAppController } = await import('../../../src/hooks/useAppController');
const { ReplayWorkspace } = await import('../../../src/components/ReplayWorkspace');

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

describe('loading a replay while an unsaved variation is open', () => {
  test.each(CASES)('$name: the question comes first; Cancel keeps the variation; after Save Branch nothing is asked', async ({ format, leads }) => {
    const app = await openVariation(format, leads);
    await typeReplayId('gen9ou-777');
    const question = await screen.findByRole('alertdialog');
    expect(question).toHaveTextContent('The open variation is not saved. Loading a replay closes it.');
    expect(app().ctx.replay.error).toBeNull();
    expect(app().ctx.branch.history.length).toBeGreaterThan(0);
    await userEvent.click(within(question).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.getByRole('button', { name: 'Discard variation' })).toBeInTheDocument();
    expect(app().ctx.branch.history.length).toBeGreaterThan(0);
    await userEvent.keyboard('{Escape}');
    await userEvent.click(screen.getByRole('button', { name: 'Save Branch' }));
    await typeReplayId('gen9ou-777');
    expect(screen.queryByRole('alertdialog')).toBeNull();
    await waitFor(() => expect(app().ctx.replay.error).not.toBeNull(), { timeout: 30_000 });
    await act(async () => {});
  }, 300_000);
});

describe('Discard variation', () => {
  test.each(CASES)('$name: with a played turn the question comes first; Cancel keeps the variation, Discard variation drops it', async ({ format, leads }) => {
    const app = await openVariation(format, leads);
    await userEvent.click(screen.getByRole('button', { name: 'Discard variation' }));
    const question = await screen.findByRole('alertdialog');
    expect(question).toHaveTextContent(/The variation has \d+ played turns?\. Discarding drops (it|them)\./);
    expect(app().ctx.branch.history.length).toBeGreaterThan(0);
    await userEvent.click(within(question).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(app().ctx.branch.history.length).toBeGreaterThan(0);
    await userEvent.click(screen.getByRole('button', { name: 'Discard variation' }));
    await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Discard variation' }));
    await waitFor(() => expect(app().ctx.branch.history.length).toBe(0));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(app().ctx.branch.branching).toBe(false);
  }, 300_000);

  test.each(CASES)('$name: a variation with no played turn is discarded at once', async ({ format, leads }) => {
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
    expect(app().ctx.branch.history.length).toBe(0);
    await userEvent.click(await screen.findByRole('button', { name: 'Discard variation' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    await waitFor(() => expect(app().ctx.branch.branching).toBe(false));
  }, 300_000);
});

function expectNoVariationChrome() {
  expect(screen.queryByRole('group', { name: 'Line selector' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Discard variation' })).toBeNull();
  expect(screen.queryByRole('button', { name: /Variation moves/ })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Save Branch' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Copy Share Link' })).toBeNull();
  expect(screen.queryByText(/Gold = your variation/)).toBeNull();
  expect(screen.queryByText(/Variation tip/)).toBeNull();
  expect(document.querySelector('.ps-timeline-stripe')).toBeNull();
  expect(document.body.textContent).not.toMatch(/Turn \d+ · variation/);
}

async function copiedGameLink() {
  await userEvent.click(screen.getByRole('button', { name: 'Game' }));
  // with a variation open the branch bar has a button of the same name: this one is the menu's
  await userEvent.click(within(document.querySelector('.ps-loader-panel') as HTMLElement).getByRole('button', { name: 'Copy Share Link' }));
  const field = (await screen.findByRole('textbox', { name: 'Game share link' })) as HTMLInputElement;
  const read = readShare(field.value.split('#branch=')[1]);
  if (read.kind !== 'game') throw new Error(`the link is a ${read.kind} link`);
  await userEvent.keyboard('{Escape}');
  return read.payload;
}

describe('a game tip whose knockout turn waits for its replacement is no variation', () => {
  test.each(CASES)('$name: no variation chrome while the replacement is pending, and none after it joins the turn', async ({ format, leads }) => {
    const { app, record } = await mountGame(format);
    await playKnockoutTurn(app, leads);
    const state = app().ctx.branch.simState!;
    expect(state.p2ForceSwitch).toBe(true);
    expect(app().ctx.newGame.record!.turns).toBe(0);
    expectNoVariationChrome();
    const pending = await copiedGameLink();
    expect(pending.variation).toBeUndefined();
    expect(pending.entries).toHaveLength(app().ctx.newGame.record!.entries.length);
    expect(pending.gameId).toBe(record.id);
    expect(pending.view).toEqual({ turn: 1, line: 'main' });

    await act(async () => {
      picks(app().ctx.branch.simState!, 'p2').forEach((choice, slot) => { if (choice) app().ctx.branch.setChoice('p2', choice, slot); });
    });
    await act(async () => { await app().ctx.branch.executeTurn(); });
    await waitFor(() => expect(app().ctx.newGame.record!.turns).toBe(1), { timeout: 30_000 });
    await waitFor(() => expect(app().ctx.branch.executing).toBe(false));
    expectNoVariationChrome();
    const joined = await copiedGameLink();
    expect(joined.variation).toBeUndefined();
    expect(joined.entries.length).toBeGreaterThan(pending.entries.length);
    await act(async () => {});
  }, 240_000);

  test('a turn played from an earlier turn is a variation and shows its chrome (the rule stays for real variations)', async () => {
    const { app } = await mountGame('gen9ou');
    await playKnockoutTurn(app, CASES[0].leads);
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
    expect(within(document.body).getByRole('button', { name: /Variation moves/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Discard variation' })).toBeInTheDocument();
    const link = await copiedGameLink();
    expect(link.variation?.startTurn).toBe(1);
    await act(async () => {});
  }, 240_000);
});

describe('a reload while a replacement is pending keeps the played turn', () => {
  test.each(CASES)('$name: the reopened game shows the turn played and asks for the replacement; picking it continues the game', async ({ format, leads }) => {
    const first = await mountGame(format);
    await playKnockoutTurn(first.app, leads);
    expect(first.app().ctx.branch.simState!.p2ForceSwitch).toBe(true);
    const viewBefore = first.app().board.timeline.viewTurn;
    const entriesBefore = first.app().ctx.branch.history.length;
    expect(entriesBefore).toBeGreaterThan(0);
    cleanup();
    const saved = loadGame(first.record.id)!;
    expect(saved.turns).toBe(0);
    const latest = { current: null as AppController | null };
    render(<Workspace latestRef={latest} />);
    await act(async () => { await latest.current!.ctx.newGame.openRecord(saved); });
    await waitFor(() => expect(latest.current!.ctx.replay.replayData?.id).toBe(saved.id), { timeout: 30_000 });
    await waitFor(() => expect(latest.current!.ctx.branch.history.length).toBe(entriesBefore), { timeout: 60_000 });
    await waitFor(() => expect(latest.current!.ctx.branch.executing).toBe(false));
    await waitFor(() => expect(latest.current!.ctx.branch.simState?.p2ForceSwitch).toBe(true), { timeout: 30_000 });
    expect(latest.current!.ctx.newGame.record!.turns).toBe(0);
    expect(latest.current!.board.timeline.viewTurn).toBe(viewBefore);
    expectNoVariationChrome();
    await act(async () => {
      picks(latest.current!.ctx.branch.simState!, 'p2').forEach((choice, slot) => { if (choice) latest.current!.ctx.branch.setChoice('p2', choice, slot); });
    });
    await act(async () => { await latest.current!.ctx.branch.executeTurn(); });
    await waitFor(() => expect(latest.current!.ctx.newGame.record!.turns).toBe(1), { timeout: 30_000 });
    expect(loadGame(saved.id)!.turns).toBe(1);
    expect(loadGame(saved.id)!.pending).toBeUndefined();
    await act(async () => {});
  }, 300_000);
});
