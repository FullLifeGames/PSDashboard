import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BLUNDER_SWING, winPercent } from '@fulllifegames/eval-engine';
import { EvalGraph } from '../../src/components/EvalGraph';
import { GRAPH_HEIGHT } from '../../src/lib/eval-graph-view';
import { leadAnalysis } from '../fixtures/analysis';

const names: [string, string] = ['Alice', 'Bob'];
const pctPair = (score: number) => `Alice ${winPercent(score)}% · Bob ${100 - winPercent(score)}%`;

/** The invisible hit column of a turn on the main line, or on the variation. */
const hit = (turn: number, line?: 'variation') =>
  document.querySelector(`rect[data-turn="${turn}"]${line ? '[data-line="variation"]' : ':not([data-line])'}`) as SVGRectElement;

describe('EvalGraph', () => {
  test('one point per evaluated turn, a hit column per turn; a gap keeps its column with the reason', async () => {
    const onSelectTurn = vi.fn();
    const evalErrors = [null, null, 'reconstruction diverged', null, null];
    render(<EvalGraph scores={[0.1, 0.2, null, -0.3, -0.35]} playerNames={names} currentTurn={2} onSelectTurn={onSelectTurn} evalErrors={evalErrors} />);
    const svg = screen.getByRole('img', { name: 'Evaluation over 5 turns for Alice vs Bob' });
    expect(svg.querySelectorAll('circle[r="2"]')).toHaveLength(4);
    expect(svg.querySelectorAll('rect[data-turn]')).toHaveLength(5);
    expect(svg.querySelectorAll('path')).toHaveLength(2);
    expect(svg.querySelectorAll('line[stroke-dasharray="3 2"]')).toHaveLength(1);
    expect(svg.querySelector('circle[r="4.5"]')).not.toBeNull();

    expect(hit(1).querySelector('title')).toHaveTextContent(`Before turn 1: ${pctPair(0.1)}`);
    expect(hit(2).querySelector('title')).toHaveTextContent(`Before turn 2 (what turn 1 produced): ${pctPair(0.2)}`);
    expect(hit(3).querySelector('title')).toHaveTextContent('Turn 3 · could not be evaluated: reconstruction diverged · click to open');
    expect(hit(3)).toHaveStyle({ cursor: 'pointer' });
    await userEvent.click(hit(3));
    expect(onSelectTurn).toHaveBeenCalledWith(3, 'main');
    await userEvent.click(hit(5));
    expect(onSelectTurn).toHaveBeenLastCalledWith(5, 'main');
  });

  test('a blunder swing rings the node whose play caused it and names it in the tooltip; without a handler nothing is clickable', () => {
    render(<EvalGraph scores={[0.3, 0.3 - BLUNDER_SWING - 0.05]} playerNames={names} currentTurn={1} />);
    const svg = screen.getByRole('img');
    const ringed = svg.querySelectorAll('circle[r="3.4"]');
    expect(ringed).toHaveLength(1);
    expect(ringed[0]).toHaveAttribute('stroke', '#f3a6a6');
    expect(hit(1).querySelector('title')).toHaveTextContent('· blunder swing');
    expect(hit(2).querySelector('title')).not.toHaveTextContent('blunder');
    expect(hit(2)).not.toHaveStyle({ cursor: 'pointer' });
  });

  test('the lead diamond opens turn 0 with the best and played leads in its tooltip', async () => {
    const onSelectTurn = vi.fn();
    render(<EvalGraph scores={[0.1, 0.2]} playerNames={names} currentTurn={0} leadScore={0.05} leadDetail={leadAnalysis()} onSelectTurn={onSelectTurn} />);
    const title = hit(0).querySelector('title')!.textContent;
    expect(title).toContain(`Team preview: ${pctPair(0.05)}`);
    expect(title).toContain('Alice best lead: Garchomp (played)');
    expect(title).toContain('Bob best lead: Rotom-Wash · played: Ferrothorn');
    expect(title).toContain('Click to open the lead analysis.');
    expect(document.querySelector('rect[transform^="rotate(45"]')).not.toBeNull();
    await userEvent.click(hit(0));
    expect(onSelectTurn).toHaveBeenCalledWith(0);
    expect(hit(1).querySelector('title')).toHaveTextContent('(what the lead decision produced)');
  });

  test('the variation overlay draws the gold curve from the branch point; its hits select the variation and the ring follows the pointer', async () => {
    const onSelectTurn = vi.fn();
    const variation = { startTurn: 2, scores: [null, null, 0.4, 0.5] };
    const shared = { scores: [0.1, 0.2, 0.1], playerNames: names, currentTurn: 4, variation, onSelectTurn, maxTurn: 3 };
    const { rerender } = render(<EvalGraph {...shared} currentLine="variation" />);
    const svg = screen.getByRole('img');
    expect(svg.querySelectorAll('path[stroke="#f0c76b"]')).toHaveLength(1);
    expect(svg.querySelectorAll('circle[fill="#f0c76b"]')).toHaveLength(2);
    expect(svg.querySelectorAll('rect[data-line="variation"]')).toHaveLength(2);
    expect(hit(4, 'variation').querySelector('title')).toHaveTextContent(`Variation, before turn 4: ${pctPair(0.5)}`);
    await userEvent.click(hit(4, 'variation'));
    expect(onSelectTurn).toHaveBeenCalledWith(4, 'variation');
    await userEvent.click(hit(3));
    expect(onSelectTurn).toHaveBeenLastCalledWith(3, 'main');
    expect(svg.querySelector('circle[r="4.5"]')).not.toBeNull();

    // The pointer on the main line at turn 4 has no main point to ring.
    rerender(<EvalGraph {...shared} currentLine="main" />);
    expect(svg.querySelector('circle[r="4.5"]')).toBeNull();
  });

  test('decided sweeps draw a strip along the decided side\'s edge and the node label carries the note', () => {
    const kingambit = { side: 'p1' as const, species: 'Kingambit' };
    const decided = [null, kingambit, kingambit, { side: 'p2' as const, species: 'Dragapult' }];
    render(<EvalGraph scores={[0.1, 0.6, 0.7, -0.6]} playerNames={names} currentTurn={1} decided={decided} />);
    const strips = screen.getByRole('img').querySelectorAll('line[stroke-width="2.5"]');
    expect(strips).toHaveLength(2);
    expect(strips[0].querySelector('title')).toHaveTextContent('practically decided: Kingambit');
    expect(strips[0]).toHaveAttribute('y1', '3');
    expect(strips[1]).toHaveAttribute('y1', String(GRAPH_HEIGHT - 3));
    expect(hit(2).querySelector('title')).toHaveTextContent('· practically decided: Kingambit');
  });

  test('nothing renders without a turn to show', () => {
    const { container } = render(<EvalGraph scores={[]} playerNames={names} currentTurn={1} />);
    expect(container).toBeEmptyDOMElement();
  });
});
