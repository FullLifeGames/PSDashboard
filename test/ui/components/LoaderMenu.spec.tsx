import { describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { savedRecord } from '../fixtures/saved-game';
import { LoaderMenu } from '../../../src/components/LoaderMenu';

type Props = Parameters<typeof LoaderMenu>[0];

function props(overrides: Partial<Props> = {}): Props {
  return { onLoad: vi.fn(), onLoadFile: vi.fn(), onTeamLoad: vi.fn(), loading: false, error: null, ...overrides };
}

const file = (name = 'replay.html') => new File(['<html>x</html>'], name, { type: 'text/html' });
const dropOnPage = (dropped: File) =>
  fireEvent.drop(document.body, { dataTransfer: { files: [dropped], types: ['Files'] } });

/**
 * Round 84 (turn dock, user answer Q20 a, 02.11.2026): with a replay loaded the loader leaves the replay column and folds into a
 * "Load" button beside "Setup" in the top bar. The panel holds what the loader offers on the start page, minus the title and the
 * workflow guide; it closes on Escape, on a click beside it and after a load that succeeded. A failed load keeps it open with the
 * error. An exported .html dropped anywhere on the page loads while the replay is loaded.
 */
describe('LoaderMenu', () => {
  test('a closed menu shows only the button; a click opens the URL form, the file picker and the team paste', async () => {
    render(<LoaderMenu {...props()} />);
    const toggle = screen.getByRole('button', { name: 'Game' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('textbox', { name: 'Replay URL or ID' })).toBeNull();
    expect(screen.queryByLabelText('Load exported replay file')).toBeNull();

    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('textbox', { name: 'Replay URL or ID' })).toBeInTheDocument();
    expect(screen.getByLabelText('Load exported replay file')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Browse file' })).toBeInTheDocument();
    expect(screen.getByText(/Paste your team/)).toBeInTheDocument();
    // The panel has no title of its own and no workflow guide.
    expect(screen.queryByText('Load Replay')).toBeNull();
    expect(screen.queryByLabelText('Unified timeline workflow')).toBeNull();
  });

  test('the URL form in the panel loads what was typed and mirrors the loaded link', async () => {
    const wired = props({ loadedUrl: 'https://replay.pokemonshowdown.com/gen9ou-1' });
    render(<LoaderMenu {...wired} />);
    await userEvent.click(screen.getByRole('button', { name: 'Game' }));
    const input = screen.getByRole('textbox', { name: 'Replay URL or ID' });
    expect(input).toHaveValue('https://replay.pokemonshowdown.com/gen9ou-1');
    await userEvent.clear(input);
    await userEvent.type(input, 'gen9ou-2{Enter}');
    expect(wired.onLoad).toHaveBeenCalledWith('gen9ou-2');
  });

  test('the panel closes on Escape and on a click beside it, and stays open for a click inside', async () => {
    render(<><p>beside</p><LoaderMenu {...props()} /></>);
    const toggle = screen.getByRole('button', { name: 'Game' });
    await userEvent.click(toggle);
    await userEvent.click(screen.getByRole('textbox', { name: 'Replay URL or ID' }));
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await userEvent.keyboard('{Escape}');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('textbox', { name: 'Replay URL or ID' })).toBeNull();

    await userEvent.click(toggle);
    await userEvent.click(screen.getByText('beside'));
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  test('a load that succeeds closes the panel; a load that fails keeps it open with the error', async () => {
    const wired = props();
    const { rerender } = render(<LoaderMenu {...wired} />);
    const toggle = screen.getByRole('button', { name: 'Game' });
    await userEvent.click(toggle);
    rerender(<LoaderMenu {...wired} loading />);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: 'Loading…' })).toBeDisabled();
    rerender(<LoaderMenu {...wired} loadedUrl="https://replay.pokemonshowdown.com/gen9ou-1" />);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    await userEvent.click(toggle);
    rerender(<LoaderMenu {...wired} loading loadedUrl="https://replay.pokemonshowdown.com/gen9ou-1" />);
    rerender(<LoaderMenu {...wired} error="Double-check the replay id" loadedUrl="https://replay.pokemonshowdown.com/gen9ou-1" />);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('alert')).toHaveTextContent('Double-check the replay id');
  });

  test('a picked file loads through the panel', async () => {
    const wired = props();
    render(<LoaderMenu {...wired} />);
    await userEvent.click(screen.getByRole('button', { name: 'Game' }));
    await userEvent.upload(screen.getByLabelText('Load exported replay file'), file('game.log'));
    await waitFor(() => expect(wired.onLoadFile).toHaveBeenCalledWith('<html>x</html>', 'game.log'));
  });

  test('a file dropped anywhere on the page loads; the panel opens to show the progress, and a drop while loading does nothing', async () => {
    const wired = props();
    const { rerender } = render(<LoaderMenu {...wired} />);
    dropOnPage(file());
    await waitFor(() => expect(wired.onLoadFile).toHaveBeenCalledWith('<html>x</html>', 'replay.html'));
    expect(document.querySelector('.ps-loader-toggle')).toHaveAttribute('aria-expanded', 'true');

    rerender(<LoaderMenu {...wired} loading />);
    dropOnPage(file('again.html'));
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(wired.onLoadFile).toHaveBeenCalledTimes(1);
  });

  test('a drag of something other than files is left alone; the page listeners go with the menu', () => {
    const wired = props();
    const { unmount } = render(<LoaderMenu {...wired} />);
    const text = new Event('dragover', { cancelable: true, bubbles: true });
    Object.defineProperty(text, 'dataTransfer', { value: { types: ['text/plain'], files: [] } });
    document.body.dispatchEvent(text);
    expect(text.defaultPrevented).toBe(false);
    const files = new Event('dragover', { cancelable: true, bubbles: true });
    Object.defineProperty(files, 'dataTransfer', { value: { types: ['Files'], files: [] } });
    document.body.dispatchEvent(files);
    expect(files.defaultPrevented).toBe(true);

    unmount();
    dropOnPage(file());
    expect(wired.onLoadFile).not.toHaveBeenCalled();
  });
});

