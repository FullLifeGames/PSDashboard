import { describe, expect, test } from 'vitest';
import { render } from '@testing-library/react';
import { EvalGraph } from '../../../src/components/EvalGraph';

/** Round 89 (#104), step G4: the Game review's marks on the graph, a circle for player 1 and a square for player 2. */
const NAMES: [string, string] = ['Alice', 'Bob'];
const SCORES = [0.1, 0.3, -0.2, 0.0, 0.4];

const draw = (marks?: { turn: number; side: 'p1' | 'p2' }[]) => {
  const { container } = render(<EvalGraph scores={SCORES} playerNames={NAMES} currentTurn={2} reviewMarks={marks} />);
  return container.querySelector('svg')!;
};

describe('EvalGraph review marks', () => {
  test('a circle for player 1 and a square for player 2, each at the turn\'s point and in the player\'s colour', () => {
    const svg = draw([{ turn: 3, side: 'p1' }, { turn: 5, side: 'p2' }]);
    const circle = svg.querySelector('circle[data-review-mark="p1"]')!;
    const square = svg.querySelector('rect[data-review-mark="p2"]')!;
    expect(circle).not.toBeNull();
    expect(square).not.toBeNull();
    expect(circle.getAttribute('data-turn-mark')).toBe('3');
    expect(square.getAttribute('data-turn-mark')).toBe('5');
    expect(circle.getAttribute('stroke')).toBe('#8ac');
    expect(square.getAttribute('stroke')).toBe('#c8a');
    expect(circle.getAttribute('fill')).toBe('none');
    expect(svg.querySelectorAll('[data-review-mark]')).toHaveLength(2);
    // each mark is centred on the point of its turn
    const points = [...svg.querySelectorAll('circle')].filter(node => !node.hasAttribute('data-review-mark'));
    expect(circle.getAttribute('cx')).toBe(points[2].getAttribute('cx'));
    expect(circle.getAttribute('cy')).toBe(points[2].getAttribute('cy'));
    const side = Number(square.getAttribute('width'));
    expect(Number(square.getAttribute('x')) + side / 2).toBeCloseTo(Number(points[4].getAttribute('cx')), 5);
    expect(Number(square.getAttribute('y')) + side / 2).toBeCloseTo(Number(points[4].getAttribute('cy')), 5);
  });

  test('a turn graded on both sides carries both marks; marks never block the turn\'s hit area', () => {
    const svg = draw([{ turn: 4, side: 'p1' }, { turn: 4, side: 'p2' }]);
    expect(svg.querySelectorAll('[data-review-mark]')).toHaveLength(2);
    for (const mark of svg.querySelectorAll<SVGElement>('[data-review-mark]')) expect(mark.style.pointerEvents).toBe('none');
  });

  test('no marks, none drawn; a mark on a turn without a point is skipped', () => {
    expect(draw().querySelectorAll('[data-review-mark]')).toHaveLength(0);
    expect(draw([{ turn: 9, side: 'p1' }]).querySelectorAll('[data-review-mark]')).toHaveLength(0);
  });
});
