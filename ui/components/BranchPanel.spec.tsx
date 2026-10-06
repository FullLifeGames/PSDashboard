import { describe, expect, test, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  calcSingleDamageRange, type BranchMoveOption, type BranchSimState, type BranchSlotChoice, type SimPokemonInfo,
} from '@fulllifegames/eval-engine';
import { BranchPanel } from '../../src/components/BranchPanel';
import { NO_MODIFIERS, moveOption, pokemon, simState, targetOption } from '../fixtures/sim-state';

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

  describe('the Tera toggle reaches the damage preview (T20, decision 18)', () => {
    const singles = simState('singles');
    const [garchomp] = singles.p1ActiveSlots as SimPokemonInfo[];
    const [ferrothorn] = singles.p2ActiveSlots as SimPokemonInfo[];
    const earthquake = singles.p1MovesBySlot[0][0];
    const range = (attacker: SimPokemonInfo, defender: SimPokemonInfo, gameType: 'Singles' | 'Doubles' = 'Singles', move = earthquake) =>
      calcSingleDamageRange(attacker, defender, move, { gameType, gen: 9 }).range;

    test('singles: pressing the attacker Tera toggle moves the number to the calc after the click, and back', async () => {
      localStorage.setItem(ADVANCED_KEY, '1');
      render(<BranchPanel {...props({ simState: simState('singles', { p1ModifiersBySlot: [{ ...NO_MODIFIERS, teraType: 'Ground' }] }) })} />);
      const button = slot('P1').getByRole('button', { name: /Earthquake/ });
      const plain = range(garchomp, ferrothorn);
      const tera = range({ ...garchomp, teraType: 'Ground' }, ferrothorn);
      expect(tera).not.toBe(plain);
      await waitFor(() => expect(button).toHaveTextContent(plain));
      await userEvent.click(slot('P1').getByRole('button', { name: 'Tera (Ground)' }));
      await waitFor(() => expect(button).toHaveTextContent(tera));
      await userEvent.click(slot('P1').getByRole('button', { name: 'Tera (Ground)' }));
      await waitFor(() => expect(button).toHaveTextContent(plain));
    });

    test('singles: the defender Tera toggle moves the attacker number too', async () => {
      localStorage.setItem(ADVANCED_KEY, '1');
      render(<BranchPanel {...props({ simState: simState('singles', { p2ModifiersBySlot: [{ ...NO_MODIFIERS, teraType: 'Fire' }] }) })} />);
      const button = slot('P1').getByRole('button', { name: /Earthquake/ });
      const tera = range(garchomp, { ...ferrothorn, teraType: 'Fire' });
      expect(tera).not.toBe(range(garchomp, ferrothorn));
      await userEvent.click(slot('P2').getByRole('button', { name: 'Tera (Fire)' }));
      await waitFor(() => expect(button).toHaveTextContent(tera));
    });

    test('doubles: the toggle moves the rows of the move into both targets', async () => {
      localStorage.setItem(ADVANCED_KEY, '1');
      const doubles = simState('doubles', { p1ModifiersBySlot: [{ ...NO_MODIFIERS, teraType: 'Fire' }, { ...NO_MODIFIERS }] });
      const [incineroar] = doubles.p1ActiveSlots as SimPokemonInfo[];
      const flareBlitz = doubles.p1MovesBySlot[0][1];
      render(<BranchPanel {...props({ simState: doubles })} />);
      await userEvent.click(slot('P1A').getByRole('button', { name: 'Tera (Fire)' }));
      for (const target of doubles.p2ActiveSlots as SimPokemonInfo[]) {
        const tera = range({ ...incineroar, teraType: 'Fire' }, target, 'Doubles', flareBlitz);
        expect(tera).not.toBe(range(incineroar, target, 'Doubles', flareBlitz));
        await waitFor(() => expect(slot('P1A').getByTitle(`Flare Blitz into ${target.species} (100%)`)).toHaveTextContent(tera));
      }
    });

    test('Mega Evolve stays out of the preview', async () => {
      localStorage.setItem(ADVANCED_KEY, '1');
      render(<BranchPanel {...props({ simState: simState('singles', {
        p1ModifiersBySlot: [{ ...NO_MODIFIERS, canMegaEvo: true, teraType: 'Ground' }],
        p2ModifiersBySlot: [{ ...NO_MODIFIERS, teraType: 'Fire' }],
      }) })} />);
      const button = slot('P1').getByRole('button', { name: /Earthquake/ });
      await waitFor(() => expect(button).toHaveTextContent(range(garchomp, ferrothorn)));
      await userEvent.click(slot('P1').getByRole('button', { name: 'Mega Evolve' }));
      expect(slot('P1').getByRole('button', { name: 'Mega Evolve' })).toHaveAttribute('aria-pressed', 'true');
      expect(slot('P1').getByRole('button', { name: 'Tera (Ground)' })).toHaveAttribute('aria-pressed', 'false');
      // The number before the click cannot show a leak: no recomputation may have landed yet (T126).
      // The defender's Tera recomputes the preview for sure, and that recomputation reads P1's armed Mega too.
      const megaLeftOut = range(garchomp, { ...ferrothorn, teraType: 'Fire' });
      expect(megaLeftOut).not.toBe(range({ ...garchomp, teraType: 'Ground' }, { ...ferrothorn, teraType: 'Fire' }));
      await userEvent.click(slot('P2').getByRole('button', { name: 'Tera (Fire)' }));
      await waitFor(() => expect(button).toHaveTextContent(megaLeftOut));
    });
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

/** The calc's range for a move as the preview reads it, with the game type of the fixture. */
const calcRange = (attacker: SimPokemonInfo, defender: SimPokemonInfo, move: BranchMoveOption, gameType: 'Singles' | 'Doubles') =>
  calcSingleDamageRange(attacker, defender, move, { gameType, gen: 9 }).range;

describe('armed toggles belong to one position (T124 point 2)', () => {
  test('singles: a new position releases the armed Tera, and the number falls back to the plain attacker', async () => {
    localStorage.setItem(ADVANCED_KEY, '1');
    const at = (positionKey: string) => props({ positionKey, simState: simState('singles', { p1ModifiersBySlot: [{ ...NO_MODIFIERS, teraType: 'Ground' }] }) });
    const { rerender } = render(<BranchPanel {...at('r1:main:2')} />);
    const [garchomp] = simState('singles').p1ActiveSlots as SimPokemonInfo[];
    const [ferrothorn] = simState('singles').p2ActiveSlots as SimPokemonInfo[];
    const earthquake = simState('singles').p1MovesBySlot[0][0];
    const button = () => slot('P1').getByRole('button', { name: /Earthquake/ });
    await userEvent.click(slot('P1').getByRole('button', { name: 'Tera (Ground)' }));
    await waitFor(() => expect(button()).toHaveTextContent(calcRange({ ...garchomp, teraType: 'Ground' }, ferrothorn, earthquake, 'Singles')));
    rerender(<BranchPanel {...at('r1:main:3')} />);
    expect(slot('P1').getByRole('button', { name: 'Tera (Ground)' })).toHaveAttribute('aria-pressed', 'false');
    await waitFor(() => expect(button()).toHaveTextContent(calcRange(garchomp, ferrothorn, earthquake, 'Singles')));
  });

  test('doubles: every armed slot of both sides falls back on a new position', async () => {
    const at = (positionKey: string) => props({ positionKey, simState: simState('doubles', {
      p1ModifiersBySlot: [{ ...NO_MODIFIERS, teraType: 'Fire' }, { ...NO_MODIFIERS }],
      p2ModifiersBySlot: [{ ...NO_MODIFIERS }, { ...NO_MODIFIERS, teraType: 'Steel' }],
    }) });
    const { rerender } = render(<BranchPanel {...at('r1:variation:5')} />);
    await userEvent.click(slot('P1A').getByRole('button', { name: 'Tera (Fire)' }));
    await userEvent.click(slot('P2B').getByRole('button', { name: 'Tera (Steel)' }));
    expect(slot('P2B').getByRole('button', { name: 'Tera (Steel)' })).toHaveAttribute('aria-pressed', 'true');
    rerender(<BranchPanel {...at('r1:variation:6')} />);
    expect(slot('P1A').getByRole('button', { name: 'Tera (Fire)' })).toHaveAttribute('aria-pressed', 'false');
    expect(slot('P2B').getByRole('button', { name: 'Tera (Steel)' })).toHaveAttribute('aria-pressed', 'false');
  });
});

describe('one Tera per side in doubles (T124 point 1)', () => {
  const doubles = (overrides: Partial<BranchSimState> = {}) => simState('doubles', {
    p1ModifiersBySlot: [{ ...NO_MODIFIERS, teraType: 'Fire' }, { ...NO_MODIFIERS, teraType: 'Bug' }], ...overrides,
  });
  const fixture = doubles();
  const [incineroar, amoonguss] = fixture.p1ActiveSlots as SimPokemonInfo[];
  const [rillaboom] = fixture.p2ActiveSlots as SimPokemonInfo[];
  const pollenPuff = fixture.p1MovesBySlot[1][1];
  const pollenPuffRow = () => slot('P1B').getByTitle('Pollen Puff into Rillaboom (100%)');

  test('the partner of an armed Tera cannot arm its own, and its rows stay untoggled', async () => {
    localStorage.setItem(ADVANCED_KEY, '1');
    render(<BranchPanel {...props({ simState: fixture })} />);
    await userEvent.click(slot('P1A').getByRole('button', { name: 'Tera (Fire)' }));
    const bug = slot('P1B').getByRole('button', { name: 'Tera (Bug)' });
    expect(bug).toBeDisabled();
    expect(bug).toHaveAttribute('title', 'P1A already terastallizes this turn.');
    await userEvent.click(bug);
    expect(bug).toHaveAttribute('aria-pressed', 'false');
    // P1A's Tera reaches the preview; P1B's rows stay as the calc reads the untoggled Amoonguss.
    const plain = calcRange(amoonguss, rillaboom, pollenPuff, 'Doubles');
    expect(plain).not.toBe(calcRange({ ...amoonguss, teraType: 'Bug' }, rillaboom, pollenPuff, 'Doubles'));
    await waitFor(() => expect(slot('P1A').getByTitle('Flare Blitz into Rillaboom (100%)'))
      .toHaveTextContent(calcRange({ ...incineroar, teraType: 'Fire' }, rillaboom, fixture.p1MovesBySlot[0][1], 'Doubles')));
    expect(pollenPuffRow()).toHaveTextContent(plain);
    // Released on P1A, the Tera is free for P1B again.
    await userEvent.click(slot('P1A').getByRole('button', { name: 'Tera (Fire)' }));
    expect(bug).toBeEnabled();
  });

  test('a pending choice that terastallizes holds the Tera for its side too', () => {
    const flareBlitzTera = { kind: 'move' as const, moveId: 'flareblitz', moveName: 'Flare Blitz', targetLoc: 1, modifier: 'terastallize' as const };
    render(<BranchPanel {...props({ simState: doubles({ p1Choices: [flareBlitzTera, null] }) })} />);
    expect(slot('P1B').getByRole('button', { name: 'Tera (Bug)' })).toBeDisabled();
    expect(slot('P1A').getByRole('button', { name: 'Tera (Fire)' })).toBeEnabled();
  });

  test('the preview reads the picks: Protect on Rillaboom\'s partner lands both Dragon Darts on Rillaboom (T124 point 4)', async () => {
    localStorage.setItem(ADVANCED_KEY, '1');
    const dragapult = pokemon('Dragapult', { isActive: true, activeSlot: 0, ability: 'Clear Body', item: '', moves: [{ name: 'Dragon Darts', type: 'Dragon' }] });
    const darts = moveOption('Dragon Darts', { type: 'Dragon', requiresTarget: true, targetOptions: [targetOption('p2', 0, 'Rillaboom', 1), targetOption('p2', 1, 'Tornadus', 2)] });
    const protect = { kind: 'move' as const, moveId: 'protect', moveName: 'Protect' };
    const scene = (p2Choices: (BranchSlotChoice | null)[]) => doubles({
      p1ActiveSlots: [dragapult, amoonguss], p1MovesBySlot: [[darts], fixture.p1MovesBySlot[1]], p2Choices,
    });
    const row = () => slot('P1A').getByTitle('Dragon Darts into Rillaboom (100%)');
    const dartsInto = (context: object) => calcSingleDamageRange(dragapult, rillaboom, darts, { gameType: 'Doubles', gen: 9, ...context }).range;
    const split = dartsInto({ defenderPartner: fixture.p2ActiveSlots[1] });
    const both = dartsInto({ defenderPartner: null });
    expect(split).not.toBe(both);
    const { rerender } = render(<BranchPanel {...props({ simState: scene([null, null]) })} />);
    await waitFor(() => expect(row()).toHaveTextContent(split));
    rerender(<BranchPanel {...props({ simState: scene([null, protect]) })} />);
    await waitFor(() => expect(row()).toHaveTextContent(both));
  });

  test('each side holds its own Tera', async () => {
    render(<BranchPanel {...props({ simState: doubles({ p2ModifiersBySlot: [{ ...NO_MODIFIERS, teraType: 'Grass' }, { ...NO_MODIFIERS }] }) })} />);
    await userEvent.click(slot('P1A').getByRole('button', { name: 'Tera (Fire)' }));
    await userEvent.click(slot('P2A').getByRole('button', { name: 'Tera (Grass)' }));
    expect(slot('P2A').getByRole('button', { name: 'Tera (Grass)' })).toHaveAttribute('aria-pressed', 'true');
  });
});