/**
 * Round 89 (lane H, #105), H16a (user ruling 13.11.2026): loading a replay, dropping a file and opening a saved game ask first when an
 * unsaved variation is open: the question stands in the menu's panel, Discard variation goes on, Cancel leaves everything.
 */
describe('LoaderMenu with an unsaved variation open (H16a)', () => {
  test('the URL form asks before it loads; Cancel loads nothing, Discard variation loads once', async () => {
    const wired = props({ unsavedVariation: () => true });
    render(<LoaderMenu {...wired} />);
    await userEvent.click(screen.getByRole('button', { name: 'Game' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Replay URL or ID' }), '{Control>}a{/Control}gen9ou-2{Enter}');
    const question = screen.getByRole('alertdialog');
    expect(question).toHaveTextContent('The open variation is not saved. Loading a replay closes it.');
    expect(wired.onLoad).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(wired.onLoad).not.toHaveBeenCalled();
    await userEvent.type(screen.getByRole('textbox', { name: 'Replay URL or ID' }), '{Enter}');
    await userEvent.click(screen.getByRole('button', { name: 'Discard variation' }));
    expect(wired.onLoad).toHaveBeenCalledTimes(1);
    expect(wired.onLoad).toHaveBeenCalledWith('gen9ou-2');
  });

  test('a file dropped on the page opens the menu with the question and loads only after Discard variation', async () => {
    const wired = props({ unsavedVariation: () => true });
    render(<LoaderMenu {...wired} />);
    dropOnPage(file('mine.html'));
    expect(await screen.findByRole('alertdialog')).toHaveTextContent('Loading a replay closes it.');
    expect(wired.onLoadFile).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Discard variation' }));
    await waitFor(() => expect(wired.onLoadFile).toHaveBeenCalledWith('<html>x</html>', 'mine.html'));
  });

  test('a variation that is saved (or none open) asks nothing', async () => {
    const wired = props({ unsavedVariation: () => false });
    render(<LoaderMenu {...wired} />);
    await userEvent.click(screen.getByRole('button', { name: 'Game' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Replay URL or ID' }), '{Control>}a{/Control}gen9ou-3{Enter}');
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(wired.onLoad).toHaveBeenCalledWith('gen9ou-3');
  });

  test('opening a saved game asks too; the menu stays open until the answer, Discard variation opens the game and closes the menu', async () => {
    await savedRecord(['Ann', 'Ben'], 2);
    const onOpenGame = vi.fn().mockResolvedValue(undefined);
    render(<LoaderMenu {...props({ unsavedVariation: () => true, onNewGame: vi.fn(), onOpenGame, currentGameId: null })} />);
    await userEvent.click(screen.getByRole('button', { name: 'Game' }));
    await userEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Opening a game closes it.');
    expect(onOpenGame).not.toHaveBeenCalled();
    expect(document.querySelector('.ps-loader-panel')).not.toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Discard variation' }));
    await waitFor(() => expect(onOpenGame).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(document.querySelector('.ps-loader-panel')).toBeNull());
  }, 60_000);
});
