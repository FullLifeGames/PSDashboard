import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SetupMenu } from '../../../src/components/SetupMenu';
import { DockStatus } from '../../../src/components/dock/DockStatus';
import { exploreTitle } from '../../../src/components/eval/turn-copy';
import type { DockModel } from '../../../src/components/dock/dock-model';

/**
 * Round 89 (ruling 49): with the flag VITE_FEATURE_OPPONENT_READS off (the default of every build), the Setup menu has no checkbox
 * "Opponent reads my move", the dock has no note "Opponent reads your move" with "Turn off", and no title names the reply rule, even
 * when the caller still passes the setting as on (the stored hardMode of an earlier nightly). The two components do not depend on the
 * game type; the dock row runs on both models only through its empty slot lists.
 */
beforeEach(() => vi.stubEnv('VITE_FEATURE_OPPONENT_READS', ''));
afterEach(() => vi.unstubAllEnvs());

describe('Setup menu with the flag off', () => {
  test.each([[false], [true]])('no checkbox for the reply rule (setting passed as %s); the other entries stay', async passed => {
    render(
      <SetupMenu animateBranchTurns={false} onAnimateChange={vi.fn()} opponentReads={passed} onOpponentReadsChange={vi.fn()} onEditSide={vi.fn()} onOpenSets={vi.fn()} />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Setup' }));
    expect(screen.queryByRole('checkbox', { name: /Opponent reads/ })).toBeNull();
    expect(screen.getAllByRole('checkbox').map(box => box.closest('label')?.textContent?.trim())).toEqual(['Animate branch turns']);
    expect(screen.getByRole('button', { name: 'Edit Player' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Import/Export Sets' })).toBeInTheDocument();
    expect(document.body.innerHTML).not.toMatch(/Opponent reads|reads my move/);
  });
});

describe('turn dock with the flag off', () => {
  const model = { p1: [], p2: [], flags: {} } as unknown as DockModel;

  test('a setting passed as on draws no note and no "Turn off"', () => {
    render(<DockStatus source="stored" executeError={null} model={model} diceOpen={false} opponentReads onOpponentReadsChange={vi.fn()} />);
    expect(screen.queryByText('Opponent reads your move')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Turn off' })).toBeNull();
    expect(screen.getByText('Choices from the reconstructed position')).toBeInTheDocument();
  });
});

describe('the titles that name the reply rule', () => {
  test('the click title says the opponent plays its top choice, whatever the setting passed', () => {
    expect(exploreTitle(true)).toBe('Play this turn in a variation; the opponent plays its top choice.');
    expect(exploreTitle(false)).toBe('Play this turn in a variation; the opponent plays its top choice.');
  });
});

describe('the Setup checkbox with its flag on and the Game review flag off', () => {
  test('its title leaves the Game review out', async () => {
    vi.stubEnv('VITE_FEATURE_OPPONENT_READS', '1');
    vi.stubEnv('VITE_FEATURE_GAME_REVIEW', '');
    render(
      <SetupMenu animateBranchTurns={false} onAnimateChange={vi.fn()} opponentReads={false} onOpponentReadsChange={vi.fn()} onEditSide={vi.fn()} onOpenSets={vi.fn()} />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Setup' }));
    const title = screen.getByRole('checkbox', { name: 'Opponent reads my move' }).closest('label')?.getAttribute('title');
    expect(title).toContain('in the turn dock, and in a turn\'s lines. Off, it plays its own top choice');
    expect(title).not.toMatch(/Game review/);
  });
});
