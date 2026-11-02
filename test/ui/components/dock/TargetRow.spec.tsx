import { describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TargetRow } from '../../../../src/components/dock/TargetRow';
import { moveOption } from '../../fixtures/sim-state';

/** Round 84 (turn dock), step A3c: the e2e specs read a target button's text ("P2A Bulbasaur"); flex items lay out without spaces. */
describe('TargetRow', () => {
  test('a target button reads its slot, its name and its HP with spaces between', () => {
    const move = moveOption('Thunderbolt', {
      targetOptions: [{ label: 'P2A', targetLoc: 1, side: 'p2', activeSlot: 0, name: 'Bulbasaur', species: 'Bulbasaur', hpPercent: 61 }],
    });
    render(<TargetRow move={move} selectedLoc={undefined} targets={{}} onPick={() => {}} />);
    expect(screen.getByRole('button')).toHaveTextContent('P2A Bulbasaur 61%');
  });
});
