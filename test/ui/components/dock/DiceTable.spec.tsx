import { describe, expect, test, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { DieOffer, DieWords, ForcedDie, DieName } from '@fulllifegames/eval-engine';
import { DiceTable } from '../../../../src/components/dock/DiceTable';

/**
 * Round 83 (the user, 01.11.2026: "which hit you're controlling is not really defined"), moved to the table in round 84 (A4):
 * the dice of a move are a table with one column per target and one row per kind of die. The head of a column names its target
 * by slot and name, so two bodies of one species stay apart; the die's caption is the label of its row; a move with one target
 * keeps one column without a head.
 */

describe('DiceTable', () => {
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
});

const NAMES: Record<string, string> = { p1a: 'Meowscarada', p1b: 'Hitmonbottom', p2a: 'Garchomp', p2b: 'Ninetales' };
const words: DieWords = { move: () => 'Triple Axel', effect: id => id, slot: slot => NAMES[slot] ?? slot };
const YES_NO = [{ happens: true }, { happens: false }];

const name = (kind: DieName['kind'], extra: Partial<DieName> = {}): DieName => ({ slot: 'p1a', moveId: 'tripleaxel', targetSlot: 'p2a', kind, ...extra });
const offers = (extra: Partial<DieName> = {}): DieOffer[] => [
  { name: name('accuracy', extra), results: YES_NO },
  { name: name('accuracy', { ...extra, hit: 2 }), results: YES_NO },
  { name: name('accuracy', { ...extra, hit: 3 }), results: YES_NO },
  { name: name('crit', extra), results: YES_NO },
];
const die = (hit: number | undefined, happens: boolean, extra: Partial<DieName> = {}): ForcedDie => ({ name: name('accuracy', { ...extra, ...(hit ? { hit } : {}) }), result: { happens } });

const table = (props: Partial<Parameters<typeof DiceTable>[0]> = {}) =>
  render(<DiceTable offers={offers()} dice={[]} logged={[]} words={words} label="P1" onToggle={vi.fn()} {...props} />);
const hitsRow = () => screen.getByRole('group', { name: 'Hits' });
const chips = () => within(hitsRow()).getAllByRole('button').map(chip => chip.textContent);

describe('the Hits row of a multi-accuracy move', () => {
  test('one Hit row and one Hits row of the counts 1 to 3, under the Hit row, and no row per hit', () => {
    table();
    const dice = screen.getByRole('group', { name: 'Dice for P1' });
    expect([...dice.querySelectorAll('.ps-dice-caption')].map(caption => caption.textContent)).toEqual(['Hit', 'Hits', 'Crit']);
    expect(chips()).toEqual(['1 hit', '2 hits', '3 hits']);
    expect(within(screen.getByRole('group', { name: 'Hit' })).getAllByRole('button').map(chip => chip.textContent)).toEqual(['Hits', 'Misses']);
    expect(within(hitsRow()).getAllByRole('button').every(chip => chip.getAttribute('aria-pressed') === 'false')).toBe(true);
  });

  test('a doubles dock shows the same row for a body on slot b', () => {
    table({ offers: offers({ slot: 'p1b' }), label: 'P1B' });
    expect(chips()).toEqual(['1 hit', '2 hits', '3 hits']);
  });

  test('the count the hit dice set reads pressed; the first hit alone presses none', () => {
    table({ dice: [die(undefined, true), die(2, true), die(3, false)] });
    expect(within(hitsRow()).getByRole('button', { name: '2 hits' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(hitsRow()).getAllByRole('button').filter(chip => chip.getAttribute('aria-pressed') === 'true')).toHaveLength(1);
  });

  test('every hit landing presses the last count', () => {
    table({ dice: [die(undefined, true), die(2, true), die(3, true)] });
    expect(within(hitsRow()).getByRole('button', { name: '3 hits' })).toHaveAttribute('aria-pressed', 'true');
  });

  test('the count the log shows carries "log": hit 2 landed and hit 3 missed reads "2 hits · log"', () => {
    table({ logged: [die(2, true), die(3, false)] });
    expect(chips()).toEqual(['1 hit', '2 hits · log', '3 hits']);
    expect(within(hitsRow()).getByRole('button', { name: /^2 hits/ })).toHaveAttribute('aria-pressed', 'false');
  });

  test('a log whose first later hit missed reads "1 hit · log"', () => {
    table({ logged: [die(2, false)] });
    expect(chips()).toEqual(['1 hit · log', '2 hits', '3 hits']);
  });

  test('a click hands over the count die of the move and target, and its title says it', async () => {
    const onToggle = vi.fn();
    table({ onToggle });
    const chip = within(hitsRow()).getByRole('button', { name: '2 hits' });
    expect(chip).toHaveAttribute('title', 'Triple Axel: 2 hits');
    await userEvent.click(chip);
    expect(onToggle).toHaveBeenCalledWith({ name: name('hit-count'), result: { hits: 2 } });
  });

  test('a move without later hit dice (Skill Link, Loaded Dice) has no Hits row', () => {
    table({ offers: offers().filter(offer => offer.name.hit === undefined) });
    expect(screen.queryByRole('group', { name: 'Hits' })).toBeNull();
  });

  // Round 89 (ruling 34 F4a): a holder whose ability or item fixes the count gets the row without a choice
  test.each([['p1a', 'Skill Link', 3], ['p1b', 'Loaded Dice', 3], ['p1a', 'Skill Link', 10]] as const)('a fixed count (%s, %s, %i hits) reads "Hits: N (name)" under the Hit row, with no chip to click', (slot, fixedBy, hits) => {
    const fixed: DieOffer = { name: { slot, moveId: 'tripleaxel', kind: 'hit-count' }, results: [{ hits }], fixedBy };
    const onToggle = vi.fn();
    table({ offers: [...offers({ slot }).filter(offer => offer.name.hit === undefined), fixed], label: slot.toUpperCase(), onToggle });
    const dice = screen.getByRole('group', { name: `Dice for ${slot.toUpperCase()}` });
    expect([...dice.querySelectorAll('.ps-dice-caption')].map(caption => caption.textContent)).toEqual(['Hit', 'Hits', 'Crit']);
    expect(within(hitsRow()).queryAllByRole('button')).toEqual([]);
    expect(hitsRow()).toHaveTextContent(`${hits} (${fixedBy})`);
    expect(onToggle).not.toHaveBeenCalled();
  });

  test('a later hit die the move does not offer stays a set chip below the table, with its hit in the label', () => {
    table({ offers: offers().filter(offer => offer.name.hit === undefined), dice: [die(2, false)] });
    const stray = screen.getByRole('group', { name: 'Forced dice the move no longer offers' });
    expect(within(stray).getByRole('button', { name: 'Misses' })).toHaveAttribute('title', 'Triple Axel hit 2: misses');
  });
});
