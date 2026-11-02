import { describe, expect, test, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { BranchSlotChoice } from '@fulllifegames/eval-engine';
import { TurnDock } from '../../../../src/components/dock/TurnDock';
import type { DockFillView } from '../../../../src/hooks/useDockFill';
import { simState, type FormatKind } from '../../fixtures/sim-state';

// The legal move pool is heavy dex data; a fixed pool keeps the what-if row deterministic here.
vi.mock('../../../../src/lib/pokemon-options', () => ({ getMovePool: async () => ['Dragon Claw', 'Fire Fang'] }));

/**
 * Round 84 (turn dock), step A5: what the dock shows of the engine's fill at the live tip: a placeholder of the chip's own size
 * while the run is pending, the origin mark on a filled chip, the note while the game analysis runs, and the waiting Execute.
 */

type Props = Parameters<typeof TurnDock>[0];

const move = (moveId: string, moveName: string, targetLoc?: number): BranchSlotChoice => ({ kind: 'move', moveId, moveName, ...(targetLoc ? { targetLoc } : {}) });

function fillOf(overrides: Partial<DockFillView> = {}): DockFillView {
  return {
    pending: false, busy: false, waits: false, engine: { p1: [], p2: [] }, choices: null, queueExecute: vi.fn(), onUserChoice: vi.fn(),
    holdTray: vi.fn(), arm: vi.fn(), ...overrides,
  };
}

function renderDock(kind: FormatKind, fill: DockFillView, extra: Partial<Props> = {}, state = simState(kind)) {
  const props: Props = {
    simState: state, executeError: null, executing: false, gen: 9, onSetChoice: vi.fn(), onHypotheticalMove: vi.fn(),
    onExecuteTurn: vi.fn(), fill, ...extra,
  };
  render(<TurnDock {...props} />);
  return props;
}

const chip = (label: string) => screen.getByRole('button', { name: new RegExp(`^${label}\\b`) });
const execute = () => document.querySelector('.ps-execute-btn') as HTMLButtonElement;

describe.each(['singles', 'doubles'] as const)('TurnDock fill, %s', (kind) => {
  const labels = kind === 'doubles' ? ['P1A', 'P1B', 'P2A', 'P2B'] : ['P1', 'P2'];

  test('while the run is pending every empty chip holds a placeholder in the chip\'s own box', () => {
    renderDock(kind, fillOf({ pending: true }));
    for (const label of labels) {
      expect(chip(label)).toHaveTextContent('engine choosing…');
      expect(chip(label)).toHaveAttribute('data-empty', 'true');
      expect(chip(label).querySelector('.ps-dock-pick')).not.toBeNull();
    }
    expect(document.querySelectorAll('.ps-dock-chip')).toHaveLength(labels.length);
  });

  test('during the game analysis the empty chips say the engine is busy, and Execute stays locked', () => {
    renderDock(kind, fillOf({ busy: true }));
    for (const label of labels) expect(chip(label)).toHaveTextContent('engine busy with the game analysis');
    expect(execute()).toBeDisabled();
  });

  test('a fill that found no agreeing choice leaves the chip reading "choose"', () => {
    renderDock(kind, fillOf());
    for (const label of labels) expect(chip(label)).toHaveTextContent(/choose$/);
    expect(chip(labels[0])).not.toHaveTextContent('engine');
  });
});

describe('TurnDock fill, marks', () => {
  test('doubles: a filled chip carries the origin "engine"; the slot the user picked carries none', () => {
    const state = simState('doubles', {
      p1Choices: [move('flareblitz', 'Flare Blitz', 2), move('ragepowder', 'Rage Powder')],
      p2Choices: [move('grassyglide', 'Grassy Glide', 1), move('tailwind', 'Tailwind')],
    });
    renderDock('doubles', fillOf({ engine: { p1: [false, true], p2: [true, true] } }), {}, state);
    expect(chip('P1A')).not.toHaveAttribute('data-origin');
    expect(chip('P1A')).not.toHaveTextContent('engine');
    expect(chip('P1B')).toHaveAttribute('data-origin', 'engine');
    expect(chip('P1B')).toHaveTextContent('Rage Powder engine');
    expect(chip('P2A')).toHaveAttribute('data-origin', 'engine');
    expect(execute()).toBeEnabled();
  });

  test('singles: the filled chip names its move and the engine', () => {
    const state = simState('singles', { p1Choices: [move('earthquake', 'Earthquake')], p2Choices: [move('leechseed', 'Leech Seed')] });
    renderDock('singles', fillOf({ engine: { p1: [true], p2: [true] } }), {}, state);
    expect(chip('P1')).toHaveTextContent('Earthquake engine');
    expect(chip('P2')).toHaveTextContent('Leech Seed engine');
  });

  test('a pick in the tray tells the fill that the slot is the user\'s, before the choice is stored', async () => {
    const order: string[] = [];
    const fill = fillOf({ engine: { p1: [true], p2: [true] } });
    vi.mocked(fill.onUserChoice).mockImplementation(() => { order.push('user'); });
    const state = simState('singles', { p1Choices: [move('earthquake', 'Earthquake')], p2Choices: [move('leechseed', 'Leech Seed')] });
    const props = renderDock('singles', fill, { onSetChoice: vi.fn(() => { order.push('set'); }) }, state);
    await userEvent.click(chip('P1'));
    await userEvent.click(within(document.querySelector('.ps-tray') as HTMLElement).getByRole('button', { name: /Stone Edge/ }));
    expect(fill.onUserChoice).toHaveBeenCalledWith('p1', 0);
    expect(props.onSetChoice).toHaveBeenCalledWith('p1', expect.objectContaining({ moveId: 'stoneedge' }), 0);
    expect(order).toEqual(['user', 'set']);
  });
});

describe('TurnDock fill, Execute', () => {
  test('pressed while the run is pending, Execute waits for the engine instead of running', async () => {
    const fill = fillOf({ pending: true });
    const props = renderDock('doubles', fill);
    expect(execute()).toBeEnabled();
    expect(execute()).toHaveTextContent('Execute Turn');
    await userEvent.click(execute());
    expect(fill.queueExecute).toHaveBeenCalledTimes(1);
    expect(props.onExecuteTurn).not.toHaveBeenCalled();
  });

  test('a queued Execute reads "Waits for engine…" and cannot be pressed again', () => {
    renderDock('doubles', fillOf({ pending: true, waits: true }));
    expect(execute()).toHaveTextContent('Waits for engine…');
    expect(execute()).toBeDisabled();
  });

  test('with every slot chosen Execute runs the turn at once, whatever the run is doing', async () => {
    const fill = fillOf({ pending: true });
    const state = simState('singles', { p1Choices: [move('earthquake', 'Earthquake')], p2Choices: [move('leechseed', 'Leech Seed')] });
    const props = renderDock('singles', fill, {}, state);
    await userEvent.click(execute());
    expect(props.onExecuteTurn).toHaveBeenCalledWith({ p1: state.p1Choices, p2: state.p2Choices });
    expect(fill.queueExecute).not.toHaveBeenCalled();
  });

  test('without a fill, Execute is locked until every slot is chosen, as before', () => {
    renderDock('doubles', undefined as unknown as DockFillView, { fill: null });
    expect(execute()).toBeDisabled();
    expect(execute()).toHaveTextContent(/^Select /);
  });
});

describe.each(['singles', 'doubles'] as const)('TurnDock fill, the open tray, %s', (kind) => {
  const first = kind === 'doubles' ? 'P1A' : 'P1';

  test('the open tray is reported to the fill, and its closing too', async () => {
    const fill = fillOf();
    renderDock(kind, fill);
    await userEvent.click(chip(first));
    expect(fill.holdTray).toHaveBeenLastCalledWith({ side: 'p1', slot: 0 });
    await userEvent.click(chip(first));
    expect(fill.holdTray).toHaveBeenLastCalledWith(null);
  });

  test('a click on a chip arms the fill (Q19 b, the trigger at a replay turn)', async () => {
    const fill = fillOf();
    renderDock(kind, fill);
    expect(fill.arm).not.toHaveBeenCalled();
    await userEvent.click(chip(first));
    expect(fill.arm).toHaveBeenCalledTimes(1);
  });
});
