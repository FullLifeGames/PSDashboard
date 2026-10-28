import { describe, expect, onTestFinished, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PlayOutBar } from '../../../src/components/PlayOutBar';

type Props = Parameters<typeof PlayOutBar>[0];

function props(overrides: Partial<Props> = {}): Props {
  return {
    playOut: null, playOutNotice: null, hasVariation: false, viewTurn: 4, startDisabled: false, fastPlayOut: false,
    onStartPlayOut: vi.fn(), onStopPlayOut: vi.fn(), onWatchFrom: vi.fn(), onFastPlayOutChange: vi.fn(), ...overrides,
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

  test('the fast option is a checkbox beside the start button; a running fast play-out says so', async () => {
    const wired = props();
    const { rerender } = render(<PlayOutBar {...wired} />);
    const fast = screen.getByRole('checkbox', { name: /Fast play-out/ });
    expect(fast).not.toBeChecked();
    await userEvent.click(fast);
    expect(wired.onFastPlayOutChange).toHaveBeenCalledWith(true);

    rerender(<PlayOutBar {...wired} fastPlayOut playOut={{ active: true }} />);
    expect(screen.getByText(/Engine play-out running/)).toHaveTextContent('fast');
    expect(screen.queryByRole('checkbox', { name: /Fast play-out/ })).toBeNull();

    rerender(<PlayOutBar {...wired} playOut={{ active: true }} />);
    expect(screen.getByText(/Engine play-out running/)).not.toHaveTextContent('fast');
  });

  // Round 67 (T111 point 7): the fast option says where Auto runs the tree, per game type, from the search budget.
  test('the fast option names where it saves time, per game type', () => {
    const { rerender } = render(<PlayOutBar {...props()} />);
    const title = () => screen.getByRole('checkbox', { name: /Fast play-out/ }).closest('label')?.getAttribute('title');
    expect(title()).toBe('The depth-1 matrix search evaluates every turn of the run instead of the Auto line. It runs much faster where Auto would run the tree search (doubles: every turn; singles: once 25% of all Pokémon have fainted) and reads weaker there: the tree looks several turns ahead, the matrix one turn.');
    localStorage.setItem('ps-replay-interceptor:search-budget', 'doubles-tree-from=0.25');
    onTestFinished(() => localStorage.removeItem('ps-replay-interceptor:search-budget'));
    rerender(<PlayOutBar {...props()} />);
    expect(title()).toContain('(doubles: once 25% of all Pokémon have fainted; singles: once 25% of all Pokémon have fainted)');
  });

  test('the notice hides while a new run is active', () => {
    render(<PlayOutBar {...props({ playOut: { active: true }, playOutNotice: { text: 'old', watchTurn: 2 } })} />);
    expect(screen.queryByRole('status')).toBeNull();
  });
});
