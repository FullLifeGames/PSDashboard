import { describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EvalStatus } from '../../../src/components/eval/EvalStatus';

const base = { reconstructProgress: null, progress: null, error: null };

describe('EvalStatus', () => {
  test('idle and done show nothing', () => {
    const { container, rerender } = render(<EvalStatus {...base} status="idle" />);
    expect(container).toBeEmptyDOMElement();
    rerender(<EvalStatus {...base} status="done" />);
    expect(container).toBeEmptyDOMElement();
  });

  test('reconstructing and searching report their progress', () => {
    const { rerender, container } = render(<EvalStatus {...base} status="reconstructing" reconstructProgress={{ turn: 4, target: 9 }} />);
    expect(screen.getByText('Rebuilding position… (turn 4/9)')).toBeInTheDocument();
    rerender(<EvalStatus {...base} status="reconstructing" />);
    expect(screen.getByText('Rebuilding position…')).toBeInTheDocument();

    rerender(<EvalStatus {...base} status="searching" progress={{ done: 30, total: 120, depth: 2 }} />);
    expect(screen.getByText('Searching… depth 2')).toBeInTheDocument();
    expect(container.querySelector('.ps-eval-progress > div')).toHaveStyle({ width: '25%' });
    rerender(<EvalStatus {...base} status="searching" />);
    expect(screen.getByText('Searching… depth 1')).toBeInTheDocument();
    expect(container.querySelector('.ps-eval-progress > div')).toHaveStyle({ width: '0%' });
  });

  test('an error is an alert; a stale result asks for a re-evaluation', () => {
    const { rerender } = render(<EvalStatus {...base} status="error" error="worker crashed" />);
    expect(screen.getByRole('alert')).toHaveTextContent('Evaluation failed: worker crashed');
    rerender(<EvalStatus {...base} status="stale" />);
    expect(screen.getByText('Position changed; re-evaluate.')).toBeInTheDocument();
  });

  test('a running play-out replaces the per-turn churn with one status line', () => {
    const { rerender } = render(<EvalStatus {...base} status="searching" playOutProgress={{ startTurn: 5, turns: 1, atTurn: null }} />);
    expect(screen.getByRole('status')).toHaveTextContent('Engine is playing both sides from turn 5 — 1 turn played. The gold line below grows as it plays.');
    expect(screen.queryByText(/Searching/)).toBeNull();
    rerender(<EvalStatus {...base} status="stale" playOutProgress={{ startTurn: 5, turns: 3, atTurn: 8 }} />);
    expect(screen.getByRole('status')).toHaveTextContent('3 turns played, now at turn 8.');
    expect(screen.queryByText(/Position changed/)).toBeNull();
  });
});
