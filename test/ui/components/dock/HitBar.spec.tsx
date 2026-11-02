import { describe, expect, test } from 'vitest';
import { render } from '@testing-library/react';
import { HitBar } from '../../../../src/components/dock/HitBar';
import { BarLegend } from '../../../../src/components/dock/BarLegend';

/**
 * Round 84 (turn dock), A7b, variant F of the hit bar: four parts in a fixed order (what stays after the highest roll, the roll's
 * part, the lowest roll's part, what was lost before). The tone belongs to the bar and colors the roll's and the lowest roll's part.
 */
const widths = (container: HTMLElement) =>
  [...container.querySelectorAll<HTMLElement>('.ps-hitbar > i')].map(part => [part.className, part.style.width]);

describe('HitBar', () => {
  test('the four parts keep their order and widths, and the bar carries the tone of the lowest roll', () => {
    const { container } = render(<HitBar hp={30} min={12} max={14} />);
    expect(widths(container)).toEqual([
      ['ps-hitbar-rest', '16%'], ['ps-hitbar-roll', '2%'], ['ps-hitbar-sure', '12%'], ['ps-hitbar-lost', '70%'],
    ]);
    expect(container.querySelector('.ps-hitbar')).toHaveAttribute('data-tone', 'yellow');
  });

  test('a sure knock out is green, a weak hit on a wounded target red', () => {
    expect(render(<HitBar hp={100} min={112} max={132} />).container.querySelector('.ps-hitbar')).toHaveAttribute('data-tone', 'green');
    expect(render(<HitBar hp={48} min={4} max={5} />).container.querySelector('.ps-hitbar')).toHaveAttribute('data-tone', 'red');
  });
});

describe('the legend under the move tiles', () => {
  test('names the three parts, the colored one with three swatches', () => {
    const { container } = render(<BarLegend />);
    const legend = container.querySelector('.ps-tile-legend');
    expect(legend).not.toBeNull();
    const entries = [...legend!.querySelectorAll(':scope > span')];
    expect(entries.map(entry => entry.querySelectorAll('.ps-legend-swatch').length)).toEqual([3, 3, 1]);
    expect(entries[0]).toHaveTextContent(/lowest roll/);
    expect(entries[1]).toHaveTextContent(/roll decides/);
    expect(entries[2]).toHaveTextContent(/stays after the highest roll/);
    for (const tone of ['green', 'yellow', 'red']) expect(entries[0].querySelector(`.ps-legend-sure-${tone}`)).not.toBeNull();
  });
});
