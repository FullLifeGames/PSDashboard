import { describe, expect, test, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { winDeltaText } from '@fulllifegames/eval-engine';
import { EvalGameReport } from '../../src/components/EvalGameReport';
import type { TurnEvalSettings } from '../../src/hooks/useEvaluation';
import { gameReport } from '../fixtures/eval-result';
import { leadAnalysis, turnAnalysis } from '../fixtures/analysis';

const names: [string, string] = ['Alice', 'Bob'];

/** The chip of one turn (T3 but not T30). */
const chip = (turn: number) => screen.getByRole('button', { name: new RegExp(`^T${turn}(?!\\d)`) });

describe('EvalGameReport', () => {
  test('the summary and the accuracy line; without chips there is nothing to click', () => {
    render(<EvalGameReport report={gameReport()} playerNames={names} />);
    expect(screen.getByText('Game report')).toBeInTheDocument();
    expect(screen.getByText('Alice converted the turn-7 swing into a clean endgame.')).toBeInTheDocument();
    expect(screen.getByText(/^accuracy:/)).toHaveTextContent('accuracy: Alice 92% · Bob 81%');
    expect(screen.queryByText(/no clear misplays/)).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });

  test('misplay, read, denied-end, and key-moment chips jump to their turn and carry the settings badge', async () => {
    const onSelectTurn = vi.fn();
    const report = gameReport({
      misplays: [
        { turn: 3, side: 'p1', regret: 0.3, played: 'Stone Edge', better: 'Earthquake', tier: 'mistake' },
        { turn: 5, side: 'p1', regret: 0.5, played: 'Swords Dance', better: 'Earthquake', tier: 'blunder', riskUnpunished: true },
        { turn: 6, side: 'p1', regret: 0.2, played: '→ Toxapex', better: 'Earthquake', sacrifice: true },
      ],
      reads: [{ turn: 8, side: 'p2', played: 'Body Press', payoff: 0.14 }],
      deniedEnd: { turn: 9, side: 'p2', species: 'Kingambit', move: 'Knock Off', odds: 0.9, removes: 'Garchomp', turnsRemaining: 3 },
      keyMoments: [turnAnalysis(7, { attribution: 'chance', swing: -0.35 })],
    });
    const settings: Record<number, TurnEvalSettings> = { 3: { depth: 2, samples: 3, mode: 'matrix' }, 5: { depth: 1, samples: 1, mode: 'mcts' } };
    render(<EvalGameReport report={report} playerNames={names} onSelectTurn={onSelectTurn} settingsFor={turn => settings[turn] ?? null} />);

    const mistake = within(chip(3));
    expect(mistake.getByText('Alice')).toBeInTheDocument();
    expect(mistake.getByText('Stone Edge')).toBeInTheDocument();
    expect(mistake.getByText('better: Earthquake')).toBeInTheDocument();
    expect(mistake.getByText(winDeltaText(-0.3))).toBeInTheDocument();
    expect(mistake.getByText('d2')).toHaveAttribute('title', 'Evaluated at depth 2 · 3 samples · deepen from the turn view');
    await userEvent.click(chip(3));
    expect(onSelectTurn).toHaveBeenCalledWith(3);

    expect(within(chip(5)).getByText('risk (unpunished)')).toBeInTheDocument();
    expect(within(chip(5)).getByText('MCTS')).toHaveAttribute('title', 'Evaluated with the MCTS engine');
    expect(within(chip(6)).getByText('sack')).toBeInTheDocument();
    expect(screen.getByText('Bob: no clear misplays')).toBeInTheDocument();
    expect(within(chip(8)).getByText(`read paid off ${winDeltaText(0.14)}`)).toBeInTheDocument();
    expect(within(chip(9)).getByText('one 90% roll from ending it — missed')).toBeInTheDocument();
    expect(within(chip(9)).getByText('Knock Off')).toBeInTheDocument();
    expect(within(chip(7)).getByText('chance swing (rolls, crits, reveals)')).toBeInTheDocument();
    expect(within(chip(7)).getByText(winDeltaText(-0.35))).toBeInTheDocument();
    await userEvent.click(chip(7));
    expect(onSelectTurn).toHaveBeenLastCalledWith(7);
  });

  test('a lead misplay gets a T0 chip that opens the team preview', async () => {
    const onSelectTurn = vi.fn();
    render(<EvalGameReport report={gameReport()} playerNames={names} leads={leadAnalysis()} onSelectTurn={onSelectTurn} />);
    const lead = within(chip(0));
    expect(lead.getByText('Bob')).toBeInTheDocument();
    expect(lead.getByText('led Ferrothorn')).toBeInTheDocument();
    expect(lead.getByText('better: Rotom-Wash')).toBeInTheDocument();
    expect(lead.getByText(winDeltaText(-0.3))).toBeInTheDocument();
    await userEvent.click(chip(0));
    expect(onSelectTurn).toHaveBeenCalledWith(0);
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });

  test('an untracked report makes no "clean" claims; a missing accuracy shows a dash', () => {
    const misplays = [{ turn: 2, side: 'p2' as const, regret: 0.25, played: 'Protect', better: 'Tailwind', tier: 'mistake' as const }];
    render(<EvalGameReport report={gameReport({ tracked: false, accuracy: { p1: 88, p2: null }, misplays })} playerNames={names} />);
    expect(screen.getByText(/^accuracy:/)).toHaveTextContent('accuracy: Alice 88% · Bob —');
    expect(screen.queryByText(/no clear misplays/)).toBeNull();
    expect(within(chip(2)).getByText('Bob')).toBeInTheDocument();
  });
});
