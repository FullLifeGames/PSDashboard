import { describe, expect, test } from 'vitest';
import { render } from '@testing-library/react';
import { DockRows } from '../../../../src/components/dock/DockRows';
import type { DockModel, DockSlotModel, Side } from '../../../../src/components/dock/dock-model';
import { switchOption } from '../../fixtures/sim-state';

/**
 * Round 88 (T316, #56): the row order follows the side the replay frame shows near. After Switch sides P2 stands at the frame's
 * foot, so its chips take the top row (doubles and VGC) or the left place (singles). Labels and `data-chip` stay the slot's own.
 */
function slot(side: Side, index: number, label: string, switches = 0): DockSlotModel {
  return {
    side, slot: index, label, name: 'Greninja', species: 'Greninja', hpPercent: 80, fainted: false, moves: [],
    switches: Array.from({ length: switches }, (_, i) => switchOption(['Heatran', 'Kingambit'][i], { slot: i + 2 })),
    forceSwitch: false, nobodyLeft: false, waits: false, pending: null, blockedSwitchKeys: new Set(), gimmick: { modifier: null },
    played: null, pickText: '', placeholder: 'choose', wait: null, origin: null, deferred: null,
  } as unknown as DockSlotModel;
}

const model = (p1: DockSlotModel[], p2: DockSlotModel[]) => ({ p1, p2 }) as unknown as DockModel;
const SINGLES = model([slot('p1', 0, 'P1')], [slot('p2', 0, 'P2')]);
const DOUBLES = model([slot('p1', 0, 'P1A'), slot('p1', 1, 'P1B')], [slot('p2', 0, 'P2A'), slot('p2', 1, 'P2B')]);
// VGC: four brought, two active; the bench lists differ from doubles, the chips do not.
const VGC = model([slot('p1', 0, 'P1A', 2), slot('p1', 1, 'P1B', 2)], [slot('p2', 0, 'P2A', 2), slot('p2', 1, 'P2B', 2)]);

function rows(m: DockModel, nearSide?: Side) {
  const { container } = render(<DockRows model={m} open={null} onToggle={() => undefined} nearSide={nearSide} />);
  return [...container.querySelectorAll('.ps-dock-row')].map(row => [...row.querySelectorAll('.ps-dock-chip')].map(chip => ({
    label: chip.querySelector('.ps-dock-label')?.textContent, chip: chip.getAttribute('data-chip'),
  })));
}
const labels = (grid: ReturnType<typeof rows>) => grid.map(row => row.map(chip => chip.label));

describe('DockRows and the near side', () => {
  test('singles: one row, the near side first', () => {
    expect(labels(rows(SINGLES))).toEqual([['P1', 'P2']]);
    expect(labels(rows(SINGLES, 'p1'))).toEqual([['P1', 'P2']]);
    expect(labels(rows(SINGLES, 'p2'))).toEqual([['P2', 'P1']]);
  });

  test.each([['doubles', DOUBLES], ['VGC', VGC]] as const)('%s: two rows, the near side on top', (_name, m) => {
    expect(labels(rows(m))).toEqual([['P1A', 'P1B'], ['P2A', 'P2B']]);
    expect(labels(rows(m, 'p1'))).toEqual([['P1A', 'P1B'], ['P2A', 'P2B']]);
    expect(labels(rows(m, 'p2'))).toEqual([['P2A', 'P2B'], ['P1A', 'P1B']]);
  });

  test('a chip keeps its own label and key whichever row it stands in', () => {
    const switched = rows(DOUBLES, 'p2');
    const natural = rows(DOUBLES);
    // The chip of P2A is the same chip in both orders: only its row moved.
    const keyOf = (grid: ReturnType<typeof rows>, label: string) => grid.flat().find(chip => chip.label === label)?.chip;
    for (const label of ['P1A', 'P1B', 'P2A', 'P2B']) expect(keyOf(switched, label)).toBe(keyOf(natural, label));
    expect(keyOf(natural, 'P1A')).not.toBe(keyOf(natural, 'P2A'));
  });
});
