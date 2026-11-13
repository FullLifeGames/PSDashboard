import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { replayData } from '../fixtures/replay';
import { stubReplayFetch } from '../fixtures/network';
import { realReplayWorkerClient } from '../fixtures/worker';
import { deleteGame, listGames, saveGame } from '../../../src/lib/new-game/store';
import { savedRecord } from '../fixtures/saved-game';
import { playedRecord } from '../fixtures/played-game';
import { encodeBranchShare, encodeShareJson, readShare } from '../../../src/lib/branch-share';
import { makeGameSharePayload, shareEntry } from '../../../src/lib/new-game/share';

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

  test('a finished game opened again shows its end as the live game did: the winner, no dock to play (H4h)', async () => {
    const played = await playedRecord(1);
    // the last turn ends with the win instead of the next `|turn|` line: the game's end snapshot is its tip
    const finished = { ...played, body: [...played.body.slice(0, played.body.findLastIndex(line => line.startsWith('|turn|'))), '|', '|win|Alice'] };
    saveGame(finished);
    window.history.replaceState(null, '', `/?game=${finished.id}`);
    render(<App />);
    await waitFor(() => expect(document.querySelector('.ps-topbar')).not.toBeNull(), { timeout: 30_000 });
    await waitFor(() => expect(document.querySelector('.ps-dock')).not.toBeNull(), { timeout: 30_000 });
    await waitFor(() => expect(document.querySelector('.ps-dock')).toHaveTextContent('Alice won the game. Go back a turn to play it another way.'), { timeout: 30_000 });
    expect(screen.queryByRole('button', { name: /Select P1|Execute/ })).toBeNull();
    expect(document.querySelector('.ps-dock-chip')).toBeNull();
    await act(async () => {});
  }, 120_000);

  // Round 89 (#105, H7, finding 1): the Game menu copies the link of a game wherever it stands, with no variation open.
  async function copiedLink() {
    await userEvent.click(screen.getByRole('button', { name: 'Game' }));
    await userEvent.click(within(document.querySelector('.ps-loader-panel') as HTMLElement).getByRole('button', { name: 'Copy Share Link' }));
    const field = (await screen.findByRole('textbox', { name: 'Game share link' })) as HTMLInputElement;
    const read = readShare(field.value.split('#branch=')[1]);
    if (read.kind !== 'game') throw new Error(`the link is a ${read.kind} link`);
    await userEvent.keyboard('{Escape}');
    return read.payload;
  }

  test('a game at Team Preview copies its link: the game, no entry, no branch, the team preview as the view (H7)', async () => {
    render(<App />);
    await startOnLanding();
    await waitFor(() => expect(document.querySelector('.ps-topbar')).not.toBeNull(), { timeout: 30_000 });
    const link = await copiedLink();
    expect(link).toMatchObject({ gameId: listGames()[0].id, entries: [], format: 'gen9ou', view: { t0: true, line: 'main' } });
    expect(link.variation).toBeUndefined();
    await act(async () => {});
  }, 90_000);

  test('a game with played turns copies its link on the main line and at the tip: every entry, no branch, the turn on screen (H7)', async () => {
    const record = await playedRecord(2);
    window.history.replaceState(null, '', `/?game=${record.id}`);
    render(<App />);
    await waitFor(() => expect(document.body.textContent).toMatch(/T3\/3/), { timeout: 60_000 });
    const tip = await copiedLink();
    expect(tip).toMatchObject({ gameId: record.id, view: { turn: 3, line: 'main' } });
    expect(tip.entries).toHaveLength(record.entries.length);
    expect(tip.variation).toBeUndefined();
    await userEvent.click(screen.getByRole('button', { name: '◀' }));
    await waitFor(() => expect(document.body.textContent).toMatch(/T2\/3/));
    const back = await copiedLink();
    expect(back).toMatchObject({ view: { turn: 2, line: 'main' } });
    expect(back.entries).toHaveLength(record.entries.length);
    expect(back.variation).toBeUndefined();
    await act(async () => {});
  }, 150_000);

  test('a finished game copies its link at the end (H7)', async () => {
    const played = await playedRecord(1);
    const finished = { ...played, body: [...played.body.slice(0, played.body.findLastIndex(line => line.startsWith('|turn|'))), '|', '|win|Alice'] };
    saveGame(finished);
    window.history.replaceState(null, '', `/?game=${finished.id}`);
    render(<App />);
    await waitFor(() => expect(document.querySelector('.ps-dock')).toHaveTextContent('Alice won the game'), { timeout: 60_000 });
    const link = await copiedLink();
    expect(link).toMatchObject({ gameId: finished.id, view: { line: 'main' } });
    expect(link.entries).toHaveLength(finished.entries.length);
    expect(link.variation).toBeUndefined();
    await act(async () => {});
  }, 150_000);

  test('a ?game= this browser does not hold shows the start page with the notice and the saved games', async () => {
    await savedRecord(['Ann', 'Ben'], 0, '9,9,9,9');
    window.history.replaceState(null, '', '/?game=newgame-k3x9q0m2ab');
    render(<App />);
    expect(screen.getByRole('alert')).toHaveTextContent('The game newgame-k3x9q0m2ab is not saved in this browser. A share link of the game (Game menu, Copy Share Link) brings it along.');
    expect(screen.getByText('Load Replay')).toBeInTheDocument();
    expect(document.querySelectorAll('.ps-entry-landing .ps-newgame-saved-row')).toHaveLength(1);
    expect(document.querySelector('.ps-topbar')).toBeNull();
  });

  // Round 89 (#105, H5, ruling 31 H6a): a game's share link opens the game as a copy; the address names the copy.
  test('a game link (version 2) of a game this browser lacks opens it as a copy on its tip, the hash goes and the address names the copy (H5)', async () => {
    const played = await playedRecord(1);
    window.location.hash = `#branch=${encodeBranchShare(makeGameSharePayload({ record: played }))}`;
    // the sharer's game is not in this browser: the link comes from elsewhere
    deleteGame(played.id);
    render(<App />);
    await waitFor(() => expect(document.querySelector('.ps-topbar')).not.toBeNull(), { timeout: 60_000 });
    await waitFor(() => expect(document.body.textContent).toMatch(/T2\/2/), { timeout: 60_000 });
    expect(window.location.hash).toBe('');
    const named = new URLSearchParams(window.location.search).get('game');
    expect(named).toMatch(/^newgame-/);
    expect(named).not.toBe(played.id);
    expect(listGames().map(row => row.id)).toEqual([named]);
    expect(screen.queryByRole('alert')).toBeNull();
    await act(async () => {});
  }, 120_000);

  // Round 89 (#105, H7, finding 4): a second open of the same link finds the game it made before.
  test('a link whose game equals a saved game opens that game and makes no copy; the same link opened again makes none either (H7)', async () => {
    const played = await playedRecord(1);
    const hash = `#branch=${encodeBranchShare(makeGameSharePayload({ record: played }))}`;
    window.location.hash = hash;
    const first = render(<App />);
    await waitFor(() => expect(document.body.textContent).toMatch(/T2\/2/), { timeout: 60_000 });
    expect(listGames().map(row => row.id)).toEqual([played.id]);
    expect(new URLSearchParams(window.location.search).get('game')).toBe(played.id);
    expect(window.location.hash).toBe('');
    first.unmount();
    window.history.replaceState(null, '', '/');
    window.location.hash = hash;
    render(<App />);
    await waitFor(() => expect(document.body.textContent).toMatch(/T2\/2/), { timeout: 60_000 });
    expect(listGames().map(row => row.id)).toEqual([played.id]);
    await act(async () => {});
  }, 180_000);

  test('a foreign link opened twice makes one copy, and the saved games of the browser stay (H7)', async () => {
    const played = await playedRecord(1);
    const other = await savedRecord(['Ann', 'Ben'], 0, '9,9,9,9');
    const hash = `#branch=${encodeBranchShare(makeGameSharePayload({ record: played }))}`;
    deleteGame(played.id);
    window.location.hash = hash;
    const first = render(<App />);
    await waitFor(() => expect(document.body.textContent).toMatch(/T2\/2/), { timeout: 60_000 });
    const copy = new URLSearchParams(window.location.search).get('game');
    expect(copy).toMatch(/^newgame-/);
    first.unmount();
    window.history.replaceState(null, '', '/');
    window.location.hash = hash;
    render(<App />);
    await waitFor(() => expect(document.body.textContent).toMatch(/T2\/2/), { timeout: 60_000 });
    expect(new URLSearchParams(window.location.search).get('game')).toBe(copy);
    expect(listGames().map(row => row.id).sort()).toEqual([copy, other.id].sort());
    await act(async () => {});
  }, 240_000);

  test('a link whose main line goes past the saved game makes a copy (H7)', async () => {
    const played = await playedRecord(2);
    const hash = `#branch=${encodeBranchShare(makeGameSharePayload({ record: played }))}`;
    deleteGame(played.id);
    saveGame({ ...played, entries: played.entries.slice(0, 2), turns: 1 });
    window.location.hash = hash;
    render(<App />);
    await waitFor(() => expect(document.body.textContent).toMatch(/T3\/3/), { timeout: 60_000 });
    expect(listGames()).toHaveLength(2);
    expect(listGames().find(row => row.id !== played.id)?.turns).toBe(2);
    await act(async () => {});
  }, 240_000);

  test('a game link with an open branch restores the branch from the game and puts the pointer where the sharer stood (H5)', async () => {
    const played = await playedRecord(2);
    // the main line holds the lead and turn 1; the sharer's branch replays turn 2 from turn 1 and he stands on its tip
    const main = { ...played, entries: played.entries.slice(0, 2), turns: 1 };
    const payload = makeGameSharePayload({
      record: main, variation: { startTurn: 1, history: played.entries.slice(2) }, view: { turn: 2, line: 'variation' },
    });
    expect(payload.variation?.entries).toEqual(played.entries.slice(2).map(shareEntry));
    window.location.hash = `#branch=${encodeBranchShare(payload)}`;
    render(<App />);
    await waitFor(() => expect(document.querySelector('.ps-topbar')).not.toBeNull(), { timeout: 60_000 });
    await waitFor(() => expect(document.body.textContent).toMatch(/Variation moves/), { timeout: 90_000 });
    expect(document.body.textContent).toMatch(/Turn 1/);
    expect(window.location.hash).toBe('');
    expect(screen.queryByRole('alert')).toBeNull();
    await act(async () => {});
  }, 150_000);

  test('a game link the reader cannot start says why on the start page and leaves the hash (H5)', async () => {
    const played = await playedRecord(0);
    window.location.hash = `#branch=${encodeBranchShare({ ...makeGameSharePayload({ record: played }), teams: { p1: '', p2: '' } })}`;
    render(<App />);
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Unable to open the shared game: This game link holds no team for Alice.'), { timeout: 30_000 });
    expect(window.location.hash).toBe('');
    expect(document.querySelector('.ps-topbar')).toBeNull();
    expect(screen.getByText('Load Replay')).toBeInTheDocument();
  }, 60_000);

  test('a link of a newer version names its version on the start page (H5)', async () => {
    window.location.hash = `#branch=${encodeShareJson({ version: 3, kind: 'game' })}`;
    render(<App />);
    expect(screen.getByRole('alert')).toHaveTextContent('This share link comes from a newer PS Dashboard (link version 3).');
    expect(screen.getByText('Load Replay')).toBeInTheDocument();
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
