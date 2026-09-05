import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PlayOutBar } from '../../src/components/PlayOutBar';

type Props = Parameters<typeof PlayOutBar>[0];

function props(overrides: Partial<Props> = {}): Props {
  return {
    playOut: null, playOutNotice: null, hasVariation: false, viewTurn: 4, startDisabled: false,
    onStartPlayOut: vi.fn(), onStopPlayOut: vi.fn(), onWatchFrom: vi.fn(), ...overrides,
  };
}

describe('PlayOutBar', () => {
  test('offers the start button with the viewed turn, disabled when the position cannot play', async () => {
    const wired = props();
    const { rerender } = render(<PlayOutBar {...wired} />);
    expect(screen.getByText(/engine finishes the game from turn 4/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Let it play out/ }));
    expect(wired.onStartPlayOut).toHaveBeenCalledTimes(1);

    rerender(<PlayOutBar {...wired} startDisabled />);
    expect(screen.getByRole('button', { name: /Let it play out/ })).toBeDisabled();
  });

  test('while the engine plays, the bar shows the running state and a stop button', async () => {
    const wired = props({ playOut: { active: true } });
    render(<PlayOutBar {...wired} />);
    expect(screen.getByText('Engine play-out running')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Let it play out/ })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Stop' }));
    expect(wired.onStopPlayOut).toHaveBeenCalledTimes(1);
  });

  test('a finished run shows its notice and, with a variation, the watch button seeks to its start', async () => {
    const notice = { text: 'Play-out finished: the battle ended after 3 turns.', watchTurn: 4 };
    const wired = props({ playOutNotice: notice, hasVariation: true });
    render(<PlayOutBar {...wired} />);
    expect(screen.getByRole('status')).toHaveTextContent(notice.text);
    await userEvent.click(screen.getByRole('button', { name: /Watch from turn 4/ }));
    expect(wired.onWatchFrom).toHaveBeenCalledWith(4);

    const without = props({ playOutNotice: notice, hasVariation: false });
    render(<PlayOutBar {...without} />);
    expect(screen.getAllByRole('button', { name: /Watch from turn/ })).toHaveLength(1);
  });

  test('the notice hides while a new run is active', () => {
    render(<PlayOutBar {...props({ playOut: { active: true }, playOutNotice: { text: 'old', watchTurn: 2 } })} />);
    expect(screen.queryByRole('status')).toBeNull();
  });
});
