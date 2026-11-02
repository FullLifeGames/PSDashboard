import { describe, expect, test, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { DieOffer, DieWords, ForcedDie } from '@fulllifegames/eval-engine';
import { DiceTable } from '../../../../src/components/dock/DiceTable';

/**
 * Round 83 (the user, 01.11.2026: "which hit you're controlling is not really defined"), moved to the table in round 84 (A4):
 * the dice of a move are a table with one column per target and one row per kind of die. The head of a column names its target
 * by slot and name, so two bodies of one species stay apart; the die's caption is the label of its row; a move with one target
 * keeps one column without a head.
 */

const NAMES: Record<string, string> = { p1a: 'Calyrex', p1b: 'Calyrex', p2a: 'Calyrex', p2b: 'Ninetales' };
const words: DieWords = { move: () => 'Earthquake', effect: id => id, slot: slot => NAMES[slot] ?? slot };

const offer = (kind: DieOffer['name']['kind'], targetSlot?: string, extra: Partial<DieOffer['name']> = {}, results: DieOffer['results'] = [{ happens: true }, { happens: false }]): DieOffer => ({
  name: { slot: 'p1a', moveId: 'earthquake', kind, ...(targetSlot ? { targetSlot } : {}), ...extra }, results,
});
const steps = Array.from({ length: 16 }, (_, step) => ({ step }));
const spread = (): DieOffer[] => ['p2a', 'p2b', 'p1b'].flatMap(target => [
  offer('accuracy', target), offer('crit', target), offer('damage-roll', target, {}, steps), offer('secondary', target, { effectId: 'flinch' }),
]);

const table = (props: Partial<Parameters<typeof DiceTable>[0]> = {}) =>
  render(<DiceTable offers={spread()} dice={[]} logged={[]} words={words} label="P1" onToggle={vi.fn()} {...props} />);

describe('the dice table of a spread move', () => {
  test('one column per target, each headed by its slot and name, in the order of the targets', () => {
    table();
    const heads = screen.getAllByText(/^P[12][AB] /).filter(node => node.classList.contains('ps-dice-heading'));
    expect(heads.map(node => node.textContent)).toEqual(['P2A Calyrex', 'P2B Ninetales', 'P1B Calyrex']);
  });

  test('each kind of die is one row: its caption once, then one cell per target with the die\'s chips', () => {
    table();
    const dice = screen.getByRole('group', { name: 'Dice for P1' });
    for (const caption of ['Hit', 'Crit', 'Damage roll', 'flinch']) {
      expect(within(dice).getAllByText(caption, { selector: '.ps-dice-caption' }), caption).toHaveLength(1);
    }
    for (const target of ['P2A Calyrex', 'P2B Ninetales', 'P1B Calyrex']) {
      const hit = within(dice).getByRole('group', { name: `Hit against ${target}` });
      expect(within(hit).getAllByRole('button').map(chip => chip.textContent)).toEqual(['Hits', 'Misses']);
    }
    // Round 84 (A6a): the cell's label names the slot, so the two bodies named Calyrex (P2A and P1B) stay apart by it.
    expect(within(dice).queryAllByRole('group', { name: 'Hit against Calyrex' })).toHaveLength(0);
    expect(within(dice).getAllByRole('group', { name: 'flinch against P2B Ninetales' })).toHaveLength(1);
  });

  test('the damage roll is a select in each column', () => {
    table();
    const selects = screen.getAllByRole('combobox');
    expect(selects.map(select => select.getAttribute('aria-label'))).toEqual([
      'Damage roll against P2A Calyrex', 'Damage roll against P2B Ninetales', 'Damage roll against P1B Calyrex',
    ]);
  });

  test('a cell sits in the column of its head: the grid names the column count', () => {
    table();
    expect(screen.getByRole('group', { name: 'Dice for P1' }).style.getPropertyValue('--dice-cols')).toBe('3');
  });

  test('a click on a chip hands the die of its own target to the dock', async () => {
    const onToggle = vi.fn();
    table({ onToggle });
    await userEvent.click(within(screen.getByRole('group', { name: 'flinch against P2B Ninetales' })).getAllByRole('button')[0]);
    expect(onToggle).toHaveBeenCalledWith({ name: spread().find(entry => entry.name.kind === 'secondary' && entry.name.targetSlot === 'p2b')!.name, result: { happens: true } });
  });

  test('a die the move draws once for every target stands in a row of its own under the columns', () => {
    table({ offers: [...spread(), offer('hit-count', undefined, {}, [{ hits: 2 }, { hits: 3 }])] });
    const row = screen.getByRole('group', { name: 'Hits' });
    expect(row.className).toContain('ps-dice-cell-shared');
    expect(within(row).getAllByRole('button').map(chip => chip.textContent)).toEqual(['2 hits', '3 hits']);
  });
});

describe('the dice table of a move with one target', () => {
  test('one column without a head, the captions as row labels', () => {
    table({ offers: [offer('accuracy', 'p2a'), offer('crit', 'p2a')] });
    expect(screen.queryByText('P2A Calyrex')).toBeNull();
    expect(document.querySelector('.ps-dice-heading')).toBeNull();
    expect(screen.getByRole('group', { name: 'Dice for P1' }).style.getPropertyValue('--dice-cols')).toBe('1');
    expect(screen.getByRole('group', { name: 'Hit' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Crit' })).toBeInTheDocument();
  });

  test('a set die reads pressed, the logged result carries "log", and a pulled die says why', () => {
    const forced = (kind: 'accuracy' | 'crit', happens: boolean): ForcedDie => ({ name: offer(kind, 'p2a').name, result: { happens } });
    table({ offers: [offer('accuracy', 'p2a'), offer('crit', 'p2a')], dice: [forced('crit', true), forced('accuracy', true)], logged: [forced('accuracy', false)] });
    expect(within(screen.getByRole('group', { name: 'Crit' })).getByRole('button', { name: 'Crit' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(screen.getByRole('group', { name: 'Hit' })).getByRole('button', { name: /^Misses/ })).toHaveTextContent('Misses · log');
    expect(screen.getByText(/because the crit needs a hit/)).toHaveClass('ps-dice-note');
  });

  test('a die the move no longer offers stays as a set chip', () => {
    const stray: ForcedDie = { name: offer('crit', 'p2a').name, result: { happens: true } };
    table({ offers: [offer('accuracy', 'p2a')], dice: [stray] });
    expect(screen.getByRole('group', { name: 'Forced dice the move no longer offers' })).toBeInTheDocument();
  });

  test('no offers and no stray dice render nothing; offers still being asked render nothing', () => {
    const { container, rerender } = table({ offers: [] });
    expect(container).toBeEmptyDOMElement();
    rerender(<DiceTable offers={null} dice={[]} logged={[]} words={words} label="P1" onToggle={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });
});
