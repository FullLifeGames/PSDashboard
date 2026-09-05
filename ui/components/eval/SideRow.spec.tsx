import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { winDeltaText, winPctText } from '@fulllifegames/eval-engine';
import { SideRow } from '../../../src/components/eval/SideRow';
import { rankedChoice } from '../../fixtures/eval-result';
import { misplayedSide, sideAnalysis } from '../../fixtures/analysis';

describe('SideRow', () => {
  test('a side on the engine\'s line: the played move with its win chance and floor, the agreement tick, no comparison', async () => {
    const onExplore = vi.fn();
    const side = sideAnalysis();
    render(<SideRow name="Alice" side={side} onExplore={onExplore} />);
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText(/^played /)).toHaveTextContent(`played Earthquake (${winPctText(0.35)})`);
    expect(screen.getByText(/· risked/)).toHaveTextContent(`· risked ${winPctText(0.15)}`);
    await userEvent.click(screen.getByRole('button', { name: '✓ the engine\'s move ↗' }));
    expect(onExplore).toHaveBeenCalledWith(side.best);
    expect(screen.queryByText('difference:')).toBeNull();
  });

  test('a mistake: the regret chip, the played line against the engine line, and their difference', async () => {
    const onExplore = vi.fn();
    const side = misplayedSide();
    const { rerender } = render(<SideRow name="Alice" side={side} onExplore={onExplore} />);
    expect(screen.getByText(`mistake · ${winDeltaText(-0.25)}`)).toHaveAttribute('title', 'Alice gave up this much win probability vs the engine\'s best.');
    expect(screen.queryByText(/engine:/)).toBeNull();
    expect(screen.getByText(`${winPctText(0.1)} played`)).toBeInTheDocument();
    expect(screen.getByText('· worst vs Leech Seed')).toBeInTheDocument();
    expect(screen.getByText(`${winPctText(0.35)} better:`)).toBeInTheDocument();
    expect(screen.getByText('· worst vs Protect')).toBeInTheDocument();
    // Two different moves differ wholesale: the labels tell the story, no condensed difference.
    expect(screen.queryByText('difference:')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Earthquake ↗' }));
    expect(onExplore).toHaveBeenCalledWith(side.best);

    const teraBest = rankedChoice('move earthquake terastallize', 'Tera + Earthquake', 0.35);
    rerender(<SideRow name="Alice" side={misplayedSide('mistake', { best: teraBest, played: rankedChoice('move earthquake', 'Earthquake', 0.1) })} />);
    expect(screen.getByText('difference:').nextElementSibling).toHaveTextContent(/^only the/);
  });

  test('a blunder reads as a blunder; a setup move softens the chip into a caveat', () => {
    const { rerender } = render(<SideRow name="Alice" side={misplayedSide('blunder')} />);
    expect(screen.getByText(`blunder · ${winDeltaText(-0.5)}`)).toBeInTheDocument();
    rerender(<SideRow name="Alice" side={misplayedSide('mistake', { playedRaw: { kind: 'move', name: 'Swords Dance' } })} />);
    expect(screen.getByText(`${winDeltaText(-0.25)} regret · setup caveat`)).toBeInTheDocument();
  });

  test('an unpunished risk, a paid-off read, a sack, and a deeper verification each get their note', () => {
    const { rerender } = render(<SideRow name="Alice" side={misplayedSide('mistake', { riskUnpunished: true })} />);
    expect(screen.getByText(`${winDeltaText(-0.25)} regret · risk unpunished`)).toBeInTheDocument();
    expect(screen.getByText(`${winPctText(0.15)} safe:`)).toBeInTheDocument();

    rerender(<SideRow name="Alice" side={sideAnalysis({ riskPaidOff: true, riskPayoff: 0.12, safe: rankedChoice('move protect', 'Protect', 0.05) })} />);
    expect(screen.getByText(`read paid off · ${winDeltaText(0.12)}`)).toBeInTheDocument();

    rerender(<SideRow name="Alice" side={misplayedSide('mistake', { sacrifice: { name: 'Toxapex', hpFraction: 0.12 } })} />);
    expect(screen.getByText('· sacked Toxapex (12% HP)')).toBeInTheDocument();
    expect(screen.queryByText(/^mistake ·/)).toBeNull();

    rerender(<SideRow name="Alice" side={sideAnalysis({ verifiedAtDepth: true, tier: 'inaccuracy', regret: 0.12 })} />);
    expect(screen.getByText('· verified deeper')).toBeInTheDocument();
    expect(screen.getByText(`· inaccuracy (${winDeltaText(-0.12)})`)).toBeInTheDocument();
  });

  test('a prevented action and an unseen partner are spelled out; the sensitivity note names the guessed item', () => {
    const { rerender } = render(<SideRow name="Alice" side={sideAnalysis({ played: null, playedRaw: null, prevented: 'flinch' })} />);
    expect(screen.getByText('flinched: the chosen action never surfaced')).toBeInTheDocument();
    expect(screen.getByText(/engine:/)).toHaveTextContent(`engine: Earthquake (${winPctText(0.35)})`);

    const sensitivity = { species: 'Kingambit', alternatives: [{ item: 'Leftovers', tier: 'none' as const }, { item: 'Air Balloon', tier: 'mistake' as const }] };
    rerender(<SideRow name="Alice" side={sideAnalysis({ playedPartial: true, sensitivity })} />);
    expect(screen.getByText('· partner unseen')).toBeInTheDocument();
    expect(screen.getByText('± hinges on Kingambit')).toHaveAttribute('title', 'The verdict depends on a guessed item: Leftovers: fine · Air Balloon: mistake');
  });
});
