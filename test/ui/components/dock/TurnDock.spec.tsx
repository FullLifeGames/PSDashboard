import { useState } from 'react';
import { describe, expect, test, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { BranchSimState, BranchSlotChoice } from '@fulllifegames/eval-engine';
import { TurnDock } from '../../../../src/components/dock/TurnDock';
import { mergeChoices, seedChoices } from '../../../../src/lib/dock-seed';
import type { PlayedAtPosition } from '../../../../src/lib/played-pick';
import { simState } from '../../fixtures/sim-state';

// The legal move pool is heavy dex data; a fixed pool keeps the what-if row deterministic here.
vi.mock('../../../../src/lib/pokemon-options', () => ({ getMovePool: async () => ['Dragon Claw', 'Fire Fang'] }));

/**
 * Round 84 (turn dock): the dock beside the old panel. A harness plays the part of the picker hook: the seed sits under the
 * user's picks, and a pick the dock reports replaces its slot's choice, as `mergeChoices(seed, draft)` does in the app.
 */
type Props = Parameters<typeof TurnDock>[0];
type Sides = { p1: (BranchSlotChoice | null)[]; p2: (BranchSlotChoice | null)[] };

const DOUBLES_PLAYED: PlayedAtPosition = {
  p1: null, p2: null,
  p1Slots: [{ kind: 'move', name: 'Fake Out', targetLoc: 2 }, { kind: 'move', name: 'Spore' }],
  p2Slots: [{ kind: 'switch', name: 'Kingambit', species: 'Kingambit' }, null],
};

function Harness({ base, played, spies }: { base: BranchSimState; played: PlayedAtPosition; spies: Partial<Props> }) {
  const [draft, setDraft] = useState<Sides>({ p1: base.p1Choices.map(() => null), p2: base.p2Choices.map(() => null) });
  const seed = seedChoices(played, base);
  const effective = mergeChoices(seed, draft);
  const state = { ...base, p1Choices: effective.p1, p2Choices: effective.p2, p1Choice: effective.p1[0] ?? null, p2Choice: effective.p2[0] ?? null };
  return (
    <TurnDock
      simState={state} seed={seed} played={played} executeError={null} executing={false} gen={9}
      onSetChoice={(side, choice, slot = 0) => {
        spies.onSetChoice?.(side, choice, slot);
        setDraft(current => ({ ...current, [side]: current[side].map((held, index) => (index === slot ? choice : held)) }));
      }}
      onHypotheticalMove={vi.fn()} onExecuteTurn={spies.onExecuteTurn ?? vi.fn()}
    />
  );
}

const chip = (label: string) => screen.getByRole('button', { name: new RegExp(`^${label}\\b`) });
const tray = () => within(document.querySelector('.ps-tray') as HTMLElement);

describe('TurnDock, doubles', () => {
  test('a seeded position shows one chip per slot with the played choice and its origin', () => {
    render(<Harness base={simState('doubles')} played={DOUBLES_PLAYED} spies={{}} />);
    expect(chip('P1A')).toHaveTextContent('Fake Out → P2B');
    expect(chip('P1A')).toHaveAttribute('data-origin', 'played');
    expect(chip('P1B')).toHaveTextContent('Spore');
    expect(chip('P2A')).toHaveTextContent('→ Kingambit');
    expect(chip('P2A')).toHaveAttribute('data-origin', 'played');
    expect(document.querySelectorAll('.ps-dock-chip')).toHaveLength(4);
    expect([...document.querySelectorAll('.ps-dock-row')].map(row => row.querySelectorAll('.ps-dock-chip').length)).toEqual([2, 2]);
  });

  test('a chip click opens the tray of that slot, a second click closes it', async () => {
    render(<Harness base={simState('doubles')} played={DOUBLES_PLAYED} spies={{}} />);
    expect(chip('P1A')).toHaveAttribute('aria-expanded', 'false');
    expect(document.querySelector('.ps-tray')).toBeNull();
    await userEvent.click(chip('P1A'));
    expect(chip('P1A')).toHaveAttribute('aria-expanded', 'true');
    expect(tray().getByRole('button', { name: /Flare Blitz/ })).toBeInTheDocument();
    expect(tray().getByRole('button', { name: /Flutter Mane/ })).toBeInTheDocument();
    await userEvent.click(chip('P1B'));
    expect(chip('P1A')).toHaveAttribute('aria-expanded', 'false');
    expect(chip('P1B')).toHaveAttribute('aria-expanded', 'true');
    await userEvent.click(chip('P1B'));
    expect(document.querySelector('.ps-tray')).toBeNull();
  });

  test('a tile click replaces the slot choice, and the chip drops its played origin', async () => {
    const onSetChoice = vi.fn();
    render(<Harness base={simState('doubles')} played={DOUBLES_PLAYED} spies={{ onSetChoice }} />);
    await userEvent.click(chip('P1A'));
    await userEvent.click(tray().getByRole('button', { name: /Flare Blitz/ }));
    expect(onSetChoice).toHaveBeenCalledWith('p1', expect.objectContaining({ kind: 'move', moveId: 'flareblitz', targetLoc: expect.any(Number) }), 0);
    expect(chip('P1A')).toHaveTextContent('Flare Blitz');
    expect(chip('P1A')).not.toHaveAttribute('data-origin', 'played');
    // the other slots keep their seed
    expect(chip('P1B')).toHaveAttribute('data-origin', 'played');
  });

  test('Execute sends the effective choices: the seed under the picks', async () => {
    const onExecuteTurn = vi.fn();
    render(<Harness base={simState('doubles')} played={DOUBLES_PLAYED} spies={{ onExecuteTurn }} />);
    // the slot nothing was logged for gets its pick first, so the turn is ready
    expect(screen.getByRole('button', { name: 'Select all active choices' })).toBeDisabled();
    await userEvent.click(chip('P2B'));
    await userEvent.click(tray().getByRole('button', { name: /Taunt/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Execute Turn' }));
    expect(onExecuteTurn).toHaveBeenCalledTimes(1);
    const sent = onExecuteTurn.mock.calls[0][0] as Sides;
    expect(sent.p1.map(choice => (choice?.kind === 'move' ? choice.moveId : choice?.kind))).toEqual(['fakeout', 'spore']);
    expect(sent.p1[0]).toMatchObject({ targetLoc: 2 });
    expect(sent.p2[0]).toMatchObject({ kind: 'switch', speciesId: 'kingambit' });
    expect(sent.p2[1]).toMatchObject({ kind: 'move', moveId: 'taunt' });
  });

  test('a slot without a logged action reads "no logged move · choose", and Execute waits for it', () => {
    render(<Harness base={simState('doubles')} played={DOUBLES_PLAYED} spies={{}} />);
    expect(chip('P2B')).toHaveTextContent('no logged move · choose');
    expect(chip('P2B')).not.toHaveAttribute('data-origin', 'played');
    expect(screen.getByRole('button', { name: 'Select all active choices' })).toBeDisabled();
  });
});

describe('TurnDock, singles', () => {
  const played: PlayedAtPosition = { p1: { kind: 'move', name: 'Earthquake' }, p2: { kind: 'switch', name: 'Rotom-Wash', species: 'Rotom-Wash' } };

  test('one row holds both chips, and Execute is ready when both sides are seeded', async () => {
    const onExecuteTurn = vi.fn();
    render(<Harness base={simState('singles')} played={played} spies={{ onExecuteTurn }} />);
    expect([...document.querySelectorAll('.ps-dock-row')].map(row => row.querySelectorAll('.ps-dock-chip').length)).toEqual([2]);
    expect(chip('P1')).toHaveTextContent('Earthquake');
    expect(chip('P2')).toHaveTextContent('→ Rotom-Wash');
    await userEvent.click(screen.getByRole('button', { name: 'Execute Turn' }));
    await waitFor(() => expect(onExecuteTurn).toHaveBeenCalledTimes(1));
    expect(onExecuteTurn.mock.calls[0][0]).toMatchObject({ p1: [{ moveId: 'earthquake' }], p2: [{ kind: 'switch', speciesId: 'rotomwash' }] });
  });
});
