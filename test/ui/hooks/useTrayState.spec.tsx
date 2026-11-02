import { describe, expect, test } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { useTrayState } from '../../../src/hooks/useTrayState';

/** Round 84 (turn dock): when the dock's tray opens and closes. */
function Probe({ positionKey }: { positionKey: string }) {
  // Destructured: the lint rule reads `ref={tray.attachRoot}` as a ref and then every other `tray.` read as a ref read.
  const { open, attachRoot, onKeyDown, toggleChip, toggleMore } = useTrayState(positionKey);
  return (
    <div>
      <div ref={attachRoot} onKeyDown={onKeyDown} data-testid="dock">
        <button type="button" data-chip="p10" onClick={() => toggleChip('p1', 0)}>chip A</button>
        <button type="button" data-chip="p11" onClick={() => toggleChip('p1', 1)}>chip B</button>
        <button type="button" onClick={toggleMore}>more</button>
        <input aria-label="what if" role="combobox" aria-expanded={false} />
        <input aria-label="open what if" role="combobox" aria-expanded />
      </div>
      <button type="button">outside</button>
      <output data-testid="state">{open ? `${open.side}${open.slot}${open.more ? ' more' : ''}` : 'closed'}</output>
    </div>
  );
}

const state = () => screen.getByTestId('state').textContent;
const press = (name: string) => act(() => { fireEvent.click(screen.getByRole('button', { name })); });

describe('useTrayState', () => {
  test('a chip opens its tray, another chip switches to it, the same chip closes it', () => {
    render(<Probe positionKey="a" />);
    expect(state()).toBe('closed');
    press('chip A');
    expect(state()).toBe('p10');
    press('chip B');
    expect(state()).toBe('p11');
    press('more');
    expect(state()).toBe('p11 more');
    press('chip A');
    expect(state()).toBe('p10');
    press('chip A');
    expect(state()).toBe('closed');
  });

  test('a new position closes the tray in the same render', () => {
    const { rerender } = render(<Probe positionKey="a" />);
    press('chip A');
    expect(state()).toBe('p10');
    rerender(<Probe positionKey="b" />);
    expect(state()).toBe('closed');
  });

  test('a pointer press beside the dock closes it, a press inside does not', () => {
    render(<Probe positionKey="a" />);
    press('chip A');
    act(() => { fireEvent.pointerDown(screen.getByLabelText('what if')); });
    expect(state()).toBe('p10');
    act(() => { fireEvent.pointerDown(screen.getByRole('button', { name: 'outside' })); });
    expect(state()).toBe('closed');
  });

  test('the window blur closes it when the focus moved into an iframe (the replay), and not otherwise', () => {
    render(<Probe positionKey="a" />);
    press('chip A');
    act(() => { fireEvent.blur(window); });
    expect(state()).toBe('p10');
    const frame = document.createElement('iframe');
    document.body.appendChild(frame);
    frame.focus();
    act(() => { fireEvent.blur(window); });
    expect(state()).toBe('closed');
    frame.remove();
  });

  test('Escape closes the tray and returns the focus to its chip, but leaves an open What-if list alone', () => {
    render(<Probe positionKey="a" />);
    press('chip A');
    act(() => { fireEvent.keyDown(screen.getByLabelText('open what if'), { key: 'Escape' }); });
    expect(state()).toBe('p10');
    act(() => { fireEvent.keyDown(screen.getByLabelText('what if'), { key: 'Escape' }); });
    expect(state()).toBe('closed');
    expect(screen.getByRole('button', { name: 'chip A' })).toHaveFocus();
  });
});
