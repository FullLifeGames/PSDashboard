import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SetupMenu } from '../../../src/components/SetupMenu';
import { DockStatus } from '../../../src/components/dock/DockStatus';
import { exploreTitle } from '../../../src/components/eval/turn-copy';
import type { DockModel } from '../../../src/components/dock/dock-model';
import { opponentReadsEnabled } from '../../../src/lib/feature-flags';

// The ui project's vitest config switches the flag on, so each row stubs the variable away.
afterEach(() => vi.unstubAllEnvs());

describe('the flag Opponent reads my move', () => {
  test.each([['1', true], ['true', true], ['0', false], ['false', false], ['', false], ['yes', false]])('%j reads as %s', (value, expected) => {
    vi.stubEnv('VITE_FEATURE_OPPONENT_READS', value);
    expect(opponentReadsEnabled()).toBe(expected);
  });

  test('an unset variable is off', () => {
    vi.stubEnv('VITE_FEATURE_OPPONENT_READS', undefined);
    expect(opponentReadsEnabled()).toBe(false);
  });
});

describe('Setup menu with the flag off', () => {
  beforeEach(() => vi.stubEnv('VITE_FEATURE_OPPONENT_READS', ''));

  test.each([[false], [true]])('no checkbox for the reply rule (setting passed as %s); the other entries stay', async passed => {
    render(
      <SetupMenu animateBranchTurns={false} onAnimateChange={vi.fn()} opponentReads={passed} onOpponentReadsChange={vi.fn()} onEditSide={vi.fn()} onOpenSets={vi.fn()} />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Setup' }));
    expect(screen.queryByRole('checkbox', { name: /Opponent reads/ })).toBeNull();
    expect(screen.getAllByRole('checkbox').map(box => box.closest('label')?.textContent?.trim())).toEqual(['Animate branch turns']);
    expect(screen.getByRole('button', { name: 'Edit Player' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Import/Export Sets' })).toBeInTheDocument();
    expect(document.body.innerHTML).not.toMatch(/Opponent reads|reads my move|each move you pick/);
  });
});

describe('turn dock with the flag off', () => {
  beforeEach(() => vi.stubEnv('VITE_FEATURE_OPPONENT_READS', ''));

  const model = { p1: [], p2: [], flags: {} } as unknown as DockModel;

  test('a setting passed as on draws no note and no "Turn off"', () => {
    render(<DockStatus source="stored" executeError={null} model={model} diceOpen={false} opponentReads onOpponentReadsChange={vi.fn()} />);
    expect(screen.queryByText('Opponent reads your move')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Turn off' })).toBeNull();
    expect(screen.getByText('Choices from the reconstructed position')).toBeInTheDocument();
  });
});

describe('the titles that name the reply rule', () => {
  beforeEach(() => vi.stubEnv('VITE_FEATURE_OPPONENT_READS', ''));

  test('the click title says the opponent plays its top choice, whatever the setting passed', () => {
    expect(exploreTitle(true)).toBe('Play this turn in a variation; the opponent plays its top choice.');
    expect(exploreTitle(false)).toBe('Play this turn in a variation; the opponent plays its top choice.');
  });
});
