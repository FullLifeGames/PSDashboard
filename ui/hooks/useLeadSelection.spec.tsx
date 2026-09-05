import { describe, expect, test } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useLeadSelection } from '../../src/hooks/useLeadSelection';
import type { LeadOption } from '../../src/lib/lead-options';

const option = (species: string, flags: Partial<LeadOption> = {}): LeadOption =>
  ({ name: species, species, wasLead: false, wasBrought: false, ...flags });

const singles = {
  p1Options: [option('Garchomp', { wasLead: true }), option('Heatran', { wasBrought: true }), option('Latias')],
  p2Options: [option('Weavile', { wasLead: true }), option('Clefable'), option('Toxapex', { wasBrought: true })],
};
const doubles = {
  p1Options: [
    option('Incineroar', { wasLead: true }), option('Amoonguss', { wasLead: true }),
    option('Flutter Mane', { wasBrought: true }), option('Urshifu'),
  ],
  p2Options: [
    option('Rillaboom', { wasLead: true }), option('Tornadus', { wasLead: true }),
    option('Kingambit'), option('Ogerpon', { wasBrought: true }),
  ],
};

describe('useLeadSelection', () => {
  test('singles: the real lead preselects, a click toggles, a click past the limit replaces the oldest pick', () => {
    const { result } = renderHook(() => useLeadSelection({ ...singles, maxPicks: 1 }));
    expect(result.current.p1Leads).toEqual(['Garchomp']);
    expect(result.current.p2Leads).toEqual(['Weavile']);
    act(() => result.current.toggleP1('Heatran'));
    expect(result.current.p1Leads).toEqual(['Heatran']);
    act(() => result.current.toggleP1('Heatran'));
    expect(result.current.p1Leads).toEqual([]);
  });

  test('doubles: both leads preselect in slot order and the bring fills the rest of a bring-four', () => {
    const { result } = renderHook(() => useLeadSelection({ ...doubles, maxPicks: 4 }));
    expect(result.current.p1Leads).toEqual(['Incineroar', 'Amoonguss', 'Flutter Mane']);
    expect(result.current.p2Leads).toEqual(['Rillaboom', 'Tornadus', 'Ogerpon']);
    act(() => result.current.toggleP1('Urshifu'));
    expect(result.current.p1Leads).toEqual(['Incineroar', 'Amoonguss', 'Flutter Mane', 'Urshifu']);
    // Deselecting a lead and picking it again moves it to the end of the order.
    act(() => result.current.toggleP2('Kingambit'));
    act(() => result.current.toggleP2('Rillaboom'));
    expect(result.current.p2Leads).toEqual(['Tornadus', 'Ogerpon', 'Kingambit']);
    act(() => result.current.toggleP2('Rillaboom'));
    expect(result.current.p2Leads).toEqual(['Tornadus', 'Ogerpon', 'Kingambit', 'Rillaboom']);
  });

  test('a pick past the limit replaces the oldest pick, so a swap never needs a deselect first', () => {
    const { result } = renderHook(() => useLeadSelection({ ...doubles, maxPicks: 3 }));
    expect(result.current.p1Leads).toEqual(['Incineroar', 'Amoonguss', 'Flutter Mane']);
    act(() => result.current.toggleP1('Urshifu'));
    expect(result.current.p1Leads).toEqual(['Amoonguss', 'Flutter Mane', 'Urshifu']);
  });

  test('doubles with two leads only keeps the two that led', () => {
    const { result } = renderHook(() => useLeadSelection({ ...doubles, maxPicks: 2 }));
    expect(result.current.p1Leads).toEqual(['Incineroar', 'Amoonguss']);
    act(() => result.current.toggleP1('Flutter Mane'));
    expect(result.current.p1Leads).toEqual(['Amoonguss', 'Flutter Mane']);
  });

  test('a recorded variation choice wins over the real game and follows a prop change', () => {
    const { result, rerender } = renderHook(
      (props: { pickedLeads: { p1: string[]; p2: string[] } | null }) =>
        useLeadSelection({ ...singles, maxPicks: 1, pickedLeads: props.pickedLeads }),
      { initialProps: { pickedLeads: { p1: ['Latias'], p2: ['Clefable'] } } },
    );
    expect(result.current.p1Leads).toEqual(['Latias']);
    expect(result.current.p2Leads).toEqual(['Clefable']);
    rerender({ pickedLeads: { p1: ['Heatran'], p2: ['Toxapex'] } });
    expect(result.current.p1Leads).toEqual(['Heatran']);
    expect(result.current.p2Leads).toEqual(['Toxapex']);
  });

  test('a recorded species the options do not know falls back to the real game', () => {
    const { result } = renderHook(() => useLeadSelection({ ...singles, maxPicks: 1, pickedLeads: { p1: ['Mew'], p2: ['Weavile'] } }));
    expect(result.current.p1Leads).toEqual(['Garchomp']);
    expect(result.current.p2Leads).toEqual(['Weavile']);
  });
});
