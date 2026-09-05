import { describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TimelineBar } from '../../src/components/TimelineBar';

type Props = Parameters<typeof TimelineBar>[0];

function props(overrides: Partial<Props> = {}): Props {
  return {
    viewT0: false, viewTurn: 3, viewLine: 'main', variationSpan: null, maxTurn: 10, endSnapshotTurn: null,
    atEndPosition: false, viewingVariation: false, branching: false,
    onNavigate: vi.fn(), onGraphSelectLine: vi.fn(), onDiscard: vi.fn(), ...overrides,
  };
}

/** The position label next to the slider ("T3/10", "T0", "End"). */
const positionLabel = () => screen.getByRole('slider').closest('.ps-branch-bar')!.querySelector('span[style*="min-width"]')!.textContent;

describe('TimelineBar', () => {
  test('the slider spans the replay and reports the turn on its line; the label counts played turns', () => {
    const wired = props();
    render(<TimelineBar {...wired} />);
    const slider = screen.getByRole('slider', { name: 'Timeline turn selector' });
    expect(slider).toHaveAttribute('min', '1');
    expect(slider).toHaveAttribute('max', '10');
    expect(slider).toHaveValue('3');
    expect(positionLabel()).toBe('T3/10');
    fireEvent.change(slider, { target: { value: '7' } });
    expect(wired.onNavigate).toHaveBeenCalledWith({ turn: 7, line: 'main' });
    expect(screen.queryByRole('button', { name: 'Discard variation' })).toBeNull();
    expect(screen.queryByRole('group', { name: 'Line selector' })).toBeNull();
  });

  test('the arrows step the turn; the first step back opens the team preview, T0 is pressed there', async () => {
    const wired = props({ viewTurn: 1 });
    const { rerender } = render(<TimelineBar {...wired} />);
    await userEvent.click(screen.getByRole('button', { name: '▶' }));
    expect(wired.onNavigate).toHaveBeenCalledWith({ turn: 2, line: 'main' });
    await userEvent.click(screen.getByRole('button', { name: '◀' }));
    expect(wired.onGraphSelectLine).toHaveBeenCalledWith(0);

    rerender(<TimelineBar {...wired} viewT0 />);
    expect(screen.getByRole('button', { name: 'T0' })).toHaveAttribute('aria-pressed', 'true');
    expect(positionLabel()).toBe('T0');
    expect(screen.getByRole('button', { name: '◀' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: '▶' }));
    expect(wired.onNavigate).toHaveBeenLastCalledWith({ turn: 1, line: 'main' });
  });

  test('the forward arrow stops at the end of the range; the end sentinel reads End', () => {
    render(<TimelineBar {...props({ viewTurn: 10, endSnapshotTurn: 10, atEndPosition: true })} />);
    expect(screen.getByRole('button', { name: '▶' })).toBeDisabled();
    expect(screen.getByText('End')).toBeInTheDocument();
  });

  test('a variation adds the gold stripe, the line chips, and the discard button', async () => {
    const wired = props({ viewTurn: 5, variationSpan: { startTurn: 4, length: 3 }, viewingVariation: true, viewLine: 'variation', branching: true });
    render(<TimelineBar {...wired} />);
    expect(screen.getByRole('slider')).toHaveAttribute('max', '10');
    expect(screen.getByTitle('Variation: turns 4–7')).toBeInTheDocument();
    expect(positionLabel()).toBe('T5/10');

    const chips = screen.getByRole('group', { name: 'Line selector' });
    expect(chips.querySelector('.on-vari')).toHaveTextContent('Variation');
    await userEvent.click(screen.getByRole('button', { name: 'Main line' }));
    expect(wired.onNavigate).toHaveBeenCalledWith({ turn: 5, line: 'main' });
    await userEvent.click(screen.getByRole('button', { name: 'Variation' }));
    expect(wired.onNavigate).toHaveBeenLastCalledWith({ turn: 5, line: 'variation' });

    await userEvent.click(screen.getByRole('button', { name: 'Discard variation' }));
    expect(wired.onDiscard).toHaveBeenCalledTimes(1);
  });

  test('a variation past the replay end widens the slider; the chip clamps into the covered turns', async () => {
    const wired = props({ viewTurn: 2, variationSpan: { startTurn: 9, length: 4 }, maxTurn: 10 });
    render(<TimelineBar {...wired} />);
    expect(screen.getByRole('slider')).toHaveAttribute('max', '13');
    await userEvent.click(screen.getByRole('button', { name: 'Variation' }));
    expect(wired.onNavigate).toHaveBeenCalledWith({ turn: 10, line: 'variation' });
  });
});
