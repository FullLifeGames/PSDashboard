import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { winPctText } from '@fulllifegames/eval-engine';
import { EngineRow, ExplorableLabel, KoSuffix, MiniBar } from '../../../../src/components/eval/analysis-bits';
import { evalResult, rankedChoice } from '../../fixtures/eval-result';
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
    expect(screen.getByRole('button')).toHaveAttribute('title', 'Play this turn in a variation; the opponent plays its top choice.');
  });

  // Round 89 (#153, HM-2): the title names which reply the opponent gives, by the Setup setting.
  test('the title says which reply the opponent plays, off and on', () => {
    const { rerender } = render(<ExplorableLabel label="Earthquake" onClick={vi.fn()} opponentReads={false} />);
    expect(screen.getByRole('button')).toHaveAttribute('title', 'Play this turn in a variation; the opponent plays its top choice.');
    rerender(<ExplorableLabel label="Earthquake" onClick={vi.fn()} opponentReads />);
    expect(screen.getByRole('button')).toHaveAttribute('title', 'Play this turn in a variation; the opponent reads your move and plays the reply the search rates lowest for it.');
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

  // Round 89 (#153, HM-2): the untracked row (a doubles card) names the reply too.
  test('the explore title follows the Setup setting', () => {
    const best = rankedChoice('move fakeout 1, move spore 2', 'Fake Out → Rillaboom + Spore → Tornadus', 0.3);
    const { rerender } = render(<EngineRow name="Alice" side={sideAnalysis({ best, played: null })} onExplore={vi.fn()} />);
    expect(screen.getByRole('button', { name: /Fake Out/ })).toHaveAttribute('title', 'Play this turn in a variation; the opponent plays its top choice.');
    rerender(<EngineRow name="Alice" side={sideAnalysis({ best, played: null })} onExplore={vi.fn()} opponentReads />);
    expect(screen.getByRole('button', { name: /Fake Out/ })).toHaveAttribute('title', 'Play this turn in a variation; the opponent reads your move and plays the reply the search rates lowest for it.');
  });

  test('a follow-up through a forced-switch node shows the replacement alone, never the waiting placeholder', () => {
    const best = rankedChoice('move fakeout 1, move spore 2', 'Fake Out → Rillaboom + Spore → Tornadus', 0.3, {
      line: [{ p1: '(waiting)', p2: '→ Rillaboom + Protect' }, { p1: 'Flare Blitz', p2: 'Protect' }],
    });
    render(<EngineRow name="Alice" side={sideAnalysis({ best, played: null })} />);
    expect(screen.getByText('then → Rillaboom + Protect → Flare Blitz · Protect')).toBeInTheDocument();
    expect(screen.queryByText(/\(waiting\)/)).toBeNull();
  });

  // Round 89 (LN-4): the untracked row reads the line the Lines section shows, too.
  test('the follow-up reads the result\'s line for the row, not the principal variation', () => {
    const label = 'Fake Out → Rillaboom + Spore → Tornadus';
    const pick = (name: string) => ({ choice: name.toLowerCase(), label: name, slots: [null, null] });
    const best = rankedChoice('move fakeout 1, move spore 2', label, 0.3, { line: [{ p1: 'Flare Blitz', p2: 'Protect' }] });
    const result = evalResult('doubles', { lines: [{
      side: 'p1', label, choice: best.choice, for: ['engine'], end: 0.1, endFainted: 0, visits: 50,
      steps: [{ p1: pick(label), p2: pick('Tailwind'), dice: [] }, { p1: pick('Rage Powder + Spore'), p2: pick('Taunt + Protect'), dice: [] }],
    }] });
    render(<EngineRow name="Alice" side={sideAnalysis({ best, played: null })} rowLines={{ result, side: 'p1' }} />);
    expect(screen.getByText('then Rage Powder + Spore · Taunt + Protect')).toBeInTheDocument();
    expect(screen.queryByText('then Flare Blitz · Protect')).toBeNull();
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
