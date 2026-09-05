import { describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReplayLoader } from '../../src/components/ReplayLoader';

type Props = Parameters<typeof ReplayLoader>[0];

function props(overrides: Partial<Props> = {}): Props {
  return { onLoad: vi.fn(), onLoadFile: vi.fn(), onTeamLoad: vi.fn(), loading: false, error: null, ...overrides };
}

const EXPORT = 'Garchomp @ Loaded Dice\nAbility: Rough Skin\nEVs: 252 Atk / 4 SpD / 252 Spe\nJolly Nature\n- Earthquake';

describe('ReplayLoader', () => {
  test('the URL form loads what was typed; a loading state disables it and mirrors the loaded link back', async () => {
    const wired = props();
    const { rerender } = render(<ReplayLoader {...wired} />);
    const input = screen.getByRole('textbox', { name: 'Replay URL or ID' });
    expect(input).toHaveValue('https://replay.pokemonshowdown.com/gen9draft-2058494320');
    await userEvent.clear(input);
    await userEvent.type(input, 'gen9ou-1{Enter}');
    expect(wired.onLoad).toHaveBeenCalledWith('gen9ou-1');

    rerender(<ReplayLoader {...wired} loading />);
    expect(screen.getByRole('button', { name: 'Loading…' })).toBeDisabled();
    rerender(<ReplayLoader {...wired} loadedUrl="https://replay.pokemonshowdown.com/gen9ou-1?p2" />);
    expect(input).toHaveValue('https://replay.pokemonshowdown.com/gen9ou-1?p2');
  });

  test('a picked or dropped file arrives as text with its name; nothing loads while busy', async () => {
    const wired = props();
    const { rerender } = render(<ReplayLoader {...wired} />);
    const file = new File(['|player|p1|Alice|\n|turn|1'], 'game.log', { type: 'text/plain' });
    await userEvent.upload(screen.getByLabelText('Load exported replay file'), file);
    await waitFor(() => expect(wired.onLoadFile).toHaveBeenCalledWith('|player|p1|Alice|\n|turn|1', 'game.log'));

    const dropped = new File(['<html>x</html>'], 'replay.html', { type: 'text/html' });
    fireEvent.drop(screen.getByText('Load Replay').parentElement!, { dataTransfer: { files: [dropped], types: ['Files'] } });
    await waitFor(() => expect(wired.onLoadFile).toHaveBeenCalledWith('<html>x</html>', 'replay.html'));

    rerender(<ReplayLoader {...wired} loading />);
    fireEvent.drop(screen.getByText('Load Replay').parentElement!, { dataTransfer: { files: [dropped], types: ['Files'] } });
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(wired.onLoadFile).toHaveBeenCalledTimes(2);
  });

  test('errors, the team status, and the workflow guide render on demand', () => {
    render(<ReplayLoader {...props({ error: 'Double-check the replay id', teamStatus: 'Team loaded (2 Pokémon)', teamError: 'None match', showGuide: true })} />);
    const alerts = screen.getAllByRole('alert');
    expect(alerts[0]).toHaveTextContent('Double-check the replay id');
    expect(alerts[1]).toHaveTextContent('None match');
    expect(screen.getByText('Team loaded (2 Pokémon)')).toBeInTheDocument();
    expect(screen.getByLabelText('Unified timeline workflow')).toHaveTextContent('Find the decision point');
    expect(screen.queryByText('Loading…')).toBeNull();
  });

  test('the team paste saves through the button and through Ctrl+Enter', async () => {
    const wired = props();
    render(<ReplayLoader {...wired} />);
    const area = screen.getByPlaceholderText(/Paste PS team export/);
    await userEvent.type(area, EXPORT);
    await userEvent.click(screen.getByRole('button', { name: 'Save Team' }));
    expect(wired.onTeamLoad).toHaveBeenCalledTimes(1);
    expect((wired.onTeamLoad as ReturnType<typeof vi.fn>).mock.calls[0][0]).toContain('Garchomp @ Loaded Dice');

    fireEvent.keyDown(area, { key: 'Enter', ctrlKey: true });
    expect(wired.onTeamLoad).toHaveBeenCalledTimes(2);
  });
});
