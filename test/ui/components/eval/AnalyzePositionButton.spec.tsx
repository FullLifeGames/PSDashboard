import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AnalyzePositionButton } from '../../../../src/components/eval/AnalyzePositionButton';

describe('AnalyzePositionButton', () => {
  test('renders nothing without a handler or without a target', () => {
    const { container, rerender } = render(<AnalyzePositionButton disabled={false} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<AnalyzePositionButton onAnalyze={vi.fn()} target={null} disabled={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  // Round 67 (T109, gate answer 5b): one job left, a gap turn's first analysis; the deeper stage is gone.
  test('names the settings the gap turn runs at, and the click starts it', async () => {
    const onAnalyze = vi.fn();
    const { rerender } = render(<AnalyzePositionButton onAnalyze={onAnalyze} target={{ depth: 2, samples: 3, mode: 'matrix' }} disabled={false} />);
    const button = screen.getByRole('button', { name: 'Analyze this position (depth 2)' });
    expect(button).toHaveAttribute('title', expect.stringMatching(/^Search this position and its follow-up turn at the named settings\./));
    await userEvent.click(button);
    expect(onAnalyze).toHaveBeenCalledTimes(1);

    rerender(<AnalyzePositionButton onAnalyze={onAnalyze} target={{ depth: 1, samples: 1, mode: 'mcts' }} disabled={false} />);
    expect(screen.getByRole('button', { name: 'Analyze this position (MCTS)' })).toBeInTheDocument();
    rerender(<AnalyzePositionButton onAnalyze={onAnalyze} target={{ mode: 'auto' }} disabled={false} />);
    expect(screen.getByRole('button', { name: 'Analyze this position (auto)' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Think deeper/ })).toBeNull();
  });

  test('waiting on Smogon data disables it and says why', () => {
    render(<AnalyzePositionButton onAnalyze={vi.fn()} target={{ depth: 1, samples: 1, mode: 'matrix' }} disabled smogonPending />);
    const button = screen.getByRole('button');
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('title', expect.stringMatching(/^Waiting for Smogon data/));
  });
});
