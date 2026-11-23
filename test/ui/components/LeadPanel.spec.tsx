import { describe, expect, test, vi, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LeadPanel } from '../../../src/components/LeadPanel';
import type { LeadOption } from '../../../src/lib/lead-options';

describe('LeadPanel', () => {
  type Props = Parameters<typeof LeadPanel>[0];

  const option = (species: string, flags: Partial<LeadOption> = {}): LeadOption =>
    ({ name: species, species, wasLead: false, wasBrought: false, ...flags });

  const singles = {
    p1Options: [option('Garchomp', { wasLead: true }), option('Heatran', { wasBrought: true }), option('Latias')],
    p2Options: [option('Weavile', { wasLead: true }), option('Clefable'), option('Toxapex')],
  };
  const doubles = {
    p1Options: [option('Incineroar', { wasLead: true }), option('Amoonguss', { wasLead: true }), option('Flutter Mane', { wasBrought: true }), option('Urshifu'), option('Rillaboom'), option('Ogerpon')],
    p2Options: [option('Tornadus', { wasLead: true }), option('Kingambit', { wasLead: true }), option('Chi-Yu', { wasBrought: true }), option('Pelipper', { wasBrought: true }), option('Archaludon'), option('Sneasler')],
  };

  function props(overrides: Partial<Props> = {}): Props {
    return { playerNames: ['Alice', 'Bob'], ...singles, leadsPerSide: 1, bringCount: null, executing: false, onStart: vi.fn(), ...overrides };
  }

  describe('LeadPanel', () => {
    test('singles: the real leads preselect, a click swaps, and the start button hands both picks over', async () => {
      const wired = props();
      render(<LeadPanel {...wired} />);
      expect(screen.getByText(/pick each side’s lead/)).toBeInTheDocument();
      expect(screen.getAllByText('Who leads?')).toHaveLength(2);
      expect(screen.getByRole('button', { name: /^Garchomp/ })).toHaveAttribute('aria-pressed', 'true');
      expect(screen.getByRole('button', { name: /^Garchomp/ })).toHaveTextContent('played');
      expect(screen.getByRole('button', { name: /^Heatran/ })).toHaveAttribute('aria-pressed', 'false');

      await userEvent.click(screen.getByRole('button', { name: /^Heatran/ }));
      expect(screen.getByRole('button', { name: /^Heatran/ })).toHaveAttribute('aria-pressed', 'true');
      expect(screen.getByRole('button', { name: /^Garchomp/ })).toHaveAttribute('aria-pressed', 'false');

      await userEvent.click(screen.getByRole('button', { name: 'Play from turn 0' }));
      expect(wired.onStart).toHaveBeenCalledWith({ p1: ['Heatran'], p2: ['Weavile'] });
    });

    test('doubles: two leads per side in slot order with a, b badges', async () => {
      const wired = props({ ...doubles, leadsPerSide: 2 });
      render(<LeadPanel {...wired} />);
      expect(screen.getByText(/pick both leads per side/)).toBeInTheDocument();
      expect(screen.getAllByText('Who leads? Pick 2 (order sets the slots)')).toHaveLength(2);
      expect(screen.getByRole('button', { name: /^Incineroar/ })).toHaveTextContent('a');
      expect(screen.getByRole('button', { name: /^Amoonguss/ })).toHaveTextContent('b');

      await userEvent.click(screen.getByRole('button', { name: /^Incineroar/ }));
      // Round 84 (A7b): Start names what is missing, as Execute does (old: 'Pick 2 per side').
      expect(screen.getByRole('button', { name: 'Pick 1 more for P1' })).toBeDisabled();
      await userEvent.click(screen.getByRole('button', { name: /^Urshifu/ }));
      await userEvent.click(screen.getByRole('button', { name: 'Play from turn 0' }));
      expect(wired.onStart).toHaveBeenCalledWith({ p1: ['Amoonguss', 'Urshifu'], p2: ['Tornadus', 'Kingambit'] });
    });

    // Round 89 (#105, H7, tester finding 10): Gen 4 has no Team Preview; the free pick of a lead is a tool of the app, not the format's step.
    test('a format without Team Preview does not say "team preview", and says the pick moves the lead to the front', () => {
      const { rerender } = render(<LeadPanel {...props({ teamPreview: false })} />);
      expect(screen.queryByText(/^Turn 0 · team preview/)).toBeNull();
      expect(screen.getByText('Turn 0 · this format has no team preview: pick each side’s lead, it moves to the front of its team. Then play the game from the start.')).toBeInTheDocument();
      rerender(<LeadPanel {...props({ ...doubles, leadsPerSide: 2, teamPreview: false })} />);
      expect(screen.queryByText(/^Turn 0 · team preview/)).toBeNull();
      expect(screen.getByText('Turn 0 · this format has no team preview: pick both leads per side (selection order is the slot order), they move to the front of their teams. Then play the game from the start.')).toBeInTheDocument();
      // the default is the format with a preview, and a replay's words stay
      rerender(<LeadPanel {...props()} />);
      expect(screen.getByText(/Turn 0 · team preview: pick each side’s lead/)).toBeInTheDocument();
    });

    test('a bring-four format asks for four per side, leads first, and the back gets numbered', () => {
      render(<LeadPanel {...props({ ...doubles, leadsPerSide: 2, bringCount: 4 })} />);
      expect(screen.getByText('Turn 0 · team preview: pick the 4 each side brings. The first 2 lead, then play the game from the start.')).toBeInTheDocument();
      expect(screen.getAllByText('Who comes along? Pick 4. The first 2 lead')).toHaveLength(2);
      expect(screen.getByRole('button', { name: /^Flutter Mane/ })).toHaveTextContent('3');
      // Round 84 (A7b): Start names what is missing; P1 has three of four picked here (old: 'Pick 4 per side').
      expect(screen.getByRole('button', { name: 'Pick 1 more for P1' })).toBeDisabled();
    });

    test('a bring-three format with one lead says the first one leads and sets no dash', () => {
      render(<LeadPanel {...props({ bringCount: 3 })} />);
      expect(screen.getByText('Turn 0 · team preview: pick the 3 each side brings. The first one leads, then play the game from the start.')).toBeInTheDocument();
      expect(screen.getAllByText('Who comes along? Pick 3. The first one leads')).toHaveLength(2);
    });

    test('a recorded selection preselects; executing blocks the start; missing teams show the loading note', () => {
      render(<LeadPanel {...props({ pickedLeads: { p1: ['Latias'], p2: ['Toxapex'] }, executing: true })} />);
      expect(screen.getByRole('button', { name: /^Latias/ })).toHaveAttribute('aria-pressed', 'true');
      expect(screen.getByRole('button', { name: 'Preparing…' })).toBeDisabled();

      render(<LeadPanel {...props({ p1Options: [] })} />);
      expect(screen.getByText(/The teams are still loading/)).toBeInTheDocument();
    });

    // Round 77 (C10): the picker names a Pokemon the way the switch chips do (displayName), nickname and species together.
    test.each([
      ['singles', singles, 1],
      ['doubles', doubles, 2],
    ] as const)('%s: a nicknamed Pokemon reads "Nickname (Species)" and a plain one reads its species', (_kind, base, leadsPerSide) => {
      const p1Options = base.p1Options.map((entry, index) => (index === 0 ? { ...entry, name: 'GBB', species: entry.species } : entry));
      render(<LeadPanel {...props({ ...base, p1Options, leadsPerSide })} />);
      const nicknamed = p1Options[0].species;
      expect(screen.getByText(`GBB (${nicknamed})`)).toBeInTheDocument();
      expect(screen.getAllByText(p1Options[1].species).length).toBeGreaterThan(0);
    });

    // Round 77 (C2): the play-out button outside the panel reads the picks the panel shows.
    test('reports the picks while they are complete and clears them when the panel leaves', async () => {
      const onPicksChange = vi.fn();
      const { unmount } = render(<LeadPanel {...props({ ...doubles, leadsPerSide: 2, onPicksChange })} />);
      expect(onPicksChange).toHaveBeenLastCalledWith({ p1: ['Incineroar', 'Amoonguss'], p2: ['Tornadus', 'Kingambit'] });
      await userEvent.click(screen.getByRole('button', { name: /^Incineroar/ }));
      expect(onPicksChange).toHaveBeenLastCalledWith(null);
      await userEvent.click(screen.getByRole('button', { name: /^Urshifu/ }));
      expect(onPicksChange).toHaveBeenLastCalledWith({ p1: ['Amoonguss', 'Urshifu'], p2: ['Tornadus', 'Kingambit'] });
      unmount();
      expect(onPicksChange).toHaveBeenLastCalledWith(null);
    });

    test('singles report the picked lead the same way', async () => {
      const onPicksChange = vi.fn();
      render(<LeadPanel {...props({ onPicksChange })} />);
      expect(onPicksChange).toHaveBeenLastCalledWith({ p1: ['Garchomp'], p2: ['Weavile'] });
      await userEvent.click(screen.getByRole('button', { name: /^Latias/ }));
      expect(onPicksChange).toHaveBeenLastCalledWith({ p1: ['Latias'], p2: ['Weavile'] });
    });

    // Round 89 (#113): the picker lists the near side first, as the dock's rows do (round 88, T316).
    test.each([
      ['singles', singles, 1],
      ['doubles', doubles, 2],
    ] as const)('%s: the near side p2 lists P2 first, p1 and the default keep P1 first', (_name, options, leadsPerSide) => {
      const labels = () => screen.getAllByText(/^P[12] · /).map(el => el.textContent);
      const { rerender } = render(<LeadPanel {...props({ ...options, leadsPerSide, nearSide: 'p2' })} />);
      expect(labels()).toEqual(['P2 · Bob', 'P1 · Alice']);
      rerender(<LeadPanel {...props({ ...options, leadsPerSide, nearSide: 'p1' })} />);
      expect(labels()).toEqual(['P1 · Alice', 'P2 · Bob']);
      rerender(<LeadPanel {...props({ ...options, leadsPerSide })} />);
      expect(labels()).toEqual(['P1 · Alice', 'P2 · Bob']);
    });
  });
});

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
