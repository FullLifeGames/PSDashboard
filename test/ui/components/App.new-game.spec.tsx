import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { replayData } from '../fixtures/replay';
import { stubReplayFetch } from '../fixtures/network';
import { realReplayWorkerClient } from '../fixtures/worker';
import { listGames } from '../../../src/lib/new-game/store';
import { savedRecord } from '../fixtures/saved-game';
import { playedRecord } from '../fixtures/played-game';

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
    // Start saved the record at once (D-E1): no lead is played yet
    expect(listGames()).toHaveLength(1);
    expect(listGames()[0].players).toEqual(['Alice', 'Bob']);
    // the address names the game (H12a), so a reload brings it back
    expect(window.location.search).toBe(`?game=${listGames()[0].id}`);
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

  test('the Game menu offers New game and the saved games once a game is open, the open game as open now; the dialog holds none; a replay loaded after the game is a replay again', async () => {
    const replay = replayData('singles');
    stubReplayFetch([replay]);
    render(<App />);
    await startOnLanding();
    await waitFor(() => expect(document.querySelector('.ps-topbar')).not.toBeNull(), { timeout: 30_000 });
    await userEvent.click(screen.getByRole('button', { name: 'Game' }));
    expect(screen.getByText('Saved games')).toBeInTheDocument();
    expect(document.querySelector('.ps-loader-panel')).toHaveTextContent('open now');
    await userEvent.click(screen.getByRole('button', { name: 'New game' }));
    const dialog = await screen.findByRole('dialog', { name: 'New game' });
    // the Game panel folded away behind the dialog
    expect(screen.queryByRole('textbox', { name: 'Replay URL or ID' })).toBeNull();
    expect(within(dialog).queryByText('Saved games')).toBeNull();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await userEvent.click(screen.getByRole('button', { name: 'Game' }));
    const input = screen.getByRole('textbox', { name: 'Replay URL or ID' });
    await userEvent.clear(input);
    await userEvent.type(input, `${replay.id}{Enter}`);
    await waitFor(() => expect(within(document.querySelector('.ps-topbar') as HTMLElement).queryByText('New game')).toBeNull(), { timeout: 30_000 });
    await act(async () => {});
  }, 90_000);

  test('the start page names both ways in and lists the saved games under the loader; Open plays the saved game', async () => {
    const record = await savedRecord(['Ann', 'Ben'], 0, '9,9,9,9');
    render(<App />);
    expect(screen.getByText('Load a replay or start a new game · branch off with different moves')).toBeInTheDocument();
    expect(screen.getByText('Load Replay')).toBeInTheDocument();
    const panel = document.querySelector('.ps-entry-landing') as HTMLElement;
    expect(within(panel).getByRole('button', { name: 'New game' })).toBeInTheDocument();
    expect(within(panel).getByText('Saved games')).toBeInTheDocument();
    expect(panel.querySelectorAll('.ps-newgame-saved-row')).toHaveLength(1);
    expect(panel).toHaveTextContent('Seed 9,9,9,9');
    await userEvent.click(within(panel).getByRole('button', { name: 'Open' }));
    await waitFor(() => expect(document.querySelector('.ps-topbar')).not.toBeNull(), { timeout: 30_000 });
    const bar = document.querySelector('.ps-topbar') as HTMLElement;
    expect(within(bar).getByText('New game')).toHaveClass('ps-newgame-tag');
    expect(within(bar).getByText('Ann')).toBeInTheDocument();
    expect(listGames()[0].id).toBe(record.id);
    await act(async () => {});
  }, 90_000);

  test('a start page with no saved game shows the New game button and no Saved games part', () => {
    render(<App />);
    const panel = document.querySelector('.ps-entry-landing') as HTMLElement;
    expect(within(panel).getByRole('button', { name: 'New game' })).toBeInTheDocument();
    expect(within(panel).queryByText('Saved games')).toBeNull();
  });

  test('a start with ?game=<id> of a saved game opens it without a click, and the address keeps naming it', async () => {
    const record = await savedRecord(['Ann', 'Ben'], 0, '9,9,9,9');
    window.history.replaceState(null, '', `/?game=${record.id}`);
    render(<App />);
    await waitFor(() => expect(document.querySelector('.ps-topbar')).not.toBeNull(), { timeout: 30_000 });
    const bar = document.querySelector('.ps-topbar') as HTMLElement;
    expect(within(bar).getByText('New game')).toHaveClass('ps-newgame-tag');
    expect(within(bar).getByText('Ann')).toBeInTheDocument();
    expect(window.location.search).toBe(`?game=${record.id}`);
    await act(async () => {});
  }, 90_000);

  test('a start with ?game=<id> of a game with one played turn opens it on its tip, turn 2, with the dock there (H4e)', async () => {
    const record = await playedRecord(1);
    window.history.replaceState(null, '', `/?game=${record.id}`);
    render(<App />);
    await waitFor(() => expect(document.querySelector('.ps-topbar')).not.toBeNull(), { timeout: 30_000 });
    await waitFor(() => expect(document.body.textContent).toMatch(/T2\/2/), { timeout: 30_000 });
    await waitFor(() => expect(document.querySelector('.ps-dock')).not.toBeNull(), { timeout: 30_000 });
    await act(async () => {});
  }, 120_000);

  test('a ?game= this browser does not hold shows the start page with the notice and the saved games', async () => {
    await savedRecord(['Ann', 'Ben'], 0, '9,9,9,9');
    window.history.replaceState(null, '', '/?game=newgame-k3x9q0m2ab');
    render(<App />);
    expect(screen.getByRole('alert')).toHaveTextContent('The game newgame-k3x9q0m2ab is not saved in this browser. A share link of the game (Copy Share Link) brings it along.');
    expect(screen.getByText('Load Replay')).toBeInTheDocument();
    expect(document.querySelectorAll('.ps-entry-landing .ps-newgame-saved-row')).toHaveLength(1);
    expect(document.querySelector('.ps-topbar')).toBeNull();
  });

  test('a replay loaded by id writes ?replay=<id>; a ?replay= link still loads and stays as written', async () => {
    const replay = replayData('singles');
    stubReplayFetch([replay]);
    render(<App />);
    const input = screen.getByRole('textbox', { name: 'Replay URL or ID' });
    await userEvent.clear(input);
    await userEvent.type(input, `${replay.id}{Enter}`);
    await waitFor(() => expect(document.querySelector('.ps-topbar')).not.toBeNull(), { timeout: 30_000 });
    expect(new URLSearchParams(window.location.search).get('replay')).toBe(replay.id);
    await act(async () => {});
  }, 90_000);

  test('an old ?replay= link loads its replay and the address stays as the link wrote it', async () => {
    const replay = replayData('singles');
    stubReplayFetch([replay]);
    const written = `https://replay.pokemonshowdown.com/${replay.id}`;
    window.history.replaceState(null, '', `/?replay=${written}`);
    render(<App />);
    await waitFor(() => expect(document.querySelector('.ps-topbar')).not.toBeNull(), { timeout: 30_000 });
    expect(window.location.search).toBe(`?replay=${written}`);
    await act(async () => {});
  }, 90_000);
});
