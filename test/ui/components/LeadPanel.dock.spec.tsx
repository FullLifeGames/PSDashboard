import { afterEach, describe, expect, test, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LeadPanel } from '../../../src/components/LeadPanel';
import type { LeadOption } from '../../../src/lib/lead-options';

/**
 * Round 84 (turn dock), A7b, ruling 12b: the lead picker at turn 0 in the dock's look, its behaviour unchanged. The root is a dock
 * (`ps-dock ps-lead`: it stands where the dock stands, with the dock's tile, bar and Execute rules); the sides stand in rows, P1
 * above P2; the bodies are the bench's tiles; the order of a pick is a mark in the tile's flag row (never in its box); Start takes
 * Execute's place and look and names what is missing.
 */
type Props = Parameters<typeof LeadPanel>[0];
const option = (species: string, flags: Partial<LeadOption> = {}): LeadOption => ({ name: species, species, wasLead: false, wasBrought: false, ...flags });
const doubles = {
  p1Options: [option('Incineroar', { wasLead: true }), option('Amoonguss', { wasLead: true }), option('Flutter Mane', { wasBrought: true }), option('Urshifu')],
  p2Options: [option('Tornadus', { wasLead: true }), option('Kingambit', { wasLead: true }), option('Chi-Yu'), option('Pelipper')],
};
const props = (over: Partial<Props> = {}): Props => ({
  playerNames: ['Alice', 'Bob'], ...doubles, leadsPerSide: 2, bringCount: null, executing: false, onStart: vi.fn(), ...over,
});
const marks = (name: RegExp) => [...screen.getByRole('button', { name }).querySelectorAll('.ps-tile-flags > span')].map(span => span.textContent);

afterEach(() => document.documentElement.style.removeProperty('--ps-dock-h'));

describe('the lead picker in the dock look', () => {
  test('the root is a dock with the intro as its status strip and one bar below', () => {
    const { container } = render(<LeadPanel {...props()} />);
    const root = container.firstElementChild as HTMLElement;
    expect(root).toHaveClass('ps-dock', 'ps-lead');
    expect(root.querySelector(':scope > .ps-dock-status')).toHaveTextContent('Turn 0 · team preview: pick both leads per side');
    expect(root.querySelectorAll('.ps-dock-bar')).toHaveLength(1);
  });

  test('P1 stands above P2, each side with its prompt and its tiles', () => {
    const { container } = render(<LeadPanel {...props()} />);
    const sides = [...container.querySelectorAll('.ps-lead-side')];
    expect(sides).toHaveLength(2);
    expect(sides[0]).toHaveTextContent('P1 · Alice');
    expect(sides[1]).toHaveTextContent('P2 · Bob');
    expect(sides[0].querySelectorAll('.ps-switch-row > .ps-switchbtn')).toHaveLength(4);
    expect(sides[1].querySelectorAll('.ps-switch-row > .ps-switchbtn')).toHaveLength(4);
  });

  test('a tile is the bench tile: sprite, name and the selection class, with no badge in its name line', () => {
    render(<LeadPanel {...props()} />);
    const tile = screen.getByRole('button', { name: /^Incineroar/ });
    expect(tile).toHaveClass('ps-switchbtn', 'ps-switchbtn-selected');
    expect(within(tile).getByRole('img', { name: 'Incineroar' })).toHaveAttribute('src', expect.stringContaining('incineroar'));
    expect(tile.querySelector('.ps-switchbtn-name')).toHaveTextContent(/^Incineroar$/);
    expect(tile).not.toHaveClass('ps-switchbtn-compact');
  });

  test('the order of a pick and the played badge stand in the flag row of the tile, never in its name line', async () => {
    render(<LeadPanel {...props({ bringCount: 4 })} />);
    expect(marks(/^Incineroar/)).toEqual(['a', 'played']);
    expect(marks(/^Amoonguss/)).toEqual(['b', 'played']);
    expect(marks(/^Flutter Mane/)).toEqual(['3']);
    expect(marks(/^Urshifu/)).toEqual([]);
    await userEvent.click(screen.getByRole('button', { name: /^Urshifu/ }));
    expect(marks(/^Urshifu/)).toEqual(['4']);
    expect(screen.getByRole('button', { name: /^Urshifu/ }).querySelector('.ps-switchbtn-name .ps-lead-slot')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: /^Incineroar/ }));
    expect(marks(/^Incineroar/)).toEqual(['played']);
  });

  test('a singles pick carries no mark, the real lead still reads played', () => {
    render(<LeadPanel {...props({ p1Options: [option('Garchomp', { wasLead: true }), option('Heatran')], p2Options: [option('Weavile', { wasLead: true }), option('Clefable')], leadsPerSide: 1 })} />);
    expect(marks(/^Garchomp/)).toEqual(['played']);
    expect(screen.getByRole('button', { name: /^Heatran/ }).querySelector('.ps-tile-flags')).toBeNull();
  });

  test('Start stands in the place and look of Execute and names what is missing', async () => {
    const { container } = render(<LeadPanel {...props()} />);
    const bar = container.querySelector('.ps-dock-bar') as HTMLElement;
    const start = within(bar).getByRole('button', { name: 'Play from turn 0' });
    expect(bar.lastElementChild).toBe(start);
    expect(start).toHaveClass('ps-execute-btn', 'ps-execute-btn-ready');
    await userEvent.click(screen.getByRole('button', { name: /^Incineroar/ }));
    expect(within(bar).getByRole('button', { name: 'Pick 1 more for P1' })).toBeDisabled();
    expect(within(bar).getByRole('button', { name: 'Pick 1 more for P1' })).not.toHaveClass('ps-execute-btn-ready');
    await userEvent.click(screen.getByRole('button', { name: /^Amoonguss/ }));
    expect(within(bar).getByRole('button', { name: 'Pick 2 more for P1' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: /^Tornadus/ }));
    expect(within(bar).getByRole('button', { name: 'Pick 2 per side' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: /^Incineroar/ }));
    await userEvent.click(screen.getByRole('button', { name: /^Amoonguss/ }));
    expect(within(bar).getByRole('button', { name: 'Pick 1 more for P2' })).toBeDisabled();
  });

  test('while the game prepares Start reads Preparing and is not ready', () => {
    render(<LeadPanel {...props({ executing: true })} />);
    const start = screen.getByRole('button', { name: 'Preparing…' });
    expect(start).toBeDisabled();
    expect(start).not.toHaveClass('ps-execute-btn-ready');
  });

  test('the picker reports its height for the narrow windows, like the dock', () => {
    render(<LeadPanel {...props()} />);
    expect(document.documentElement.style.getPropertyValue('--ps-dock-h')).toMatch(/^\d+px$/);
  });
});
