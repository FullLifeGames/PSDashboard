import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LeadPanel } from '../../src/components/LeadPanel';
import type { LeadOption } from '../../src/lib/lead-options';

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
    expect(screen.getByRole('button', { name: 'Pick 2 per side' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: /^Urshifu/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Play from turn 0' }));
    expect(wired.onStart).toHaveBeenCalledWith({ p1: ['Amoonguss', 'Urshifu'], p2: ['Tornadus', 'Kingambit'] });
  });

  test('a bring-four format asks for four per side, leads first, and the back gets numbered', () => {
    render(<LeadPanel {...props({ ...doubles, leadsPerSide: 2, bringCount: 4 })} />);
    expect(screen.getByText(/pick the 4 each side brings/)).toBeInTheDocument();
    expect(screen.getAllByText('Who comes along? Pick 4 — the first 2 lead')).toHaveLength(2);
    expect(screen.getByRole('button', { name: /^Flutter Mane/ })).toHaveTextContent('3');
    expect(screen.getByRole('button', { name: 'Pick 4 per side' })).toBeDisabled();
  });

  test('a recorded selection preselects; executing blocks the start; missing teams show the loading note', () => {
    render(<LeadPanel {...props({ pickedLeads: { p1: ['Latias'], p2: ['Toxapex'] }, executing: true })} />);
    expect(screen.getByRole('button', { name: /^Latias/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Preparing…' })).toBeDisabled();

    render(<LeadPanel {...props({ p1Options: [] })} />);
    expect(screen.getByText(/The teams are still loading/)).toBeInTheDocument();
  });
});
