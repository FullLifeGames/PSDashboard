import { describe, expect, test, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { DieName, DieOffer, DieWords, ForcedDie } from '@fulllifegames/eval-engine';
import { DiceTable } from '../../../../src/components/dock/DiceTable';

/**
 * Round 89 (#114, F3; the user's ruling 31): the dice table of a move whose later hits roll accuracy (Triple Axel) has one "Hits" row
 * of the counts "1 hit" to "3 hits" under its "Hit" row, never a row per hit. The pressed chip is the count the user's hit dice set,
 * "· log" marks the count the log shows, and a click hands over the count die (`hit-count` with the target and the result `{ hits }`).
 */
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

  test('a later hit die the move does not offer stays a set chip below the table, with its hit in the label', () => {
    table({ offers: offers().filter(offer => offer.name.hit === undefined), dice: [die(2, false)] });
    const stray = screen.getByRole('group', { name: 'Forced dice the move no longer offers' });
    expect(within(stray).getByRole('button', { name: 'Misses' })).toHaveAttribute('title', 'Triple Axel hit 2: misses');
  });
});
