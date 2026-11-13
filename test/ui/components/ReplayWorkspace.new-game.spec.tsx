import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect } from 'react';
import type { PokemonSet } from '@pkmn/sim';
import type { AppController } from '../../../src/hooks/useAppController';
import { readShare } from '../../../src/lib/branch-share';
import { stubReplayFetch } from '../fixtures/network';
import { realReplayWorkerClient } from '../fixtures/worker';
import { SIX, picks, startedRecord } from '../fixtures/new-game';
import { loadGame } from '../../../src/lib/new-game/store';

const worker = vi.hoisted(() => ({ current: null as null | ReturnType<typeof import('../fixtures/worker').realReplayWorkerClient> }));
vi.mock('../../../src/hooks/useReplayWorker', () => ({ useReplayWorker: () => worker.current!.client }));
vi.mock('../../../src/lib/pokemon-options', () => ({ getMovePool: async () => ['Dragon Claw'] }));

const { useAppController } = await import('../../../src/hooks/useAppController');
const { ReplayWorkspace } = await import('../../../src/components/ReplayWorkspace');

/**
 * Round 89 (lane H, #105), step H7 (wave-tester, second pass, findings 1 and 2): the new game's workspace over the real controller.
 * While the game's own next turn is a knockout that waits for its replacement, the turn is no variation: the timeline, the side
 * panels, the graph note and the share link read as the main line's tip. The game's Copy Share Link stands in the Game menu, whether
 * a variation is open or not. Singles and doubles share every line of the code; both run here (Champions VGC and Gen 4 differ only
 * in the format they start).
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

/** Everything a variation shows: the line chip, Discard, the panel and its buttons, the graph's gold note, the card's tag. */
function expectNoVariationChrome() {
  expect(screen.queryByRole('group', { name: 'Line selector' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Discard variation' })).toBeNull();
  expect(screen.queryByRole('button', { name: /Variation moves/ })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Save Branch' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Copy Share Link' })).toBeNull();
  expect(screen.queryByText(/Gold = your variation/)).toBeNull();
  expect(screen.queryByText(/Branching/)).toBeNull();
  expect(document.querySelector('.ps-timeline-stripe')).toBeNull();
  expect(document.body.textContent).not.toMatch(/Turn \d+ · variation/);
}

/** The Game menu's Copy Share Link, the link it writes into its field, read back as the app reads a link. */
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

describe('a game tip whose knockout turn waits for its replacement is no variation (finding 2)', () => {
  test.each(CASES)('$name: no variation chrome while the replacement is pending, and none after it joins the turn', async ({ format, leads }) => {
    const { app, record } = await mountGame(format);
    await playKnockoutTurn(app, leads);
    // the scene: the turn ran, the opponent's replacement is asked for, the turn is not on the main line yet
    const state = app().ctx.branch.simState!;
    expect(state.p2ForceSwitch).toBe(true);
    expect(app().ctx.newGame.record!.turns).toBe(0);
    expectNoVariationChrome();
    // a link copied now holds the game's main line and no turn of the pending one
    const pending = await copiedGameLink();
    expect(pending.variation).toBeUndefined();
    expect(pending.entries).toHaveLength(app().ctx.newGame.record!.entries.length);
    expect(pending.gameId).toBe(record.id);
    expect(pending.view).toEqual({ turn: 1, line: 'main' });

    // the replacement joins the turn to the main line
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
    // back to the position before turn 1 and a different first turn: a variation of the game
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

describe('a reload while a replacement is pending keeps the played turn (finding 8)', () => {
  test.each(CASES)('$name: the reopened game shows the turn played and asks for the replacement; picking it continues the game', async ({ format, leads }) => {
    const first = await mountGame(format);
    await playKnockoutTurn(first.app, leads);
    expect(first.app().ctx.branch.simState!.p2ForceSwitch).toBe(true);
    const viewBefore = first.app().board.timeline.viewTurn;
    const entriesBefore = first.app().ctx.branch.history.length;
    expect(entriesBefore).toBeGreaterThan(0);
    // the reload: a fresh app over the saved game (the browser's storage is all that survives)
    cleanup();
    const saved = loadGame(first.record.id)!;
    expect(saved.turns).toBe(0);
    const latest = { current: null as AppController | null };
    render(<Workspace latestRef={latest} />);
    await act(async () => { await latest.current!.ctx.newGame.openRecord(saved); });
    await waitFor(() => expect(latest.current!.ctx.replay.replayData?.id).toBe(saved.id), { timeout: 30_000 });
    // the turn stands played: its entry is back on the live branch, the opponent's replacement is asked for
    await waitFor(() => expect(latest.current!.ctx.branch.history.length).toBe(entriesBefore), { timeout: 60_000 });
    await waitFor(() => expect(latest.current!.ctx.branch.executing).toBe(false));
    await waitFor(() => expect(latest.current!.ctx.branch.simState?.p2ForceSwitch).toBe(true), { timeout: 30_000 });
    expect(latest.current!.ctx.newGame.record!.turns).toBe(0);
    expect(latest.current!.board.timeline.viewTurn).toBe(viewBefore);
    expectNoVariationChrome();
    // picking the replacement joins the turn to the main line, as before the reload
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
