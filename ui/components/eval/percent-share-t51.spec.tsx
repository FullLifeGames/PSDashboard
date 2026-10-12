import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { EvalPreferences } from '@fulllifegames/eval-engine';
import { EvalPanel } from '../../../src/components/EvalPanel';
import { EvalResultBlock } from '../../../src/components/eval/EvalResultBlock';
import { EvalTurnAnalysis } from '../../../src/components/EvalTurnAnalysis';
import { hitTitle, variationHitTitle } from '../../../src/lib/eval-graph-view';
import { evalGraph, evalResult } from '../../fixtures/eval-result';
import { misplayedSide, sideAnalysis, turnAnalysis } from '../../fixtures/analysis';

/**
 * Round 69 (T51, decision 22): the graph tooltip, the advantage bar, the ranked lines, the matrix and the turn card
 * print one map at the turn's fainted share. Expected values are written from the formula (K 1.85 up to a share of
 * 0.25, then +5 per share to 3.10 at 0.5), not read back from winPercent.
 */
const kAt = (share: number) => 1.85 + 5 * Math.min(0.25, Math.max(0, share - 0.25));
const pct = (score: number, share = 0) => Math.round(100 / (1 + Math.exp(-kAt(share) * score)));
const names: [string, string] = ['Alice', 'Bob'];

describe('the late map in the result block', () => {
  test('singles and doubles: the bar, the lines, their tooltips and the matrix cells print at the share', async () => {
    for (const kind of ['singles', 'doubles'] as const) {
      const result = evalResult(kind);
      const late = render(<EvalResultBlock result={result} status="done" playerNames={names} faintedFraction={0.5} />);
      const p1 = pct(result.score, 0.5);
      expect(screen.getByRole('img', { name: `Advantage estimate: Alice ${p1}%, Bob ${100 - p1}%` })).toBeInTheDocument();
      expect(document.querySelector('.ps-eval-bar-fill')).toHaveStyle({ width: `${p1}%` });
      const first = document.querySelectorAll('.ps-eval-choice')[0];
      expect(first).toHaveTextContent(`${pct(result.perSide.p1[0].ev, 0.5)}%`);
      expect(first).toHaveAttribute('title', expect.stringContaining(`guaranteed at least ${pct(result.perSide.p1[0].worstCase, 0.5)}%`));
      late.unmount();

      const early = render(<EvalResultBlock result={result} status="done" playerNames={names} />);
      const p1Early = pct(result.score, 0);
      expect(screen.getByRole('img', { name: `Advantage estimate: Alice ${p1Early}%, Bob ${100 - p1Early}%` })).toBeInTheDocument();
      expect(p1Early).not.toBe(p1);
      early.unmount();
    }
  });

  test('a matrix cell prints at the share', async () => {
    const result = evalResult();
    render(<EvalResultBlock result={result} status="done" playerNames={names} faintedFraction={0.5} />);
    (screen.getByRole('button', { name: 'Matrix' })).click();
    const value = result.matrix!.values[0][0];
    expect(await screen.findByTitle(new RegExp(`^${result.matrix!.p1Labels[0]} × ${result.matrix!.p2Labels[0]}:`))).toHaveTextContent(`${pct(value, 0.5)}%`);
  });
});

describe('graph and panel read one number', () => {
  const prefs: EvalPreferences = { depth: 1, samples: 1, mode: 'matrix', auto: false, autoAnalyze: false, tera: 'auto' };
  const base = () => ({
    playerNames: names, status: 'done' as const, progress: null, reconstructProgress: null, error: null, prefs,
    onPrefsChange: vi.fn(), onCancel: vi.fn(), showAuto: false, showTera: true, report: null,
  });

  test('the bar of the analyzed turn and that turn\'s graph tooltip show the same percent', () => {
    const graph = evalGraph('singles', { faintedFractions: Array.from({ length: 10 }, (_, i) => (i === 3 ? 0.5 : i / 40)) });
    const result = graph.results[3];
    const title = hitTitle({
      index: 3, score: graph.scores[3], evalErrors: graph.evalErrors, blunders: new Set(), first: 1, decided: undefined,
      playerNames: names, faintedFractions: graph.faintedFractions,
    });
    const p1 = pct(result!.score, 0.5);
    expect(title).toContain(`Alice ${p1}% · Bob ${100 - p1}%`);
    render(<EvalPanel {...base()} graph={graph} result={result} currentTurn={4} analysisTurn={4} analysis={turnAnalysis(4, { faintedFraction: 0.5 })} />);
    expect(screen.getByRole('img', { name: `Advantage estimate: Alice ${p1}%, Bob ${100 - p1}%` })).toBeInTheDocument();
  });

  test('a branch result (not the graph\'s own) reads the opening map', () => {
    const graph = evalGraph('singles', { faintedFractions: Array.from({ length: 10 }, () => 0.5) });
    const branch = evalResult('singles', { score: 0.4 });
    render(<EvalPanel {...base()} graph={graph} result={branch} currentTurn={4} analysisTurn={null} analysis={null} />);
    const p1 = pct(0.4, 0);
    expect(screen.getByRole('img', { name: `Advantage estimate: Alice ${p1}%, Bob ${100 - p1}%` })).toBeInTheDocument();
  });

  test('the graph tooltip falls back to the opening map without shares, and a variation point reads the main line share', () => {
    const args = { index: 1, score: 0.4, evalErrors: undefined, blunders: new Set<number>(), first: 1, decided: undefined, playerNames: names };
    expect(hitTitle(args)).toContain(`Alice ${pct(0.4)}%`);
    expect(hitTitle({ ...args, faintedFractions: [0, 0.5] })).toContain(`Alice ${pct(0.4, 0.5)}%`);
    expect(variationHitTitle(names, { turn: 2, score: 0.4 }, [0, 0.5])).toContain(`Alice ${pct(0.4, 0.5)}%`);
    expect(variationHitTitle(names, { turn: 2, score: 0.4 })).toContain(`Alice ${pct(0.4)}%`);
  });
});

describe('the turn card prints at the turn\'s share', () => {
  test('both sides of a graded turn, singles and doubles-shaped (untracked) cards', () => {
    const played = misplayedSide('mistake', { faintedFraction: 0.5 });
    const analysis = turnAnalysis(5, { faintedFraction: 0.5, p1: played, p2: sideAnalysis({ faintedFraction: 0.5 }) });
    render(<EvalTurnAnalysis analysis={analysis} playerNames={names} />);
    expect(document.body).toHaveTextContent(`${pct(played.played!.ev, 0.5)}% played`);
    expect(document.body).toHaveTextContent(`${pct(played.best!.ev, 0.5)}% better`);
  });

  test('untracked (doubles) rows print the engine line at the share', () => {
    const analysis = turnAnalysis(5, { playedTracking: false, faintedFraction: 0.5, p1: sideAnalysis({ faintedFraction: 0.5 }) });
    render(<EvalTurnAnalysis analysis={analysis} playerNames={names} />);
    expect(screen.getAllByText(/engine:/)[0]).toHaveTextContent(`(${pct(analysis.p1.best!.ev, 0.5)}%)`);
  });
});
