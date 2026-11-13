import { describe, expect, test, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { BranchSimState, BranchSlotChoice } from '@fulllifegames/eval-engine';
import { TurnDock } from '../../../../src/components/dock/TurnDock';
import { seedChoices } from '../../../../src/lib/dock-seed';
import type { PlayedAtPosition } from '../../../../src/lib/played-pick';
import { NO_MODIFIERS, simState } from '../../fixtures/sim-state';

// The legal move pool is heavy dex data; a fixed pool keeps the what-if row deterministic here.
vi.mock('../../../../src/lib/pokemon-options', () => ({ getMovePool: async () => ['Dragon Claw', 'Fire Fang'] }));

/** Round 84 (turn dock): the open tray, the strip, and the states a position can be in. */
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

/** A doubles position where both own slots hold a move pick (as the seed would), P1A with a Fire Tera type. */
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

  test('the end of a game is the game\'s own: it names the winner as won the game, not as a variation (H4h)', () => {
    const live = simState('singles', { ended: true, winner: 'Bene' });
    const { rerender } = render(<TurnDock {...props({ simState: live, endOfGame: { winner: 'Bene' } })} />);
    expect(screen.getByRole('status')).toHaveTextContent('Bene won the game. Go back a turn to play it another way.');
    expect(screen.queryByText(/variation/)).toBeNull();
    // the reopened game has no live sim at its end: the picker shows a position that cannot be played
    rerender(<TurnDock {...props({ simState: simState('doubles'), endOfGame: { winner: null } })} />);
    expect(screen.getByRole('status')).toHaveTextContent('The game ended without a winner. Go back a turn to play it another way.');
    expect(screen.queryByRole('button', { name: /Select|Execute/ })).toBeNull();
    expect(document.querySelector('.ps-dock-chip')).toBeNull();
  });

  test('a game\'s dock speaks of the game, not of a replay (H4h)', () => {
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
