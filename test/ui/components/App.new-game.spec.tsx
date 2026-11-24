import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { replayData } from '../fixtures/replay';
import { stubReplayFetch } from '../fixtures/network';
import { realReplayWorkerClient } from '../fixtures/worker';
import { deleteGame, listGames, loadGame, saveGame } from '../../../src/lib/new-game/store';
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

describe('a new game in the app', () => {
  test('Start on the start page opens the game: the title row names it, the lead picker offers both teams, the game is saved', async () => {
    render(<App />);
    await startOnLanding();
    await waitFor(() => expect(document.querySelector('.ps-topbar')).not.toBeNull(), { timeout: 30_000 });
    expect(listGames()).toHaveLength(1);
    expect(listGames()[0].players).toEqual(['Alice', 'Bob']);
    await waitFor(() => expect(window.location.search).toBe(`?game=${listGames()[0].id}`));
    expect(screen.queryByRole('dialog', { name: 'New game' })).toBeNull();
    const bar = document.querySelector('.ps-topbar') as HTMLElement;
    expect(within(bar).getByText('New game')).toHaveClass('ps-newgame-tag');
    expect(within(bar).getByText('[Gen 9] OU')).toBeInTheDocument();
    expect(within(bar).getByText('Alice')).toBeInTheDocument();
    expect(within(bar).getByText('Bob')).toBeInTheDocument();
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

  test('a start with ?game=<id> of a game with one played turn opens it on its tip, turn 2, with the dock there', async () => {
    const record = await playedRecord(1);
    window.history.replaceState(null, '', `/?game=${record.id}`);
    render(<App />);
    await waitFor(() => expect(document.querySelector('.ps-topbar')).not.toBeNull(), { timeout: 30_000 });
    await waitFor(() => expect(document.body.textContent).toMatch(/T2\/2/), { timeout: 30_000 });
    await waitFor(() => expect(document.querySelector('.ps-dock')).not.toBeNull(), { timeout: 30_000 });
    await act(async () => {});
  }, 120_000);

  test('a finished game opened again shows its end as the live game did: the winner, no dock to play', async () => {
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

  async function copiedLink() {
    await userEvent.click(screen.getByRole('button', { name: 'Game' }));
    await userEvent.click(within(document.querySelector('.ps-loader-panel') as HTMLElement).getByRole('button', { name: 'Copy Share Link' }));
    const field = (await screen.findByRole('textbox', { name: 'Game share link' })) as HTMLInputElement;
    const read = readShare(field.value.split('#branch=')[1]);
    if (read.kind !== 'game') throw new Error(`the link is a ${read.kind} link`);
    await userEvent.keyboard('{Escape}');
    return read.payload;
  }

  test('a game at Team Preview copies its link: the game, no entry, no branch, the team preview as the view', async () => {
    render(<App />);
    await startOnLanding();
    await waitFor(() => expect(document.querySelector('.ps-topbar')).not.toBeNull(), { timeout: 30_000 });
    const link = await copiedLink();
    expect(link).toMatchObject({ gameId: listGames()[0].id, entries: [], format: 'gen9ou', view: { t0: true, line: 'main' } });
    expect(link.variation).toBeUndefined();
    await act(async () => {});
  }, 90_000);

  test('a game with played turns copies its link on the main line and at the tip: every entry, no branch, the turn on screen', async () => {
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

  test('a finished game copies its link at the end', async () => {
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

  test('a game link (version 2) of a game this browser lacks opens it as a copy on its tip, the hash goes and the address names the copy', async () => {
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

  test('a link whose game equals a saved game opens that game and makes no copy; the same link opened again makes none either', async () => {
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

  test('a foreign link opened twice makes one copy, and the saved games of the browser stay', async () => {
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

  test('a link whose main line goes past the saved game makes a copy', async () => {
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

  test('a game link with an open branch restores the branch from the game and puts the pointer where the sharer stood', async () => {
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

  test('a game link the reader cannot start says why on the start page and leaves the hash', async () => {
    const played = await playedRecord(0);
    window.location.hash = `#branch=${encodeBranchShare({ ...makeGameSharePayload({ record: played }), teams: { p1: '', p2: '' } })}`;
    render(<App />);
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Unable to open the shared game: This game link holds no team for Alice.'), { timeout: 30_000 });
    expect(window.location.hash).toBe('');
    expect(document.querySelector('.ps-topbar')).toBeNull();
    expect(screen.getByText('Load Replay')).toBeInTheDocument();
  }, 60_000);

  test('a link of a newer version names its version on the start page', async () => {
    window.location.hash = `#branch=${encodeShareJson({ version: 3, kind: 'game' })}`;
    render(<App />);
    expect(screen.getByRole('alert')).toHaveTextContent('This share link comes from a newer PS Dashboard (link version 3).');
    expect(screen.getByText('Load Replay')).toBeInTheDocument();
  });

  test('a version 1 link of a replay branch opens its read-only view with Load Original Replay; one that names a game offers New Replay only', async () => {
    const branch = {
      version: 1 as const, replayId: 'gen9ou-test-123', format: '[Gen 9] OU', formatid: 'gen9ou', players: ['Alice', 'Bob'] as [string, string], branchTurn: 2,
      createdAt: '2026-04-29T08:00:00.000Z', choices: [{ turnNumber: 2, p1Choice: 'move 1', p2Choice: 'move 2' }],
      finalLog: '|player|p1|Alice|\n|player|p2|Bob|\n|turn|1\n|turn|2',
    };
    window.location.hash = `#branch=${encodeBranchShare(branch)}`;
    const { unmount } = render(<App />);
    expect(screen.getByText('Shared Branch', { exact: true })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Load Original Replay' })).toBeInTheDocument();
    unmount();
    window.location.hash = `#branch=${encodeBranchShare({ ...branch, replayId: 'newgame-m7nj3hx23e' })}`;
    render(<App />);
    expect(screen.getByText('Shared Branch', { exact: true })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New Replay' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Load Original Replay' })).toBeNull();
  });

  test('a damaged game link says so on the start page and leaves no hash', () => {
    window.location.hash = `#branch=${encodeShareJson({ version: 2, kind: 'game' })}`;
    render(<App />);
    expect(screen.getByRole('alert')).toHaveTextContent('invalid or damaged');
    expect(window.location.hash).toBe('');
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

/** The panel's own submit button is named "Load" as well, so the toggle is found by its class. */
const toggle = () => document.querySelector('.ps-loader-toggle') as HTMLElement;

describe('the replay loader in the app', () => {
  test('the start page shows the loader in the column; a loaded replay moves it to the Load button, and a load from there works', async () => {
    const first = replayData('singles');
    const second = { ...replayData('doubles'), id: 'gen9doubles-second' };
    stubReplayFetch([first, second]);
    render(<App />);

    expect(screen.getByText('Load Replay')).toBeInTheDocument();
    expect(screen.getByLabelText('Unified timeline workflow')).toBeInTheDocument();
    expect(document.querySelector('.ps-topbar')).toBeNull();
    const input = screen.getByRole('textbox', { name: 'Replay URL or ID' });
    await userEvent.clear(input);
    await userEvent.type(input, `${first.id}{Enter}`);

    await waitFor(() => expect(document.querySelector('.ps-topbar')).not.toBeNull(), { timeout: 30_000 });
    expect(screen.queryByText('Load Replay')).toBeNull();
    expect(screen.queryByRole('textbox', { name: 'Replay URL or ID' })).toBeNull();
    const load = screen.getByRole('button', { name: 'Game' });
    expect(load.closest('.ps-topbar-actions')).not.toBeNull();
    await userEvent.click(load);
    const reopened = screen.getByRole('textbox', { name: 'Replay URL or ID' });
    expect((reopened as HTMLInputElement).value).toContain(first.id);

    await userEvent.clear(reopened);
    await userEvent.type(reopened, `${second.id}{Enter}`);
    await waitFor(() => expect(toggle()).toHaveAttribute('aria-expanded', 'false'), { timeout: 30_000 });
    await act(async () => {});
    expect(screen.queryByRole('textbox', { name: 'Replay URL or ID' })).toBeNull();
    await userEvent.click(toggle());
    expect((screen.getByRole('textbox', { name: 'Replay URL or ID' }) as HTMLInputElement).value).toContain(second.id);
  });

  test('Load with the Smogon hosts down names both notices in the top bar', async () => {
    // The VGC fixture: the Smogon modules cache an earlier answer per format and species, and no other row loads it.
    const replay = replayData('vgc');
    const fetchMock = stubReplayFetch([replay]);
    const served = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (input, init) => (String(input).includes('replay.pokemonshowdown.com')
      ? served(input, init)
      : Promise.reject(new TypeError('Failed to fetch'))));
    render(<App />);
    const input = screen.getByRole('textbox', { name: 'Replay URL or ID' });
    await userEvent.clear(input);
    await userEvent.type(input, `${replay.id}{Enter}`);
    await screen.findByText('Smogon sets unavailable', undefined, { timeout: 30_000 });
    expect(await screen.findByText('Smogon stats unavailable', undefined, { timeout: 30_000 })).toBeInTheDocument();
  }, 90_000);
});

/** Text and state of the app's own markup: no replay iframe, so they run here. */
describe('the start page and the Load panel', () => {
  test('the start page: one header with Beta, Report issue and the creator link; the featured draft link and a Load button; the three guide steps; the team paste', async () => {
    render(<App />);
    const header = document.querySelector('.ps-app-header') as HTMLElement;
    expect(document.querySelectorAll('h1')).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('PS Dashboard');
    expect(header).toHaveTextContent('Beta');
    expect(within(header).getByRole('button', { name: 'Report issue' })).toBeInTheDocument();
    expect(within(header).getByRole('link', { name: 'by Bene (FullLifeGames)' })).toHaveAttribute('href', 'https://fulllifegames.com');

    const input = screen.getByRole('textbox', { name: 'Replay URL or ID' });
    expect(input).toHaveValue('https://replay.pokemonshowdown.com/gen9draft-2058494320');
    expect(screen.getByRole('button', { name: 'Load', exact: true })).toBeInTheDocument();
    const guide = screen.getByLabelText('Unified timeline workflow');
    for (const step of ['Find the decision point', 'Play a different move', 'Compare the lines']) expect(within(guide).getByText(step)).toBeInTheDocument();

    const details = document.querySelector('details') as HTMLElement;
    await userEvent.click(within(details).getByText(/Paste your team/));
    expect(details).toHaveAttribute('open');
    expect(within(details).getByRole('textbox')).toBeVisible();
    expect(within(details).getByRole('button', { name: 'Save Team' })).toBeInTheDocument();
  });

  test('with a replay loaded the loader input holds its canonical link, the top bar carries the support links, and the Load panel closes on Escape and on a click on the match', async () => {
    const replay = replayData('singles');
    stubReplayFetch([replay]);
    render(<App />);
    await userEvent.clear(screen.getByRole('textbox', { name: 'Replay URL or ID' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Replay URL or ID' }), `${replay.id}{Enter}`);
    await waitFor(() => expect(document.querySelector('.ps-topbar')).not.toBeNull(), { timeout: 30_000 });
    expect(document.querySelector('.ps-app-header')).toBeNull();
    const links = document.querySelector('.ps-topbar .ps-support-links') as HTMLElement;
    expect(links).toHaveTextContent('PS Dashboard');
    expect(links).toHaveTextContent('Beta');
    expect(within(links).getByRole('button', { name: 'Report issue' })).toBeInTheDocument();
    expect(within(links).getByRole('link', { name: 'by Bene (FullLifeGames)' })).toBeInTheDocument();

    await userEvent.click(toggle());
    const panel = () => document.querySelector('.ps-loader-panel') as HTMLElement | null;
    expect(screen.getByRole('textbox', { name: 'Replay URL or ID' })).toHaveValue(`https://replay.pokemonshowdown.com/${replay.id}`);
    expect(panel()!.querySelector('input[aria-label="Load exported replay file"]')).not.toBeNull();
    expect(panel()!.querySelector('summary')).not.toBeNull();
    await userEvent.keyboard('{Escape}');
    expect(panel()).toBeNull();
    await userEvent.click(toggle());
    expect(panel()).not.toBeNull();
    await userEvent.click(document.querySelector('.ps-topbar-match') as HTMLElement);
    expect(panel()).toBeNull();
    await act(async () => {});
  }, 60_000);
});

async function openGame(turns: number) {
  const record = await playedRecord(turns);
  window.history.replaceState(null, '', `/?game=${record.id}`);
  render(<App />);
  await waitFor(() => expect(document.querySelector('.ps-topbar')).not.toBeNull(), { timeout: 30_000 });
  return record;
}

/** Setup, Import/Export Sets: every Protect becomes Rest, so the second turn (both sides played Protect) no longer plays. */
async function importWithoutProtect(): Promise<string> {
  await userEvent.click(screen.getByRole('button', { name: 'Setup' }));
  await userEvent.click(screen.getByRole('button', { name: 'Import/Export Sets' }));
  const dialog = await screen.findByRole('dialog', { name: 'Import / Export Sets' }, { timeout: 60_000 });
  const field = dialog.querySelector('textarea') as HTMLTextAreaElement;
  const typed = field.value.replace(/- Protect/g, '- Rest');
  fireEvent.change(field, { target: { value: typed } });
  await userEvent.click(within(dialog).getByRole('button', { name: 'Import' }));
  return typed;
}

/** The hook specs (`useGameTeamEdit.spec.tsx`, `useNewGame.spec.tsx`) hold the question for singles and doubles; these rows run it through the app. */
describe('a team edit that cuts played turns asks first', () => {
  beforeEach(() => { stubReplayFetch([]); });

  test('Cancel leaves the game and its saved record as they were; Apply edit cuts it and says where the line ends', async () => {
    const record = await openGame(3);
    expect(record.turns).toBe(3);
    const typed = await importWithoutProtect();
    const question = await screen.findByRole('alertdialog', undefined, { timeout: 120_000 });
    expect(question).toHaveTextContent(/This edit makes \d+ played turns? invalid\./);
    expect(question).toHaveTextContent('the game keeps its first turn');
    expect(screen.queryByRole('dialog', { name: 'Import / Export Sets' })).toBeNull();
    expect(loadGame(record.id)!.turns).toBe(3);
    await userEvent.click(within(question).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(loadGame(record.id)!.turns).toBe(3);
    expect(listGames()[0].turns).toBe(3);
    expect(loadGame(record.id)!.teams).toEqual(record.teams);
    const back = screen.getByRole('dialog', { name: 'Import / Export Sets' });
    expect((back.querySelector('textarea') as HTMLTextAreaElement).value).toBe(typed);
    await userEvent.click(within(back).getByRole('button', { name: 'Import' }));
    const again = await screen.findByRole('alertdialog', undefined, { timeout: 120_000 });
    await userEvent.click(within(again).getByRole('button', { name: 'Apply edit' }));
    await waitFor(() => expect(loadGame(record.id)!.turns).toBe(1), { timeout: 120_000 });
    expect(screen.queryByRole('dialog', { name: 'Import / Export Sets' })).toBeNull();
    await waitFor(() => expect(screen.getByText(/The edited team cannot play every turn\. The game keeps its first turn/)).toBeInTheDocument());
  }, 360_000);
});
