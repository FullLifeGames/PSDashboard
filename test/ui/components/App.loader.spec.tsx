import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { replayData } from '../fixtures/replay';
import { stubReplayFetch } from '../fixtures/network';
import { realReplayWorkerClient } from '../fixtures/worker';

const worker = vi.hoisted(() => ({ current: null as null | ReturnType<typeof import('../fixtures/worker').realReplayWorkerClient> }));
vi.mock('../../../src/hooks/useReplayWorker', () => ({ useReplayWorker: () => worker.current!.client }));
vi.mock('../../../src/lib/pokemon-options', async importOriginal => ({ ...(await importOriginal<typeof import('../../../src/lib/pokemon-options')>()), getMovePool: async () => ['Dragon Claw'] }));

/** The panel's own submit button is named "Load" as well, so the toggle is found by its class. */
const toggle = () => document.querySelector('.ps-loader-toggle') as HTMLElement;

const { default: App } = await import('../../../src/App');

beforeEach(() => {
  worker.current = realReplayWorkerClient();
  window.history.replaceState(null, '', '/');
  let counter = 0;
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => `blob:test/${++counter}`), revokeObjectURL: vi.fn() }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * Round 84 (turn dock, user answer Q20 a, 02.11.2026): the start page keeps the loader in the column; once a replay is loaded the
 * column holds none, the Load button in the top bar opens it, a load from there replaces the replay, and the panel closes.
 */
describe('the replay loader in the app', () => {
  test('the start page shows the loader in the column; a loaded replay moves it to the Load button, and a load from there works', async () => {
    const first = replayData('singles');
    const second = { ...replayData('doubles'), id: 'gen9doubles-second' };
    stubReplayFetch([first, second]);
    render(<App />);

    // The start page: the loader panel with its title, the workflow guide, no Load button in a top bar.
    expect(screen.getByText('Load Replay')).toBeInTheDocument();
    expect(screen.getByLabelText('Unified timeline workflow')).toBeInTheDocument();
    expect(document.querySelector('.ps-topbar')).toBeNull();
    const input = screen.getByRole('textbox', { name: 'Replay URL or ID' });
    await userEvent.clear(input);
    await userEvent.type(input, `${first.id}{Enter}`);

    await waitFor(() => expect(document.querySelector('.ps-topbar')).not.toBeNull(), { timeout: 30_000 });
    // The workspace: no loader in the column, the button opens it with the loaded link.
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
});

/**
 * Round 90 (E5, #222, #191 item 3): the start page and the Load panel, as the browser rows of `loader` and `support` read them. The
 * checks are text and state of the app's own markup; they need no replay iframe, so they run here.
 */
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
