import { describe, expect, test, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BranchPanel } from '../../src/components/BranchPanel';
import { simState } from '../fixtures/sim-state';

// The legal move pool is heavy dex data; a fixed pool keeps the what-if row deterministic here.
vi.mock('../../src/lib/pokemon-options', () => ({ getMovePool: async () => ['Dragon Claw', 'Fire Fang'] }));

const ADVANCED_KEY = 'ps-replay-interceptor:picker-advanced';

type Props = Parameters<typeof BranchPanel>[0];

function props(overrides: Partial<Props> = {}): Props {
  return {
    simState: simState('singles'), executeError: null, executing: false, gen: 9,
    onSetChoice: vi.fn(), onHypotheticalMove: vi.fn(), onExecuteTurn: vi.fn(), ...overrides,
  };
}

const sideLabels = () => [...document.querySelectorAll('.ps-side-label')].map(label => label.textContent);

/** The controls of one slot, found by its label (P1, or P1A/P1B in doubles). */
const slot = (label: string) => {
  const heading = [...document.querySelectorAll('.ps-side-label')].find(candidate => candidate.textContent === label)!;
  return within(heading.closest('.ps-side-controls') as HTMLElement);
};

describe('BranchPanel', () => {
  test('nothing renders without a position; an ended position keeps only the log toggle', () => {
    const { rerender, container } = render(<BranchPanel {...props({ simState: null })} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<BranchPanel {...props({ simState: simState('singles', { ended: true, winner: 'p1' }) })} />);
    expect(screen.queryByRole('button', { name: /Earthquake/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Select|Execute/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Show Raw Protocol Log' })).toBeInTheDocument();
  });

  test('compact: both sides get move and switch chips; Execute waits for both choices and names the missing side', async () => {
    const wired = props();
    const { rerender } = render(<BranchPanel {...wired} />);
    expect(slot('P1').getByRole('button', { name: /Earthquake/ })).toHaveClass('ps-movebtn-compact');
    expect(slot('P1').getByRole('button', { name: /Heatran/ })).toBeInTheDocument();
    expect(slot('P2').getByRole('button', { name: /Leech Seed/ })).toBeInTheDocument();
    expect(slot('P2').getByRole('button', { name: /Rotom-Wash/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Select P1 & P2 choice' })).toBeDisabled();

    await userEvent.click(slot('P1').getByRole('button', { name: /Earthquake/ }));
    expect(wired.onSetChoice).toHaveBeenCalledWith('p1', { kind: 'move', moveId: 'earthquake', moveName: 'Earthquake' }, 0);
    await userEvent.click(slot('P2').getByRole('button', { name: /Rotom-Wash/ }));
    expect(wired.onSetChoice).toHaveBeenLastCalledWith('p2', { kind: 'switch', speciesId: 'rotomwash', pokemonName: 'Rotom-Wash' }, 0);

    const p1Choice = { kind: 'move' as const, moveId: 'earthquake', moveName: 'Earthquake' };
    const p2Choice = { kind: 'switch' as const, speciesId: 'rotomwash', pokemonName: 'Rotom-Wash' };
    rerender(<BranchPanel {...wired} simState={simState('singles', { p1Choice, p1Choices: [p1Choice] })} />);
    expect(screen.getByRole('button', { name: 'Select P2 choice' })).toBeDisabled();
    expect(screen.getByText('[Earthquake]')).toBeInTheDocument();

    const ready = simState('singles', { p1Choice, p1Choices: [p1Choice], p2Choice, p2Choices: [p2Choice] });
    rerender(<BranchPanel {...wired} simState={ready} />);
    await userEvent.click(screen.getByRole('button', { name: 'Execute Turn' }));
    expect(wired.onExecuteTurn).toHaveBeenCalledTimes(1);
    rerender(<BranchPanel {...wired} simState={ready} executing />);
    expect(screen.getByRole('button', { name: 'Executing…' })).toBeDisabled();
  });

  test('doubles: two slot columns per side; a targeted move sends its target with the slot index', async () => {
    const wired = props({ simState: simState('doubles') });
    render(<BranchPanel {...wired} />);
    expect(sideLabels()).toEqual(['P1A', 'P1B', 'P2A', 'P2B']);
    expect(screen.getByRole('button', { name: 'Select all active choices' })).toBeDisabled();

    await userEvent.click(slot('P1A').getByTitle('Flare Blitz into Tornadus (100%)'));
    expect(wired.onSetChoice).toHaveBeenCalledWith('p1', { kind: 'move', moveId: 'flareblitz', moveName: 'Flare Blitz', targetLoc: 2 }, 0);
    await userEvent.click(slot('P1B').getByRole('button', { name: /^Spore/ }));
    expect(wired.onSetChoice).toHaveBeenLastCalledWith('p1', { kind: 'move', moveId: 'spore', moveName: 'Spore', targetLoc: 1 }, 1);
    await userEvent.click(slot('P2B').getByRole('button', { name: /Kingambit/ }));
    expect(wired.onSetChoice).toHaveBeenLastCalledWith('p2', { kind: 'switch', speciesId: 'kingambit', pokemonName: 'Kingambit' }, 1);
  });

  test('doubles: a switch-in reserved by one slot is blocked in the other', () => {
    const reserve = { kind: 'switch' as const, speciesId: 'fluttermane', pokemonName: 'Flutter Mane' };
    render(<BranchPanel {...props({ simState: simState('doubles', { p1Choices: [reserve, null] }) })} />);
    expect(slot('P1A').getByRole('button', { name: /Flutter Mane/ })).toHaveClass('ps-switchbtn-selected');
    expect(slot('P1B').getByRole('button', { name: /Flutter Mane/ })).toBeDisabled();
    expect(slot('P1B').getByRole('button', { name: /Urshifu/ })).toBeEnabled();
  });

  test('Advanced grows the chips into the full picker with damage previews; the toggle persists', async () => {
    render(<BranchPanel {...props()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Advanced ▸' }));
    expect(localStorage.getItem(ADVANCED_KEY)).toBe('1');
    expect(screen.getAllByRole('button', { name: 'Fight' })).toHaveLength(2);
    const earthquake = slot('P1').getByRole('button', { name: /Earthquake/ });
    expect(earthquake).toHaveTextContent('Ground');
    await waitFor(() => expect(earthquake).toHaveTextContent(/\d+(\.\d+)?% - \d+(\.\d+)?%/));

    await userEvent.click(screen.getByRole('button', { name: 'Advanced ▾' }));
    expect(localStorage.getItem(ADVANCED_KEY)).toBe('0');
    expect(screen.queryByRole('button', { name: 'Fight' })).toBeNull();
  });

  test('the persisted Advanced setting is read back on mount', () => {
    localStorage.setItem(ADVANCED_KEY, '1');
    render(<BranchPanel {...props()} />);
    expect(screen.getByRole('button', { name: 'Advanced ▾' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getAllByRole('button', { name: 'Pokémon' })).toHaveLength(2);
  });

  test('a forced replacement hides that slot\'s moves and the Execute row', () => {
    render(<BranchPanel {...props({ simState: simState('singles', { p2ForceSwitch: true, p2ForceSwitches: [true] }) })} />);
    expect(screen.getByText('Ferrothorn is switching out. Choose who to send in:')).toBeInTheDocument();
    expect(slot('P2').queryByRole('button', { name: /Leech Seed/ })).toBeNull();
    expect(slot('P2').getByRole('button', { name: /Rotom-Wash/ })).toBeInTheDocument();
    expect(slot('P1').getByRole('button', { name: /Earthquake/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Select|Execute/ })).toBeNull();
  });

  test('the source line, the execute error, and the played badges render from their props', () => {
    const played = { p1: { kind: 'move' as const, name: 'Earthquake' }, p2: { kind: 'switch' as const, name: 'Rotom-Wash', species: 'Rotom-Wash' } };
    render(<BranchPanel {...props({ source: 'snapshot', acquiringExact: true, executeError: 'Invalid choice: Garchomp is trapped', played })} />);
    expect(screen.getByText('Choices approximated · reconstructing the exact position…')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Invalid choice: Garchomp is trapped');
    expect(slot('P1').getByRole('button', { name: /Earthquake/ })).toHaveTextContent('played');
    expect(slot('P1').getByRole('button', { name: /Stone Edge/ })).not.toHaveTextContent('played');
    expect(slot('P2').getByRole('button', { name: /Rotom-Wash/ })).toHaveTextContent('played');
    expect(slot('P2').getByText('played:')).toHaveTextContent('played: → Rotom-Wash');
    expect(sideLabels()).toEqual(['P1', 'P2']);
  });

  test('the what-if loader hands the hypothetical move to the handler with its side and slot', async () => {
    localStorage.setItem(ADVANCED_KEY, '1');
    const wired = props();
    render(<BranchPanel {...wired} />);
    const box = await slot('P1').findByRole('combobox', { name: 'Hypothetical move for P1' });
    await userEvent.type(box, 'Dragon Claw');
    await userEvent.click(slot('P1').getByRole('button', { name: 'Load move' }));
    expect(wired.onHypotheticalMove).toHaveBeenCalledWith('p1', 0, { species: 'Garchomp', move: 'Dragon Claw', replace: 'Scale Shot' });
  });
});
