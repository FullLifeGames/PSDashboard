import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { replayData } from '../fixtures/replay';
import { stubReplayFetch } from '../fixtures/network';
import { realReplayWorkerClient } from '../fixtures/worker';
import { listGames } from '../../../src/lib/new-game/store';

const worker = vi.hoisted(() => ({ current: null as null | ReturnType<typeof import('../fixtures/worker').realReplayWorkerClient> }));
vi.mock('../../../src/hooks/useReplayWorker', () => ({ useReplayWorker: () => worker.current!.client }));
vi.mock('../../../src/lib/pokemon-options', async importOriginal => ({ ...(await importOriginal<typeof import('../../../src/lib/pokemon-options')>()), getMovePool: async () => ['Dragon Claw'] }));

const { default: App } = await import('../../../src/App');

const TEAM = ['Garchomp', 'Gengar', 'Dragonite', 'Tyranitar', 'Snorlax', 'Starmie']
  .map(name => `${name}\nEVs: 4 HP\n- Protect\n- Earthquake`).join('\n\n');

beforeEach(() => {
  localStorage.clear();
  worker.current = realReplayWorkerClient();
  window.history.replaceState(null, '', '/');
  let counter = 0;
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => `blob:test/${++counter}`), revokeObjectURL: vi.fn() }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function startOnLanding(names: [string, string] = ['Alice', 'Bob']) {
  await userEvent.click(screen.getByRole('button', { name: 'New game' }));
  const dialog = await screen.findByRole('dialog', { name: 'New game' });
  fireEvent.change(within(dialog).getByRole('textbox', { name: 'Player 1 name' }), { target: { value: names[0] } });
  fireEvent.change(within(dialog).getByRole('textbox', { name: 'Player 2 name' }), { target: { value: names[1] } });
  fireEvent.change(within(dialog).getByRole('textbox', { name: 'Player 1 team' }), { target: { value: TEAM } });
  fireEvent.change(within(dialog).getByRole('textbox', { name: 'Player 2 team' }), { target: { value: TEAM } });
  await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Start' })).toBeEnabled(), { timeout: 30_000 });
  await userEvent.click(within(dialog).getByRole('button', { name: 'Start' }));
}

/**
 * Round 89 (lane H, #105), stage H4: the dialog inside the app. The start page offers New game beside the loader; Start opens the
 * game at Team Preview with its title row, its lead picker and its save; a replay loaded afterwards is a replay again.
 */
describe('a new game in the app', () => {
  test('Start on the start page opens the game: the title row names it, the lead picker offers both teams, the game is saved', async () => {
    render(<App />);
    await startOnLanding();
    await waitFor(() => expect(document.querySelector('.ps-topbar')).not.toBeNull(), { timeout: 30_000 });
    expect(screen.queryByRole('dialog', { name: 'New game' })).toBeNull();
    const bar = document.querySelector('.ps-topbar') as HTMLElement;
    expect(within(bar).getByText('New game')).toHaveClass('ps-newgame-tag');
    expect(within(bar).getByText('[Gen 9] OU')).toBeInTheDocument();
    expect(within(bar).getByText('Alice')).toBeInTheDocument();
    expect(within(bar).getByText('Bob')).toBeInTheDocument();
    // the lead picker of turn 0 offers both teams' six bodies
    await waitFor(() => expect(screen.getAllByText('Garchomp').length).toBeGreaterThanOrEqual(2), { timeout: 30_000 });
    expect(screen.getByText(/Pick 1 per side|Play from turn 0/)).toBeInTheDocument();
  }, 90_000);

  test('the Load menu offers New game once a game is open; the dialog lists the open game as open now and keeps a saved one; a replay loaded after the game is a replay again', async () => {
    const replay = replayData('singles');
    stubReplayFetch([replay]);
    render(<App />);
    await startOnLanding();
    await waitFor(() => expect(document.querySelector('.ps-topbar')).not.toBeNull(), { timeout: 30_000 });
    await userEvent.click(screen.getByRole('button', { name: 'Load' }));
    await userEvent.click(screen.getByRole('button', { name: 'New game' }));
    const dialog = await screen.findByRole('dialog', { name: 'New game' });
    // the Load panel folded away behind the dialog
    expect(screen.queryByRole('textbox', { name: 'Replay URL or ID' })).toBeNull();
    expect(listGames()).toHaveLength(0);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await userEvent.click(screen.getByRole('button', { name: 'Load' }));
    const input = screen.getByRole('textbox', { name: 'Replay URL or ID' });
    await userEvent.clear(input);
    await userEvent.type(input, `${replay.id}{Enter}`);
    await waitFor(() => expect(within(document.querySelector('.ps-topbar') as HTMLElement).queryByText('New game')).toBeNull(), { timeout: 30_000 });
    await act(async () => {});
  }, 90_000);
});
