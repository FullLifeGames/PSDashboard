import { describe, expect, test, vi } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { BranchSimState, BranchSlotChoice } from '@fulllifegames/eval-engine';
import { TurnDock } from '../../../../src/components/dock/TurnDock';
import { pokemon, simState, NO_MODIFIERS } from '../../fixtures/sim-state';
import { seedChoices } from '../../../../src/lib/dock-seed';
import type { PlayedAtPosition } from '../../../../src/lib/played-pick';

vi.mock('../../../../src/lib/pokemon-options', () => ({ getMovePool: async () => ['Dragon Claw', 'Fire Fang'] }));

describe('TurnDock.choices', () => {
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

  describe.each(['singles', 'doubles'] as const)('a forced replacement that is going out (%s)', type => {
    test('the chip shows the clicked body and Execute reads "Executing..."', () => {
      const forced = simState(type, {
        p1ForceSwitch: true, p1ForceSwitches: type === 'singles' ? [true] : [true, false],
        p1Choice: rotom, p1Choices: [rotom],
      });
      render(<TurnDock {...props({ simState: forced, executing: true })} />);
      expect(chip(type === 'singles' ? 'P1' : 'P1A')).toHaveTextContent('Rotom-Wash');
      expect(chip(type === 'singles' ? 'P1' : 'P1A')).not.toHaveTextContent('choose');
      expect(screen.getByRole('button', { name: 'Executing…' })).toBeDisabled();
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

    test('doubles: a fainted slot that is not asked, beside a partner that must switch out, waits for the switch instead of claiming an empty bench', () => {
      const base: BranchSimState = simState('doubles');
      const downed = pokemon('Urshifu', { fainted: true, hp: 0, hpPercent: 0, isActive: true, activeSlot: 0 });
      const state: BranchSimState = {
        ...base, p1ForceSwitch: true, p1ForceSwitches: [false, true], p1ActiveSlots: [downed, base.p1ActiveSlots[1]], p1MovesBySlot: [[], base.p1MovesBySlot[1]],
        p1SwitchesBySlot: [[], base.p1SwitchesBySlot[1]],
      };
      render(<TurnDock {...props({ simState: state })} />);
      expect(chip('P1A')).toBeDisabled();
      expect(chip('P1A')).toHaveTextContent('fainted · waits for the switch');
      expect(chip('P1A')).not.toHaveTextContent('no one left');
    });
  });

  describe('the side that does not replace takes no input', () => {
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
});

type Props = Parameters<typeof TurnDock>[0];

const move = (moveId: string, moveName: string, extra: object = {}): BranchSlotChoice => ({ kind: 'move', moveId, moveName, ...extra });

function props(overrides: Partial<Props> = {}): Props {
  return {
    simState: simState('doubles'), executeError: null, executing: false, gen: 9,
    onSetChoice: vi.fn(), onHypotheticalMove: vi.fn(), onExecuteTurn: vi.fn(), ...overrides,
  };
}

const chip = (label: string) => screen.getByRole('button', { name: new RegExp(`^${label}\\b`) });
const tray = () => within(document.querySelector('.ps-tray') as HTMLElement);

function seededDoubles(overrides: Partial<BranchSimState> = {}): BranchSimState {
  const base = simState('doubles');
  const modifiers = [{ ...NO_MODIFIERS, teraType: 'Fire' }, { ...NO_MODIFIERS, teraType: 'Grass' }];
  const p1Choices = [move('flareblitz', 'Flare Blitz', { targetLoc: 2 }), move('spore', 'Spore')];
  return { ...base, p1ModifiersBySlot: modifiers, p1Choices, p1Choice: p1Choices[0], ...overrides };
}

describe('the tray of a slot', () => {
  test('the gimmick toggle edits the slot\'s pending move and the chip says so', async () => {
    const onSetChoice = vi.fn();
    render(<TurnDock {...props({ simState: seededDoubles(), onSetChoice })} />);
    await userEvent.click(chip('P1A'));
    await userEvent.click(within(screen.getByRole('group', { name: 'Battle gimmicks for P1A' })).getByRole('button', { name: 'Tera (Fire)' }));
    expect(onSetChoice).toHaveBeenCalledWith('p1', move('flareblitz', 'Flare Blitz', { targetLoc: 2, modifier: 'terastallize' }), 0);
  });

  test('a pending Tera shows pressed and rides on the next tile', async () => {
    const onSetChoice = vi.fn();
    const tera = [move('flareblitz', 'Flare Blitz', { targetLoc: 2, modifier: 'terastallize' }), move('spore', 'Spore')];
    render(<TurnDock {...props({ simState: seededDoubles({ p1Choices: tera, p1Choice: tera[0] }), onSetChoice })} />);
    expect(chip('P1A')).toHaveTextContent('Flare Blitz → P2B · Tera');
    await userEvent.click(chip('P1A'));
    expect(screen.getByRole('button', { name: 'Tera (Fire)' })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(tray().getByRole('button', { name: /Fake Out/ }));
    expect(onSetChoice).toHaveBeenCalledWith('p1', expect.objectContaining({ moveId: 'fakeout', modifier: 'terastallize' }), 0);
  });

  test('the played move carries a played flag, the pending move is pressed and shows its targets', async () => {
    const played: PlayedAtPosition = { p1: null, p2: null, p1Slots: [{ kind: 'move', name: 'Fake Out', targetLoc: 2 }, null], p2Slots: [null, null] };
    render(<TurnDock {...props({ simState: seededDoubles(), played })} />);
    await userEvent.click(chip('P1A'));
    const tiles = tray();
    expect(tiles.getByRole('button', { name: /Fake Out/ })).toHaveTextContent('played');
    expect(tiles.getByRole('button', { name: /Flare Blitz/ })).not.toHaveTextContent('played');
    expect(tiles.getByRole('button', { name: /Flare Blitz/ })).toHaveClass('ps-movebtn-selected');
    expect(tiles.getByRole('button', { name: /Flare Blitz/ })).toHaveAttribute('aria-pressed', 'true');
    expect(tiles.getByTitle('Flare Blitz into Tornadus (100%)')).toHaveClass('ps-target-btn-selected');
    expect(tiles.getByTitle('Flare Blitz into Rillaboom (100%)')).not.toHaveClass('ps-target-btn-selected');
  });

  test('a target press moves the pick to that target and keeps the move', async () => {
    const onSetChoice = vi.fn();
    render(<TurnDock {...props({ simState: seededDoubles(), onSetChoice })} />);
    await userEvent.click(chip('P1A'));
    await userEvent.click(tray().getByTitle('Flare Blitz into Rillaboom (100%)'));
    expect(onSetChoice).toHaveBeenCalledWith('p1', move('flareblitz', 'Flare Blitz', { targetLoc: 1 }), 0);
  });

  test('an unpicked move takes a target of its own on the first click', async () => {
    const onSetChoice = vi.fn();
    render(<TurnDock {...props({ onSetChoice })} />);
    await userEvent.click(chip('P1B'));
    await userEvent.click(tray().getByRole('button', { name: /Pollen Puff/ }));
    expect(onSetChoice).toHaveBeenCalledWith('p1', expect.objectContaining({ moveId: 'pollenpuff', targetLoc: expect.any(Number) }), 1);
  });

  test('a switch-in the partner holds is blocked, and a bench pick is sent with the slot', async () => {
    const onSetChoice = vi.fn();
    const reserve = { kind: 'switch' as const, speciesId: 'fluttermane', pokemonName: 'Flutter Mane' };
    render(<TurnDock {...props({ simState: simState('doubles', { p1Choices: [reserve, null] }), onSetChoice })} />);
    await userEvent.click(chip('P1B'));
    expect(tray().getByRole('button', { name: /Flutter Mane/ })).toBeDisabled();
    await userEvent.click(tray().getByRole('button', { name: /Urshifu/ }));
    expect(onSetChoice).toHaveBeenCalledWith('p1', { kind: 'switch', speciesId: 'urshifu', pokemonName: 'Urshifu' }, 1);
  });

  test('Dice · What if opens the dice, the What-if loader and all choices; Load move hands the move over and closes the tray', async () => {
    const onHypotheticalMove = vi.fn();
    render(<TurnDock {...props({ simState: seededDoubles(), onHypotheticalMove })} />);
    await userEvent.click(chip('P1A'));
    expect(screen.queryByLabelText('Choice picker for P1A')).toBeNull();
    await userEvent.click(tray().getByRole('button', { name: /Dice · What if/ }));
    expect(tray().getByRole('button', { name: /Dice · What if/ })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByLabelText('Choice picker for P1A')).toBeInTheDocument();
    await userEvent.type(await screen.findByLabelText('Hypothetical move for P1A'), 'Dragon Claw');
    await userEvent.click(screen.getByRole('button', { name: 'Load move' }));
    expect(onHypotheticalMove).toHaveBeenCalledWith('p1', 0, { species: 'Incineroar', move: 'Dragon Claw', replace: 'Protect' });
    expect(document.querySelector('.ps-tray')).toBeNull();
  });

  test('Done and Escape close the tray and put the focus back on the chip', async () => {
    render(<TurnDock {...props({ simState: seededDoubles() })} />);
    await userEvent.click(chip('P1A'));
    await userEvent.click(tray().getByRole('button', { name: 'Done' }));
    expect(document.querySelector('.ps-tray')).toBeNull();
    expect(chip('P1A')).toHaveFocus();
    await userEvent.click(chip('P1B'));
    await userEvent.keyboard('{Escape}');
    expect(document.querySelector('.ps-tray')).toBeNull();
    expect(chip('P1B')).toHaveFocus();
  });

  test('Execute closes the tray', async () => {
    const onExecuteTurn = vi.fn();
    const full = seededDoubles({ p2Choices: [move('woodhammer', 'Wood Hammer', { targetLoc: -1 }), move('taunt', 'Taunt', { targetLoc: 1 })] });
    render(<TurnDock {...props({ simState: full, onExecuteTurn })} />);
    await userEvent.click(chip('P1A'));
    await userEvent.click(screen.getByRole('button', { name: 'Execute Turn' }));
    expect(document.querySelector('.ps-tray')).toBeNull();
    expect(onExecuteTurn).toHaveBeenCalledTimes(1);
  });
});

describe('the states of a position', () => {
  test('a forced replacement: the slot asks for a body, the tray shows the bench only, and Execute is gone', async () => {
    const forced = simState('singles', { p2ForceSwitch: true, p2ForceSwitches: [true] });
    const onSetChoice = vi.fn();
    render(<TurnDock {...props({ simState: forced, onSetChoice })} />);
    expect(screen.getByText('Ferrothorn is switching out. Choose who to send in:')).toBeInTheDocument();
    expect(chip('P2')).toHaveTextContent('choose a replacement');
    expect(screen.queryByRole('button', { name: /Select|Execute/ })).toBeNull();
    await userEvent.click(chip('P2'));
    expect(tray().queryByRole('button', { name: /Leech Seed/ })).toBeNull();
    expect(tray().queryByRole('button', { name: /Dice · What if/ })).toBeNull();
    await userEvent.click(tray().getByRole('button', { name: /Rotom-Wash/ }));
    expect(onSetChoice).toHaveBeenCalledWith('p2', { kind: 'switch', speciesId: 'rotomwash', pokemonName: 'Rotom-Wash' }, 0);
  });

  test('the side that does not replace takes no input, and the strip names who it waits for', () => {
    const down = (side: 'p1' | 'p2') => ({ [`${side}ForceSwitch`]: true, [`${side}ForceSwitches`]: [true, false] });
    render(<TurnDock {...props({ simState: simState('doubles', down('p2')) })} />);
    expect(screen.getByText('Waiting for P2 to choose a replacement.')).toBeInTheDocument();
    expect(chip('P1A').closest('button')).toHaveAttribute('inert');
    expect(chip('P1B')).toHaveAttribute('inert');
    expect(chip('P2A')).not.toHaveAttribute('inert');
  });

  test('a stale position (the last one shown while the viewed one resolves) takes no input', () => {
    const { container, rerender } = render(<TurnDock {...props({ stale: true })} />);
    const root = container.firstElementChild as HTMLElement;
    expect(root).toHaveAttribute('inert');
    expect(root).toHaveAttribute('aria-busy', 'true');
    rerender(<TurnDock {...props()} />);
    expect(root).not.toHaveAttribute('inert');
  });

  test('an ended position names the winner where the chips were; nothing renders without a position', () => {
    const { container, rerender } = render(<TurnDock {...props({ simState: null })} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<TurnDock {...props({ simState: simState('singles', { ended: true, winner: 'Bene' }) })} />);
    expect(screen.getByRole('status')).toHaveTextContent('Bene wins this variation.');
    expect(document.querySelector('.ps-dock-chip')).toBeNull();
    expect(screen.queryByRole('button', { name: /Select|Execute/ })).toBeNull();
  });

  test('the end of a game is the game\'s own: it names the winner as won the game, not as a variation', () => {
    const live = simState('singles', { ended: true, winner: 'Bene' });
    const { rerender } = render(<TurnDock {...props({ simState: live, endOfGame: { winner: 'Bene' } })} />);
    expect(screen.getByRole('status')).toHaveTextContent('Bene won the game. Go back a turn to play it another way.');
    expect(screen.queryByText(/variation/)).toBeNull();
    rerender(<TurnDock {...props({ simState: simState('doubles'), endOfGame: { winner: null } })} />);
    expect(screen.getByRole('status')).toHaveTextContent('The game ended without a winner. Go back a turn to play it another way.');
    expect(screen.queryByRole('button', { name: /Select|Execute/ })).toBeNull();
    expect(document.querySelector('.ps-dock-chip')).toBeNull();
  });

  test.each([['singles'], ['doubles']] as const)('the end of a replay (%s) reads "<winner> won the battle!" with no dock to play', kind => {
    const { rerender } = render(<TurnDock {...props({ simState: simState(kind), endOfGame: { winner: 'Bene', battle: true } })} />);
    expect(screen.getByRole('status')).toHaveTextContent('Bene won the battle! Go back a turn to play it another way.');
    expect(screen.queryByText(/won the game|variation/)).toBeNull();
    expect(screen.queryByRole('button', { name: /Select|Execute/ })).toBeNull();
    expect(document.querySelector('.ps-dock-chip')).toBeNull();
    rerender(<TurnDock {...props({ simState: simState(kind), endOfGame: { winner: null, battle: true } })} />);
    expect(screen.getByRole('status')).toHaveTextContent('The battle ended in a tie. Go back a turn to play it another way.');
  });

  test.each([['singles'], ['doubles']] as const)('the strip names the setting while "Opponent reads my move" is on, with a button that turns it off (%s)', async kind => {
    const onOpponentReadsChange = vi.fn();
    const { rerender } = render(<TurnDock {...props({ simState: simState(kind), source: 'stored' })} />);
    expect(screen.queryByText('Opponent reads your move')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Turn off' })).toBeNull();
    rerender(<TurnDock {...props({ simState: simState(kind), source: 'stored', opponentReads: true, onOpponentReadsChange })} />);
    const note = screen.getByText('Opponent reads your move');
    expect(note).toHaveClass('ps-dock-source');
    expect(note).toHaveAttribute('title', 'The opponent\'s engine picks answer yours with the reply the search rates lowest for your pick. Setup ▾ holds this setting.');
    const strip = note.closest('.ps-dock-status') as HTMLElement;
    expect(strip.firstElementChild).toBe(note);
    expect(note.nextElementSibling).toBe(screen.getByRole('button', { name: 'Turn off' }));
    expect(screen.getByRole('button', { name: 'Turn off' })).toHaveClass('ps-btn');
    expect(strip).toHaveTextContent(/^Opponent reads your moveTurn offChoices from the reconstructed position$/);
    await userEvent.click(screen.getByRole('button', { name: 'Turn off' }));
    expect(onOpponentReadsChange).toHaveBeenCalledWith(false);
    expect(document.querySelectorAll('.ps-dock-chip')).toHaveLength(kind === 'doubles' ? 4 : 2);
  });

  test('a game\'s dock speaks of the game, not of a replay', () => {
    const { rerender } = render(<TurnDock {...props({ source: 'stored', isGame: true })} />);
    expect(screen.getByText('Choices from the game\'s position')).toBeInTheDocument();
    rerender(<TurnDock {...props({ source: 'snapshot', isGame: true })} />);
    expect(screen.getByText('Choices approximated from the game\'s log; the sim checks legality when you play a move')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/replay|reconstructed/);
  });

  test('the strip shows the source, the dice wait note, the execute error and the running turn', async () => {
    const { rerender } = render(<TurnDock {...props({ source: 'stored' })} />);
    expect(screen.getByText('Choices from the reconstructed position')).toBeInTheDocument();
    rerender(<TurnDock {...props({ source: 'snapshot', acquiringExact: true, executeError: 'Invalid choice: Garchomp is trapped' })} />);
    expect(screen.getByText('Choices approximated · reconstructing the exact position…')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Invalid choice: Garchomp is trapped');
    expect(screen.queryByRole('note')).toBeNull();
    await userEvent.click(chip('P1A'));
    await userEvent.click(tray().getByRole('button', { name: /Dice · What if/ }));
    await waitFor(() => expect(screen.getByRole('note')).toHaveTextContent('Dice need the exact position.'));
    const ready = simState('singles', {
      p1Choices: [move('earthquake', 'Earthquake')], p1Choice: move('earthquake', 'Earthquake'),
      p2Choices: [move('leechseed', 'Leech Seed')], p2Choice: move('leechseed', 'Leech Seed'),
    });
    rerender(<TurnDock {...props({ simState: ready, executing: true })} />);
    expect(screen.getByRole('button', { name: 'Executing…' })).toBeDisabled();
  });

  test('a seed that the picker cannot offer leaves the chip empty and names the played move', () => {
    const played: PlayedAtPosition = { p1: { kind: 'move', name: 'Rock Slide' }, p2: null };
    const base = simState('singles');
    render(<TurnDock {...props({ simState: base, played, seed: seedChoices(played, base) })} />);
    expect(chip('P1')).toHaveTextContent('played: Rock Slide · choose');
    expect(chip('P2')).toHaveTextContent('no logged move · choose');
  });
});
