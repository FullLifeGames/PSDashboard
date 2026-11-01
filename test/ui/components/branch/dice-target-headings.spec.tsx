import { describe, expect, test, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import type { DieOffer, DieWords } from '@fulllifegames/eval-engine';
import { SlotDice } from '../../../../src/components/branch/DiceChips';

/**
 * Round 83 (the user, 01.11.2026: "which hit you're controlling is not really defined"): a spread move shows one set of chips
 * per target, and the sets named their target only to a screen reader. Each set now carries a heading with the target's slot
 * and name; two bodies of one species stay apart by the slot.
 */

const NAMES: Record<string, string> = { p1a: 'Calyrex', p1b: 'Calyrex', p2a: 'Calyrex', p2b: 'Ninetales' };
const words: DieWords = { move: () => 'Earthquake', effect: id => id, slot: slot => NAMES[slot] ?? slot };

const offer = (kind: DieOffer['name']['kind'], targetSlot?: string): DieOffer => ({
  name: { slot: 'p1a', moveId: 'earthquake', kind, ...(targetSlot ? { targetSlot } : {}) },
  results: [{ happens: true }, { happens: false }],
});

describe('the dice of a spread move name each target (round 83)', () => {
  test('one heading per target with its slot and name, and each target\'s Hit row sits under its own heading', () => {
    const offers = ['p2a', 'p2b', 'p1b'].flatMap(target => [offer('accuracy', target), offer('crit', target)]);
    render(<SlotDice offers={offers} dice={[]} logged={[]} words={words} label="P1" onToggle={vi.fn()} />);
    for (const heading of ['P2A Calyrex', 'P2B Ninetales', 'P1B Calyrex']) {
      const set = screen.getByRole('group', { name: heading });
      expect(within(set).getByText(heading)).toHaveClass('ps-dice-heading');
      expect(within(set).getByRole('group', { name: `Hit against ${heading.split(' ')[1]}` })).toBeInTheDocument();
    }
  });

  test('a move with one target keeps a single set without a heading', () => {
    render(<SlotDice offers={[offer('accuracy', 'p2a'), offer('crit', 'p2a')]} dice={[]} logged={[]} words={words} label="P1" onToggle={vi.fn()} />);
    expect(screen.queryByText('P2A Calyrex')).toBeNull();
  });
});
