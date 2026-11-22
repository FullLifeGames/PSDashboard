import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SetupMenu } from '../../../src/components/SetupMenu';

/**
 * Round 89 (#153, HM-2, ruling 45 HM2a and HM3a): the setting that Hard mode was called lives in the Setup menu as "Opponent reads
 * my move", under "Animate branch turns". The stored key and the engine's flag keep their names; only the words and the place move.
 */
function menu(opponentReads: boolean, onOpponentReadsChange = vi.fn()) {
  render(
    <SetupMenu
      animateBranchTurns={false} onAnimateChange={vi.fn()} opponentReads={opponentReads} onOpponentReadsChange={onOpponentReadsChange}
      onEditSide={vi.fn()} onOpenSets={vi.fn()}
    />,
  );
  return onOpponentReadsChange;
}

describe('the "Opponent reads my move" checkbox in the Setup menu', () => {
  test.each([[false], [true]])('mirrors the flag (%s), stands under "Animate branch turns", and keeps the menu open on a click', async flag => {
    const onChange = menu(flag);
    expect(screen.queryByRole('checkbox', { name: 'Opponent reads my move' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Setup' }));
    const box = screen.getByRole('checkbox', { name: 'Opponent reads my move' });
    if (flag) expect(box).toBeChecked(); else expect(box).not.toBeChecked();
    const boxes = screen.getAllByRole('checkbox');
    expect(boxes.map(item => item.closest('label')?.textContent?.trim())).toEqual(['Animate branch turns', 'Opponent reads my move']);
    expect(box.closest('.ps-setup-panel')).not.toBeNull();
    await userEvent.click(box);
    expect(onChange).toHaveBeenCalledWith(!flag);
    expect(screen.getByRole('button', { name: 'Setup' })).toHaveAttribute('aria-expanded', 'true');
  });

  test('its title says what the opponent does, where, and that grades stay', async () => {
    menu(false);
    await userEvent.click(screen.getByRole('button', { name: 'Setup' }));
    expect(screen.getByRole('checkbox', { name: 'Opponent reads my move' }).closest('label')).toHaveAttribute(
      'title',
      'In a variation the opponent answers each move you pick with the reply the search rates lowest for it, as if it had read your move: '
      + 'when you click an engine move, in the turn dock, and in a turn\'s lines and the Game review. '
      + 'Off, it plays its own top choice, which does not depend on your move. Grades and scores stay as they are. A change applies from your next pick.',
    );
  });
});
