import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { winDeltaText, winPercent } from '@fulllifegames/eval-engine';
import { EvalResultBlock } from '../../../src/components/eval/EvalResultBlock';
import { evalResult, rankedChoice } from '../../fixtures/eval-result';

const names: [string, string] = ['Alice', 'Bob'];

describe('EvalResultBlock', () => {
  test('the advantage bar, the provenance line, and the top three lines per side with their gaps', () => {
    const result = evalResult();
    const settings = { depth: 2 as const, samples: 3 as const, mode: 'matrix' as const };
    render(<EvalResultBlock result={result} status="done" playerNames={names} positionLabel="Turn 5 · main line" resultSettings={settings} thinkDeeper={<button type="button">deeper</button>} />);
    const pct = winPercent(result.score);
    expect(screen.getByText('Turn 5 · main line')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: `Advantage estimate: Alice ${pct}%, Bob ${100 - pct}%` })).toBeInTheDocument();
    expect(document.querySelector('.ps-eval-bar-fill')).toHaveStyle({ width: `${pct}%` });
    expect(screen.getByText('depth 2 · 3 samples')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'deeper' })).toBeInTheDocument();
    expect(screen.queryByText('toss-up: prediction battle')).toBeNull();

    const choices = document.querySelectorAll('.ps-eval-choice');
    expect(choices).toHaveLength(6);
    expect(choices[0].tagName).toBe('DIV');
    expect(choices[0]).toHaveTextContent(`1.Earthquake${winPercent(0.35)}%`);
    expect(choices[1]).toHaveTextContent(`2.Swords Dance${winPercent(0.2)}%(${winDeltaText(0.2 - 0.35)})`);
    expect(choices[0]).toHaveAttribute('title', expect.stringContaining(`guaranteed at least ${winPercent(0.15)}%`));
    expect(choices[2]).toHaveAttribute('title', expect.stringContaining('(worst reply: Leech Seed)'));
    expect(choices[0]).not.toHaveAttribute('title', expect.stringContaining('Click to play'));
    expect(choices[3]).toHaveTextContent(`1.Leech Seed${winPercent(-0.3)}%`);
  });

  test('clicking a line hands the side, the line, and the other side\'s reply over; stale results are inert', async () => {
    const onPickChoice = vi.fn();
    const onPickPair = vi.fn();
    const result = evalResult();
    const shared = { result, playerNames: names, thinkDeeper: null, onPickChoice, onPickPair };
    const { rerender } = render(<EvalResultBlock {...shared} status="done" />);
    await userEvent.click(screen.getByRole('button', { name: /Swords Dance/ }));
    expect(onPickChoice).toHaveBeenCalledWith('p1', result.perSide.p1[1], result.perSide.p2[0]);
    await userEvent.click(screen.getByRole('button', { name: /Body Press/ }));
    expect(onPickChoice).toHaveBeenLastCalledWith('p2', result.perSide.p2[1], result.perSide.p1[0]);
    expect(screen.getByRole('button', { name: /Earthquake/ })).toHaveAttribute('title', expect.stringContaining('Click to play this turn out'));
    expect(screen.getByText('depth 1')).toBeInTheDocument();

    rerender(<EvalResultBlock {...shared} status="stale" />);
    expect(screen.queryByRole('button', { name: /Swords Dance/ })).toBeNull();
    expect(document.querySelector('.ps-eval-stale')).not.toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Matrix' }));
    expect(screen.getByTitle(/^Earthquake × Leech Seed:/).tagName).toBe('TD');
  });

  test('a wide interval flags a toss-up; MCTS provenance and the follow-up line render; no matrix, no matrix button', () => {
    const line = [{ p1: 'Stone Edge', p2: 'Protect' }];
    const perSide = { p1: [rankedChoice('move earthquake', 'Earthquake', 0.3, { line })], p2: [rankedChoice('move protect', 'Protect', -0.3)] };
    const result = evalResult('singles', { interval: 0.3, perSide, matrix: undefined });
    render(<EvalResultBlock result={result} status="done" playerNames={names} resultSettings={{ depth: 1, samples: 1, mode: 'mcts' }} thinkDeeper={null} />);
    expect(screen.getByText('toss-up: prediction battle')).toBeInTheDocument();
    expect(screen.getByText('MCTS')).toBeInTheDocument();
    expect(screen.getByText('then Stone Edge · Protect')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Matrix' })).toBeNull();
  });
});
