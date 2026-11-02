import { afterEach, describe, expect, test, vi } from 'vitest';
import { render } from '@testing-library/react';
import { TurnDock } from '../../../../src/components/dock/TurnDock';
import { simState } from '../../fixtures/sim-state';

vi.mock('../../../../src/lib/pokemon-options', () => ({ getMovePool: async () => ['Dragon Claw'] }));

type Props = Parameters<typeof TurnDock>[0];

const props = (overrides: Partial<Props> = {}): Props => ({
  simState: simState('singles'), executeError: null, executing: false, gen: 9,
  onSetChoice: vi.fn(), onHypotheticalMove: vi.fn(), onExecuteTurn: vi.fn(), ...overrides,
});

const read = () => document.documentElement.style.getPropertyValue('--ps-dock-h');

afterEach(() => {
  vi.restoreAllMocks();
  document.documentElement.style.removeProperty('--ps-dock-h');
});

/** Round 84 (A6b): the fixed dock of a narrow window tells the page its height; it stands for singles and doubles, and goes with the dock. */
describe('the dock reports its height', () => {
  test.each(['singles', 'doubles'] as const)('a %s dock writes --ps-dock-h and removes it when it unmounts', kind => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ height: 132 } as DOMRect);
    const { unmount } = render(<TurnDock {...props({ simState: simState(kind) })} />);
    expect(read()).toBe('132px');
    unmount();
    expect(read()).toBe('');
  });

  test('the ended notice reports it as well, and a dock without a state reports nothing', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ height: 40 } as DOMRect);
    const { rerender } = render(<TurnDock {...props({ simState: { ...simState('singles'), ended: true, winner: 'Alice' } })} />);
    expect(read()).toBe('40px');
    rerender(<TurnDock {...props({ simState: null })} />);
    expect(read()).toBe('');
  });
});
