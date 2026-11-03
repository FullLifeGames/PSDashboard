import { describe, expect, test, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { BranchSimState, BranchSlotChoice } from '@fulllifegames/eval-engine';
import { TurnDock } from '../../../../src/components/dock/TurnDock';
import { pokemon, simState } from '../../fixtures/sim-state';

// The legal move pool is heavy dex data; a fixed pool keeps the what-if row deterministic here.
vi.mock('../../../../src/lib/pokemon-options', () => ({ getMovePool: async () => ['Dragon Claw', 'Fire Fang'] }));

/**
 * Round 84 (turn dock), step A3b: the choice cases of the old BranchPanel and SideControls specs, against the dock. A position
 * without a played record starts without picks, so these cases click the way a user does at the tip.
 */
type Props = Parameters<typeof TurnDock>[0];

function props(overrides: Partial<Props> = {}): Props {
  return {
    simState: simState('singles'), executeError: null, executing: false, gen: 9,
    onSetChoice: vi.fn(), onHypotheticalMove: vi.fn(), onExecuteTurn: vi.fn(), ...overrides,
  };
}

const chip = (label: string) => screen.getByRole('button', { name: new RegExp(`^${label}\\b`) });
const tray = () => within(document.querySelector('.ps-tray') as HTMLElement);

const quake: BranchSlotChoice = { kind: 'move', moveId: 'earthquake', moveName: 'Earthquake' };
const rotom: BranchSlotChoice = { kind: 'switch', speciesId: 'rotomwash', pokemonName: 'Rotom-Wash' };

describe('Execute waits for every slot (singles)', () => {
  test('both sides start empty; a tile and a bench tile report their picks; Execute names the missing side', async () => {
    const wired = props();
    const { rerender } = render(<TurnDock {...wired} />);
    expect(chip('P1')).toHaveTextContent('choose');
    expect(chip('P2')).toHaveTextContent('choose');
    expect(screen.getByRole('button', { name: 'Select P1 & P2 choice' })).toBeDisabled();

    await userEvent.click(chip('P1'));
    expect(tray().getByRole('button', { name: /Heatran/ })).toBeInTheDocument();
    await userEvent.click(tray().getByRole('button', { name: /Earthquake/ }));
    expect(wired.onSetChoice).toHaveBeenCalledWith('p1', quake, 0);
    await userEvent.click(chip('P2'));
    expect(tray().getByRole('button', { name: /Leech Seed/ })).toBeInTheDocument();
    await userEvent.click(tray().getByRole('button', { name: /Rotom-Wash/ }));
    expect(wired.onSetChoice).toHaveBeenLastCalledWith('p2', rotom, 0);

    rerender(<TurnDock {...wired} simState={simState('singles', { p1Choice: quake, p1Choices: [quake] })} />);
    expect(screen.getByRole('button', { name: 'Select P2 choice' })).toBeDisabled();
    expect(chip('P1')).toHaveTextContent('Earthquake');

    const ready = simState('singles', { p1Choice: quake, p1Choices: [quake], p2Choice: rotom, p2Choices: [rotom] });
    rerender(<TurnDock {...wired} simState={ready} />);
    await userEvent.click(screen.getByRole('button', { name: 'Execute Turn' }));
    expect(wired.onExecuteTurn).toHaveBeenCalledTimes(1);
    expect(wired.onExecuteTurn).toHaveBeenCalledWith({ p1: [quake], p2: [rotom] });
    rerender(<TurnDock {...wired} simState={ready} executing />);
    expect(screen.getByRole('button', { name: 'Executing…' })).toBeDisabled();
  });

  test('an ended position without a winner says so', () => {
    render(<TurnDock {...props({ simState: simState('singles', { ended: true, winner: null }) })} />);
    expect(screen.getByRole('status')).toHaveTextContent('The variation ended without a winner.');
  });

  test('a forced replacement hides Execute but keeps the execute error', () => {
    const forced = simState('singles', { p2ForceSwitch: true, p2ForceSwitches: [true] });
    render(<TurnDock {...props({ simState: forced, executeError: 'Garchomp is trapped and cannot switch' })} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Garchomp is trapped and cannot switch');
    expect(screen.queryByRole('button', { name: /Select|Execute/ })).toBeNull();
  });
});

describe('Execute waits for every slot (doubles)', () => {
  test('four empty chips; a tile sends its target with the slot index, a bench tile its slot', async () => {
    const wired = props({ simState: simState('doubles') });
    render(<TurnDock {...wired} />);
    expect([...document.querySelectorAll('.ps-dock-label')].map(label => label.textContent)).toEqual(['P1A', 'P1B', 'P2A', 'P2B']);
    expect(screen.getByRole('button', { name: 'Select all active choices' })).toBeDisabled();

    await userEvent.click(chip('P1A'));
    await userEvent.click(tray().getByRole('button', { name: /^Flare Blitz/ }));
    // without damage numbers the first listed foe is the preselected one
    expect(wired.onSetChoice).toHaveBeenCalledWith('p1', { kind: 'move', moveId: 'flareblitz', moveName: 'Flare Blitz', targetLoc: 1 }, 0);
    await userEvent.click(chip('P1B'));
    await userEvent.click(tray().getByRole('button', { name: /^Spore/ }));
    expect(wired.onSetChoice).toHaveBeenLastCalledWith('p1', { kind: 'move', moveId: 'spore', moveName: 'Spore', targetLoc: 1 }, 1);
    await userEvent.click(chip('P2B'));
    await userEvent.click(tray().getByRole('button', { name: /Kingambit/ }));
    expect(wired.onSetChoice).toHaveBeenLastCalledWith('p2', { kind: 'switch', speciesId: 'kingambit', pokemonName: 'Kingambit' }, 1);
  });

  test('a switch-in reserved by one slot is selected there and blocked in the other', async () => {
    const reserve = { kind: 'switch' as const, speciesId: 'fluttermane', pokemonName: 'Flutter Mane' };
    render(<TurnDock {...props({ simState: simState('doubles', { p1Choices: [reserve, null] }) })} />);
    expect(chip('P1A')).toHaveTextContent('→ Flutter Mane');
    await userEvent.click(chip('P1A'));
    expect(tray().getByRole('button', { name: /Flutter Mane/ })).toHaveClass('ps-switchbtn-selected');
    await userEvent.click(chip('P1B'));
    expect(tray().getByRole('button', { name: /Flutter Mane/ })).toBeDisabled();
    expect(tray().getByRole('button', { name: /Urshifu/ })).toBeEnabled();
  });
});

describe('what the viewed line played', () => {
  test('singles: the played move and the played bench body carry the played flag in their trays', async () => {
    const played = { p1: { kind: 'move' as const, name: 'Earthquake' }, p2: { kind: 'switch' as const, name: 'Rotom-Wash', species: 'Rotom-Wash' } };
    render(<TurnDock {...props({ source: 'snapshot', acquiringExact: true, played })} />);
    await userEvent.click(chip('P1'));
    expect(tray().getByRole('button', { name: /Earthquake/ })).toHaveTextContent('played');
    expect(tray().getByRole('button', { name: /Stone Edge/ })).not.toHaveTextContent('played');
    await userEvent.click(chip('P2'));
    expect(tray().getByRole('button', { name: /Rotom-Wash/ })).toHaveTextContent('played');
    expect(tray().getByRole('button', { name: /Excadrill/ })).not.toHaveTextContent('played');
  });

  test('doubles: each slot flags what that slot played', async () => {
    const played = {
      p1: null, p2: null,
      p1Slots: [{ kind: 'move' as const, name: 'Fake Out' }, { kind: 'move' as const, name: 'Spore' }],
      p2Slots: [{ kind: 'switch' as const, name: 'Kingambit', species: 'Kingambit' }, null],
    };
    render(<TurnDock {...props({ simState: simState('doubles'), played })} />);
    await userEvent.click(chip('P1A'));
    expect(tray().getByRole('button', { name: /Fake Out/ })).toHaveTextContent('played');
    expect(tray().getByRole('button', { name: /Flare Blitz/ })).not.toHaveTextContent('played');
    await userEvent.click(chip('P1B'));
    expect(tray().getByRole('button', { name: /Spore/ })).toHaveTextContent('played');
    await userEvent.click(chip('P2A'));
    expect(tray().getByRole('button', { name: /Kingambit/ })).toHaveTextContent('played');
    await userEvent.click(chip('P2B'));
    expect(tray().queryByText('played')).toBeNull();
  });
});

describe('the states of a slot', () => {
  test('a picked switch-in is selected, and the rest of the bench stays open', async () => {
    const base = simState('singles');
    const pending = { kind: 'switch' as const, speciesId: 'latias', pokemonName: 'Latias' };
    const state = { ...base, p1Choices: [pending], p1Choice: pending };
    render(<TurnDock {...props({ simState: state })} />);
    expect(chip('P1')).toHaveTextContent('→ Latias');
    await userEvent.click(chip('P1'));
    expect(tray().getByRole('button', { name: /Latias/ })).toBeEnabled();
    expect(tray().getByRole('button', { name: /Latias/ })).toHaveClass('ps-switchbtn-selected');
    expect(tray().getByRole('button', { name: /Heatran/ })).toBeEnabled();
  });

  test('a trapped Pokemon has its bench disabled with the reason, and its moves stay live', async () => {
    const base = simState('singles');
    const trapped = base.p1SwitchesBySlot.map(bench => bench.map(sw => ({ ...sw, trapped: true })));
    render(<TurnDock {...props({ simState: { ...base, p1SwitchesBySlot: trapped } })} />);
    await userEvent.click(chip('P1'));
    for (const sw of trapped[0]) {
      const tile = tray().getByRole('button', { name: new RegExp(sw.species) });
      expect(tile).toBeDisabled();
      expect(tile).toHaveAttribute('title', 'Garchomp is trapped and cannot switch out this turn.');
    }
    expect(tray().getByRole('button', { name: /Earthquake/ })).toBeEnabled();
  });

  test('a forced replacement asks for a body: "fainted" for a fallen one, "switching out" for a pivot', () => {
    const base = simState('singles');
    const fallen = base.p1ActiveSlots.map(active => ({ ...active!, fainted: true, hp: 0, hpPercent: 0 }));
    const { rerender } = render(<TurnDock {...props({ simState: { ...base, p1ForceSwitch: true, p1ForceSwitches: [true], p1ActiveSlots: fallen } })} />);
    expect(screen.getByText('Garchomp fainted! Choose who to send in:')).toBeInTheDocument();
    rerender(<TurnDock {...props({ simState: { ...base, p1ForceSwitch: true, p1ForceSwitches: [true] } })} />);
    expect(screen.getByText('Garchomp is switching out. Choose who to send in:')).toBeInTheDocument();
  });

  test('doubles: a fainted slot with nobody left to send in has a disabled chip that says so; its partner plays on', () => {
    const base: BranchSimState = simState('doubles');
    const downed = pokemon('Incineroar', { fainted: true, hp: 0, hpPercent: 0, isActive: true, activeSlot: 0 });
    const state: BranchSimState = {
      ...base, p1ActiveSlots: [downed, base.p1ActiveSlots[1]], p1MovesBySlot: [[], base.p1MovesBySlot[1]], p1SwitchesBySlot: [[], base.p1SwitchesBySlot[1]],
    };
    render(<TurnDock {...props({ simState: state })} />);
    expect(chip('P1A')).toBeDisabled();
    expect(chip('P1A')).toHaveTextContent('fainted · no one left');
    expect(chip('P1B')).toBeEnabled();
  });
});

// Round 77, B5: P1 clicked Tailwind while P2 had to replace a Chien-Pao, and the pick rode into the next turn.
describe('the side that does not replace takes no input (B5)', () => {
  const down = (side: 'p1' | 'p2') => ({ [`${side}ForceSwitch`]: true, [`${side}ForceSwitches`]: [true, false] });

  test('singles: P2 replaces, so the P1 chip is inert and the strip says whom it waits for', () => {
    render(<TurnDock {...props({ simState: simState('singles', { p2ForceSwitch: true, p2ForceSwitches: [true] }) })} />);
    expect(chip('P1')).toHaveAttribute('inert');
    expect(screen.getByText('Waiting for P2 to choose a replacement.')).toBeInTheDocument();
    expect(chip('P2')).not.toHaveAttribute('inert');
  });

  test('doubles: one side replaces, the other waits; both replacing leaves both live', () => {
    const { rerender } = render(<TurnDock {...props({ simState: simState('doubles', down('p2')) })} />);
    expect(chip('P1A')).toHaveAttribute('inert');
    expect(chip('P1B')).toHaveAttribute('inert');
    expect(screen.getByText('Waiting for P2 to choose a replacement.')).toBeInTheDocument();
    rerender(<TurnDock {...props({ simState: simState('doubles', down('p1')) })} />);
    expect(chip('P2A')).toHaveAttribute('inert');
    expect(screen.getByText('Waiting for P1 to choose a replacement.')).toBeInTheDocument();
    rerender(<TurnDock {...props({ simState: simState('doubles', { ...down('p1'), ...down('p2') }) })} />);
    expect(chip('P1A')).not.toHaveAttribute('inert');
    expect(chip('P2A')).not.toHaveAttribute('inert');
    expect(screen.queryByText(/Waiting for/)).toBeNull();
  });

  // Round 84 (A7f): the partner of a forced replacement is asked nothing, so its chip takes the waiting side's state (user's own test,
  // Champions VGC: P2B fainted and P2A stood live though the position asked nothing of it).
  test('doubles: the partner of the one forced slot takes no input, the forced slot stays live', () => {
    const { rerender } = render(<TurnDock {...props({ simState: simState('doubles', down('p2')) })} />);
    expect(chip('P2A')).not.toHaveAttribute('inert');
    expect(chip('P2B')).toHaveAttribute('inert');
    expect(chip('P1A')).toHaveAttribute('inert');
    rerender(<TurnDock {...props({ simState: simState('doubles', { ...down('p1'), ...down('p2') }) })} />);
    expect(chip('P1A')).not.toHaveAttribute('inert');
    expect(chip('P2A')).not.toHaveAttribute('inert');
    expect(chip('P1B')).toHaveAttribute('inert');
    expect(chip('P2B')).toHaveAttribute('inert');
  });

  test('doubles: both slots of a side forced, both chips stay live (16a); singles: the forced chip stays live', () => {
    const { rerender } = render(<TurnDock {...props({ simState: simState('doubles', { p2ForceSwitch: true, p2ForceSwitches: [true, true] }) })} />);
    expect(chip('P2A')).not.toHaveAttribute('inert');
    expect(chip('P2B')).not.toHaveAttribute('inert');
    rerender(<TurnDock {...props({ simState: simState('singles', { p2ForceSwitch: true, p2ForceSwitches: [true] }) })} />);
    expect(chip('P2')).not.toHaveAttribute('inert');
  });

  test('a normal turn leaves both sides live', () => {
    render(<TurnDock {...props()} />);
    expect(chip('P1')).not.toHaveAttribute('inert');
    expect(chip('P2')).not.toHaveAttribute('inert');
  });
});
