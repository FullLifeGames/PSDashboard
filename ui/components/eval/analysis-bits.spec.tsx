import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { winPctText } from '@fulllifegames/eval-engine';
import { EngineRow, ExplorableLabel, KoSuffix, MiniBar } from '../../../src/components/eval/analysis-bits';
import { rankedChoice } from '../../fixtures/eval-result';
import { sideAnalysis } from '../../fixtures/analysis';

describe('ExplorableLabel', () => {
  test('is a plain span without a handler and an explore button with one', async () => {
    const onClick = vi.fn();
    const { rerender } = render(<ExplorableLabel label="Earthquake" />);
    expect(screen.getByText('Earthquake')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
    rerender(<ExplorableLabel label="Earthquake" onClick={onClick} />);
    await userEvent.click(screen.getByRole('button', { name: 'Earthquake ↗' }));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button')).toHaveAttribute('title', 'Play this line out in a branch');
  });
});

describe('MiniBar', () => {
  test('fills right of center for a positive value and left for a negative one, clamped to the range', () => {
    const { container, rerender } = render(<MiniBar value={0.5} />);
    const fill = () => container.querySelector('span > span') as HTMLElement;
    expect(fill()).toHaveStyle({ left: '50%', width: '25%' });
    rerender(<MiniBar value={-0.5} />);
    expect(fill()).toHaveStyle({ left: '25%', width: '25%' });
    rerender(<MiniBar value={3} />);
    expect(fill()).toHaveStyle({ left: '50%', width: '50%' });
  });
});

describe('EngineRow', () => {
  test('shows only the engine line with its win chance and follow-up, clickable to explore', async () => {
    const onExplore = vi.fn();
    const best = rankedChoice('move fakeout 1, move spore 2', 'Fake Out → Rillaboom + Spore → Tornadus', 0.3, { line: [{ p1: 'Flare Blitz', p2: 'Protect' }] });
    render(<EngineRow name="Alice" side={sideAnalysis({ best, played: null })} onExplore={onExplore} />);
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText(/engine:/)).toHaveTextContent(`engine: Fake Out → Rillaboom + Spore → Tornadus ↗ (${winPctText(0.3)})`);
    expect(screen.getByText('then Flare Blitz · Protect')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Fake Out/ }));
    expect(onExplore).toHaveBeenCalledWith(best);
  });

  test('renders nothing without an engine line', () => {
    const { container } = render(<EngineRow name="Alice" side={sideAnalysis({ best: null })} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('KoSuffix', () => {
  test('quotes the KO odds as a product, hidden at zero and at certainty', () => {
    const { container, rerender } = render(<KoSuffix odds={{ accuracy: 0.9, killFraction: 0.5 }} />);
    expect(screen.getByText('· 45% KO')).toHaveAttribute('title', '90% to hit × 50% of damage rolls KO · analytic odds vs the standing active.');
    rerender(<KoSuffix odds={{ accuracy: 1, killFraction: 1 }} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<KoSuffix odds={{ accuracy: 1, killFraction: 0 }} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<KoSuffix />);
    expect(container).toBeEmptyDOMElement();
  });
});
