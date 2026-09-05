import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThinkDeeperButton } from '../../../src/components/eval/ThinkDeeperButton';
import { evalResult } from '../../fixtures/eval-result';

describe('ThinkDeeperButton', () => {
  test('renders nothing without a handler or without a target', () => {
    const { container, rerender } = render(<ThinkDeeperButton disabled={false} result={null} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<ThinkDeeperButton onThinkDeeper={vi.fn()} thinkDeeperTarget={null} disabled={false} result={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  test('names the target settings; a gap turn gets its first analysis, an analyzed turn goes deeper', async () => {
    const onThinkDeeper = vi.fn();
    const { rerender } = render(<ThinkDeeperButton onThinkDeeper={onThinkDeeper} thinkDeeperTarget={{ depth: 2, samples: 3, mode: 'matrix' }} disabled={false} result={null} />);
    const button = screen.getByRole('button', { name: 'Analyze this position (depth 2)' });
    expect(button).toHaveAttribute('title', expect.stringMatching(/^Re-search this position/));
    await userEvent.click(button);
    expect(onThinkDeeper).toHaveBeenCalledTimes(1);

    rerender(<ThinkDeeperButton onThinkDeeper={onThinkDeeper} thinkDeeperTarget={{ depth: 1, samples: 1, mode: 'mcts' }} disabled={false} result={evalResult()} />);
    expect(screen.getByRole('button', { name: 'Think deeper about this position (MCTS)' })).toBeInTheDocument();
    rerender(<ThinkDeeperButton onThinkDeeper={onThinkDeeper} thinkDeeperTarget={{ mode: 'auto' }} disabled={false} result={evalResult()} />);
    expect(screen.getByRole('button', { name: 'Think deeper about this position (auto)' })).toBeInTheDocument();
  });

  test('waiting on Smogon data disables it and says why', () => {
    render(<ThinkDeeperButton onThinkDeeper={vi.fn()} thinkDeeperTarget={{ depth: 1, samples: 1, mode: 'matrix' }} disabled smogonPending result={null} />);
    const button = screen.getByRole('button');
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('title', expect.stringMatching(/^Waiting for Smogon data/));
  });
});
