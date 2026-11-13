import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { realReplayWorkerClient } from '../fixtures/worker';
import { listGames, loadGame } from '../../../src/lib/new-game/store';
import { playedRecord } from '../fixtures/played-game';

const worker = vi.hoisted(() => ({ current: null as null | ReturnType<typeof import('../fixtures/worker').realReplayWorkerClient> }));
vi.mock('../../../src/hooks/useReplayWorker', () => ({ useReplayWorker: () => worker.current!.client }));
vi.mock('../../../src/lib/pokemon-options', async importOriginal => ({ ...(await importOriginal<typeof import('../../../src/lib/pokemon-options')>()), getMovePool: async () => ['Dragon Claw'] }));

const { default: App } = await import('../../../src/App');

beforeEach(() => {
  localStorage.clear();
  worker.current = realReplayWorkerClient();
  window.history.replaceState(null, '', '/');
  let counter = 0;
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => `blob:test/${++counter}`), revokeObjectURL: vi.fn() }));
});
afterEach(() => { vi.unstubAllGlobals(); });

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

/**
 * Round 89 (lane H, #105), H14a (user ruling 13.11.2026): a team change that makes played turns invalid asks before it cuts. The hook
 * specs (`useGameTeamEdit.spec.tsx`, `useNewGame.spec.tsx`) hold the question for singles and doubles; these rows run it through the app.
 */
describe('a team edit that cuts played turns asks first (H14a)', () => {
  test('Cancel leaves the game and its saved record as they were; Apply edit cuts it and says where the line ends', async () => {
    const record = await openGame(3);
    expect(record.turns).toBe(3);
    const typed = await importWithoutProtect();
    const question = await screen.findByRole('alertdialog', undefined, { timeout: 120_000 });
    expect(question).toHaveTextContent(/This edit makes \d+ played turns? invalid\./);
    expect(question).toHaveTextContent('the game keeps its first turn');
    // the panel waits under the question, out of sight
    expect(screen.queryByRole('dialog', { name: 'Import / Export Sets' })).toBeNull();
    // nothing is cut before the answer
    expect(loadGame(record.id)!.turns).toBe(3);
    await userEvent.click(within(question).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(loadGame(record.id)!.turns).toBe(3);
    expect(listGames()[0].turns).toBe(3);
    expect(loadGame(record.id)!.teams).toEqual(record.teams);
    // Cancel returns to the open panel with the text as typed (user, 13.11.2026), and Import asks again
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
