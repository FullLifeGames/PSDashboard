import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { formatRead, summarizeTurn, winDeltaText, winPctText } from '@fulllifegames/eval-engine';
import { EvalLeadAnalysis, EvalTurnAnalysis } from '../../src/components/EvalTurnAnalysis';
import { leadAnalysis, misplayedSide, sideAnalysis, turnAnalysis } from '../fixtures/analysis';
import { rankedChoice } from '../fixtures/eval-result';

const names: [string, string] = ['Alice', 'Bob'];

describe('EvalTurnAnalysis', () => {
  test('the header names the turn, the swing, and the attribution; the summary and the split line follow', () => {
    const analysis = turnAnalysis(4, { attribution: 'p1-decision', p1: misplayedSide(), swing: -0.2, decisionDelta: -0.15, chanceDelta: -0.05 });
    render(<EvalTurnAnalysis analysis={analysis} playerNames={names} />);
    expect(screen.getByText('Turn 4')).toBeInTheDocument();
    expect(screen.getByText(`swing ${winDeltaText(-0.2)}`)).toBeInTheDocument();
    expect(screen.getByText('Alice misplayed')).toBeInTheDocument();
    expect(screen.getByText(summarizeTurn(analysis, names))).toBeInTheDocument();
    expect(screen.getByText(/expected from the choices/)).toHaveTextContent(`${winDeltaText(-0.15)} expected from the choices · ${winDeltaText(-0.05)} from how it rolled`);
    expect(screen.getByText(`mistake · ${winDeltaText(-0.25)}`)).toBeInTheDocument();
  });

  test('exploring an engine line passes the side, the line, and the other side\'s reply', async () => {
    const onExplore = vi.fn();
    const analysis = turnAnalysis(4);
    render(<EvalTurnAnalysis analysis={analysis} playerNames={names} onExplore={onExplore} />);
    expect(screen.queryByText(/expected from the choices/)).toBeInTheDocument();
    const rows = screen.getAllByRole('button', { name: '✓ the engine\'s move ↗' });
    expect(rows).toHaveLength(2);
    await userEvent.click(rows[0]);
    expect(onExplore).toHaveBeenCalledWith('p1', analysis.p1.best, analysis.p2.best);
    await userEvent.click(rows[1]);
    expect(onExplore).toHaveBeenLastCalledWith('p2', analysis.p2.best, analysis.p1.best);
  });

  test('doubles without played tracking show only the engine rows; read recommendations render per side', () => {
    const reads = { p1: { choice: { label: 'Earthquake', ev: 0.3, worstCase: 0.1 }, net: 0.2, confidence: 0.7, breakdown: [{ label: 'Protect', prob: 0.7, value: 0.3 }] } };
    const untracked = { played: null, playedRaw: null };
    const analysis = turnAnalysis(2, { playedTracking: false, attribution: 'shift', decisionDelta: null, p1: sideAnalysis(untracked), p2: sideAnalysis(untracked) });
    render(<EvalTurnAnalysis analysis={analysis} playerNames={names} reads={reads} />);
    expect(screen.getByText('advantage shifted')).toBeInTheDocument();
    expect(screen.getAllByText(/engine:/)).toHaveLength(2);
    expect(screen.queryByText(/^played /)).toBeNull();
    expect(screen.queryByText(/expected from the choices/)).toBeNull();
    expect(screen.getByText(formatRead(reads.p1))).toBeInTheDocument();
  });
});

describe('EvalLeadAnalysis', () => {
  test('grades both sides\' lead decisions', () => {
    render(<EvalLeadAnalysis leads={leadAnalysis()} playerNames={names} />);
    expect(screen.getByText('Team preview')).toBeInTheDocument();
    expect(screen.getByText(/^led Garchomp/)).toHaveTextContent(`led Garchomp (${winPctText(0.2)})`);
    expect(screen.getByText('✓ the engine\'s leads')).toBeInTheDocument();
    expect(screen.getByText(/^mistake ·/)).toHaveTextContent(`mistake · ${winDeltaText(-0.3)} · better: Rotom-Wash (${winPctText(-0.1)})`);
  });

  test('an unmatched lead, an inaccuracy, and a differing untiered pick each get their line', () => {
    const p2 = { played: rankedChoice('team 1', 'Lead Ferrothorn', -0.15), best: rankedChoice('team 2', 'Lead Rotom-Wash', -0.1), regret: 0.05 };
    const leads = leadAnalysis({ p1: { played: null, best: rankedChoice('team 1', 'Lead Garchomp', 0.2), regret: null }, p2: { ...p2, tier: 'inaccuracy' } });
    const { rerender } = render(<EvalLeadAnalysis leads={leads} playerNames={names} />);
    expect(screen.getByText('led leads not matched')).toBeInTheDocument();
    expect(screen.getByText(/inaccuracy/)).toHaveTextContent(`· inaccuracy (${winDeltaText(-0.05)}): Rotom-Wash was a touch better`);

    rerender(<EvalLeadAnalysis leads={leadAnalysis({ p2 })} playerNames={names} />);
    expect(screen.getByText(/^engine:/)).toHaveTextContent(`engine: Rotom-Wash (${winPctText(-0.1)})`);
    expect(screen.queryByText(/inaccuracy/)).toBeNull();
  });
});
