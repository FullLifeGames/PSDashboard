import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { formatRead, summarizeTurn, winDeltaText, winPctText } from '@fulllifegames/eval-engine';
import { EvalLeadAnalysis, EvalTurnAnalysis } from '../../../src/components/EvalTurnAnalysis';
import { chanceGap, leadAnalysis, misplayedSide, sideAnalysis, turnAnalysis } from '../fixtures/analysis';
import { evalResult, rankedChoice } from '../fixtures/eval-result';
import { doublesLine, playedLine } from '../fixtures/lines';
import type { WinPathsRun } from '../../../src/lib/win-paths-host';

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
    expect(screen.getByText(`mistake · ${chanceGap(0.35, 0.1)}`)).toBeInTheDocument();
  });

  test.each([['a tracked card', {}, false], ['an untracked card (doubles)', { playedTracking: false }, false], ['an open tip', {}, true]] as const)(
    '%s names the reply in its engine-move titles, off and on', (_name, extra, open) => {
      const analysis = turnAnalysis(4, { ...extra, p1: sideAnalysis(open ? { played: null, regret: null } : {}), p2: sideAnalysis(open ? { played: null, regret: null } : {}) });
      const titles = () => screen.getAllByRole('button', { name: /↗/ }).map(button => button.getAttribute('title'));
      const { rerender } = render(<EvalTurnAnalysis analysis={analysis} playerNames={names} onExplore={vi.fn()} open={open} />);
      expect(titles().length).toBeGreaterThan(0);
      expect(new Set(titles())).toEqual(new Set(['Play this turn in a variation; the opponent plays its top choice.']));
      rerender(<EvalTurnAnalysis analysis={analysis} playerNames={names} onExplore={vi.fn()} open={open} opponentReads />);
      expect(new Set(titles())).toEqual(new Set(['Play this turn in a variation; the opponent reads your move and plays the reply the search rates lowest for it.']));
    });

  test.each([['singles', {}], ['doubles', { playedSlots: [null, null] }]] as const)('the open turn of a game, %s, reads as an open position: the engine lines, no played choice, no verdict', (_kind, slots) => {
    const open = { playedRaw: undefined, played: null, regret: null, ...slots };
    const analysis = turnAnalysis(4, { attribution: 'unclear', swing: null, scoreAfter: null, playedOutcome: null, decisionDelta: null, chanceDelta: null, p1: sideAnalysis(open), p2: sideAnalysis(open) });
    render(<EvalTurnAnalysis analysis={analysis} playerNames={names} open />);
    expect(screen.getByText('Turn 4')).toBeInTheDocument();
    expect(screen.getByText('open position: nothing played yet')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/never surfaced/);
    expect(screen.queryByRole('button', { name: /Explanation/ })).toBeNull();
    expect(screen.getAllByText(/engine:/)).toHaveLength(2);
    expect(document.body.textContent).not.toMatch(/played (?!yet)/);
    const replay = render(<EvalTurnAnalysis analysis={analysis} playerNames={names} />);
    expect(replay.container.textContent).toMatch(/choice never surfaced/);
  });

  test('the summary sits closed under its toggle; a click or the keyboard opens it, and every turn starts closed', async () => {
    const analysis = turnAnalysis(4, { attribution: 'p1-decision', p1: misplayedSide(), swing: -0.2, decisionDelta: -0.15, chanceDelta: -0.05 });
    const { rerender } = render(<EvalTurnAnalysis analysis={analysis} playerNames={names} />);
    const toggle = screen.getByRole('button', { name: /Explanation/ });
    const summary = screen.getByText(summarizeTurn(analysis, names));
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveAttribute('aria-controls', summary.id);
    expect(summary).not.toBeVisible();
    expect(screen.getByText('Alice misplayed')).toBeVisible();
    expect(screen.getByText(/expected from the choices/)).toBeVisible();
    expect(screen.getByText(`mistake · ${chanceGap(0.35, 0.1)}`)).toBeVisible();

    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(summary).toBeVisible();
    await userEvent.keyboard('{Enter}');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(summary).not.toBeVisible();
    await userEvent.keyboard(' ');
    expect(summary).toBeVisible();

    const next = turnAnalysis(5, { attribution: 'p1-decision', p1: misplayedSide(), swing: -0.1, decisionDelta: -0.1, chanceDelta: 0 });
    rerender(<EvalTurnAnalysis analysis={next} playerNames={names} />);
    expect(screen.getByRole('button', { name: /Explanation/ })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByText(summarizeTurn(next, names))).not.toBeVisible();
  });

  test('a residual without a roll in its direction reads as an estimate that moved with no roll behind it, in the badge and the split line (649664 t12 shape)', () => {
    const reRead = turnAnalysis(12, { attribution: 'chance', swing: 0.24, decisionDelta: 0, chanceDelta: 0.24, rolledFor: { p1: false, p2: true } });
    const { unmount } = render(<EvalTurnAnalysis analysis={reRead} playerNames={names} />);
    expect(screen.getByText('estimate moved (no roll behind it)')).toBeInTheDocument();
    expect(screen.getByText(/expected from the choices/)).toHaveTextContent(`${winDeltaText(0)} expected from the choices · ${winDeltaText(0.24)} not explained by a roll`);
    unmount();
    render(<EvalTurnAnalysis analysis={{ ...reRead, rolledFor: { p1: true, p2: false } }} playerNames={names} />);
    expect(screen.getByText('chance swing (rolls, crits, reveals)')).toBeInTheDocument();
    expect(screen.getByText(/expected from the choices/)).toHaveTextContent('from how it rolled');
  });

  test('a read whose side lost ground loses its badge, its chip and its sentence; the turn shows its movement', () => {
    const read = sideAnalysis({ riskPaidOff: true, riskPayoff: 0.2, safe: rankedChoice('move protect', 'Protect', 0.05) });
    render(<EvalTurnAnalysis analysis={turnAnalysis(9, { attribution: 'p1-read', p1: read, swing: -0.3, chanceDelta: -0.25 })} playerNames={names} />);
    expect(screen.queryByText("Alice's read paid off")).toBeNull();
    expect(screen.queryByText(/read paid off/)).toBeNull();
    expect(screen.getByText('chance swing (rolls, crits, reveals)')).toBeInTheDocument();
    expect(screen.queryByText(/a read that paid off/)).toBeNull();
  });

  test('exploring an engine line passes the side, the line, and the other side\'s reply', async () => {
    const onExplore = vi.fn();
    const analysis = turnAnalysis(4);
    render(<EvalTurnAnalysis analysis={analysis} playerNames={names} onExplore={onExplore} />);
    expect(screen.queryByText(/expected from the choices/)).toBeInTheDocument();
    const rows = screen.getAllByRole('button', { name: '✓ the engine\'s move ↗' });
    expect(rows).toHaveLength(2);
    await userEvent.click(rows[0]);
    expect(onExplore).toHaveBeenCalledWith('p1', analysis.p1.best, analysis.p2.best, undefined);
    await userEvent.click(rows[1]);
    expect(onExplore).toHaveBeenLastCalledWith('p2', analysis.p2.best, analysis.p1.best, undefined);
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
  test.each(['singles', 'doubles'] as const)('%s: the card offers Open matrix beside the turn header only with a matrix, on a played turn and on an open tip', async kind => {
    const analysis = turnAnalysis(4);
    const { rerender } = render(<EvalTurnAnalysis analysis={analysis} playerNames={names} result={evalResult(kind)} />);
    const button = screen.getByRole('button', { name: 'Open matrix' });
    expect(button).toHaveClass('ps-btn', 'ps-eval-inline-btn');
    expect(screen.getByText('Turn 4').parentElement).toContainElement(button);
    await userEvent.click(button);
    expect(screen.getByRole('dialog', { name: "Turn 4 · Alice's choices against Bob's" })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');

    rerender(<EvalTurnAnalysis analysis={analysis} playerNames={names} result={evalResult(kind, { matrix: undefined })} />);
    expect(screen.queryByRole('button', { name: 'Open matrix' })).toBeNull();
    rerender(<EvalTurnAnalysis analysis={analysis} playerNames={names} result={null} />);
    expect(screen.queryByRole('button', { name: 'Open matrix' })).toBeNull();

    rerender(<EvalTurnAnalysis analysis={analysis} playerNames={names} result={evalResult(kind)} open />);
    expect(screen.getByRole('button', { name: 'Open matrix' })).toBeInTheDocument();
    rerender(<EvalTurnAnalysis analysis={analysis} playerNames={names} result={evalResult(kind, { matrix: undefined })} open />);
    expect(screen.queryByRole('button', { name: 'Open matrix' })).toBeNull();
  });

  test('a cell of the card\'s matrix dialog plays the pair through the card\'s handler', async () => {
    const onPickPair = vi.fn();
    render(<EvalTurnAnalysis analysis={turnAnalysis(4)} playerNames={names} result={evalResult('singles')} onPickPair={onPickPair} />);
    await userEvent.click(screen.getByRole('button', { name: 'Open matrix' }));
    await userEvent.click(screen.getByTitle(/^Earthquake × Leech Seed:/));
    expect(onPickPair).toHaveBeenCalledWith({ choice: 'move earthquake', label: 'Earthquake' }, { choice: 'move leechseed', label: 'Leech Seed' });
  });

  test('grades both sides\' lead decisions', () => {
    render(<EvalLeadAnalysis leads={leadAnalysis()} playerNames={names} />);
    expect(screen.getByText('Team preview')).toBeInTheDocument();
    expect(screen.getByText(/^led Garchomp/)).toHaveTextContent(`led Garchomp (${winPctText(0.2)})`);
    expect(screen.getByText('✓ the engine\'s leads')).toBeInTheDocument();
    expect(screen.getByText(/^mistake ·/)).toHaveTextContent(`mistake · ${chanceGap(-0.1, -0.4)} · better: Rotom-Wash (${winPctText(-0.1)})`);
  });

  test.each(['mistake', 'blunder'] as const)('a lead %s is the gap of the two chances on its card', tier => {
    const played = rankedChoice('team 1', 'Lead Ferrothorn', tier === 'blunder' ? -0.6 : -0.35);
    const best = rankedChoice('team 2', 'Lead Rotom-Wash', -0.1);
    render(<EvalLeadAnalysis leads={leadAnalysis({ p2: { played, best, regret: best.ev - played.ev, tier } })} playerNames={names} />);
    expect(screen.getByText(/^led Ferrothorn/)).toHaveTextContent(`led Ferrothorn (${winPctText(played.ev)})`);
    expect(screen.getByText(new RegExp(`^${tier} ·`))).toHaveTextContent(`${tier} · ${chanceGap(best.ev, played.ev)} · better: Rotom-Wash (${winPctText(best.ev)})`);
  });

  test('doubles: a lead pair keeps the engine\'s pick as a neutral line, without a verdict', () => {
    const played = rankedChoice('team 34', 'Lead Ogerpon-Cornerstone + Rillaboom', -0.35);
    const best = rankedChoice('team 12', 'Lead Chi-Yu + Okidogi', -0.1);
    const { rerender } = render(<EvalLeadAnalysis leads={leadAnalysis({ p2: { played, best, regret: 0.25, tier: 'mistake' } })} playerNames={names} />);
    expect(screen.queryByText(/mistake/)).toBeNull();
    expect(screen.getByText(/^engine:/)).toHaveTextContent(`engine: Chi-Yu + Okidogi (${winPctText(-0.1)})`);
    rerender(<EvalLeadAnalysis leads={leadAnalysis({ p2: { played, best, regret: 0.12, tier: 'inaccuracy' } })} playerNames={names} />);
    expect(screen.queryByText(/inaccuracy/)).toBeNull();
    expect(screen.getByText(/^engine:/)).toHaveTextContent('engine: Chi-Yu + Okidogi');
  });

  test('doubles: a led pair that matches the engine\'s pick gets no tick either, only the neutral engine line', () => {
    const pair = rankedChoice('team 12', 'Lead Landorus + Incineroar', 0.1);
    render(<EvalLeadAnalysis leads={leadAnalysis({ p1: { played: pair, best: pair, regret: 0 } })} playerNames={names} />);
    expect(screen.queryByText('✓ the engine\'s leads')).toBeNull();
    expect(screen.getByText(/^engine:/)).toHaveTextContent(`engine: Landorus + Incineroar (${winPctText(0.1)})`);
  });

  test('an unmatched lead, an inaccuracy, and a differing untiered pick each get their line', () => {
    const p2 = { played: rankedChoice('team 1', 'Lead Ferrothorn', -0.15), best: rankedChoice('team 2', 'Lead Rotom-Wash', -0.1), regret: 0.05 };
    const leads = leadAnalysis({ p1: { played: null, best: rankedChoice('team 1', 'Lead Garchomp', 0.2), regret: null }, p2: { ...p2, tier: 'inaccuracy' } });
    const { rerender } = render(<EvalLeadAnalysis leads={leads} playerNames={names} />);
    expect(screen.getByText('led leads not matched')).toBeInTheDocument();
    expect(screen.getByText(/inaccuracy/)).toHaveTextContent(`· inaccuracy (${chanceGap(-0.1, -0.15)}): Rotom-Wash was a touch better`);

    rerender(<EvalLeadAnalysis leads={leadAnalysis({ p2 })} playerNames={names} />);
    expect(screen.getByText(/^engine:/)).toHaveTextContent(`engine: Rotom-Wash (${winPctText(-0.1)})`);
    expect(screen.queryByText(/inaccuracy/)).toBeNull();
  });
});

describe('EvalTurnAnalysis, a doubles slot with no logged action', () => {
  test.each([['fell', 'Orthworm was knocked out before it moved, so the log shows no choice'], ['ended', 'Orthworm was cut off by the end of the game, so the log shows no choice']] as const)(
    'the card names the body of the slot from the turn\'s snapshot (%s)', (reason, words) => {
      const pair = rankedChoice('move 1, move 2', 'Iron Defense + Protect', 0.2);
      const side = sideAnalysis({ playedRaw: null, playedSlots: [null, { kind: 'move', name: 'Protect' }], played: pair, best: pair, safe: pair, playedPartial: true, noChoiceSlots: [{ slot: 0, reason }] });
      const snapshot = { p1: { pokemon: [{ name: 'Orthworm', isActive: true, slot: 0 }, { name: 'Dragonite', isActive: true, slot: 1 }] }, p2: { pokemon: [] } };
      const host = { rules: { gen: 9, mod: undefined }, snapshot } as unknown as Parameters<typeof EvalTurnAnalysis>[0]['linesHost'];
      render(<EvalTurnAnalysis analysis={turnAnalysis(7, { p1: side })} playerNames={names} linesHost={host} doubles />);
      expect(screen.getByText(`· ${words}`)).toBeInTheDocument();
      expect(screen.getAllByText(/^played /)[0]).toHaveTextContent(`played Protect (${winPctText(0.2)})`);
    });
});

describe('EvalTurnAnalysis, the endgame entry', () => {
  const winPaths = (turns: number[], run: WinPathsRun | null = null) => ({ endgame: { loser: 'p2' as const, turns }, offered: { loser: 'p2' as const, turns }, run, unavailable: null, playedLabel: () => null, proofAt: () => null, show: vi.fn(), hide: vi.fn() });

  test.each([false, true])('an endgame turn of the card (doubles %s) asks how the player who lost could have won from here', async doubles => {
    const host = { rules: { gen: 9, mod: undefined }, winPaths: winPaths([4, 5]) };
    render(<EvalTurnAnalysis analysis={turnAnalysis(4)} playerNames={names} linesHost={host} doubles={doubles} />);
    await userEvent.click(screen.getByRole('button', { name: 'How could Bob have won from here?' }));
    expect(host.winPaths.show).toHaveBeenCalledWith(4, 'card', 'lost');
  });

  test('a turn before the endgame has no such question', () => {
    const host = { rules: { gen: 9, mod: undefined }, winPaths: winPaths([7, 8]) };
    render(<EvalTurnAnalysis analysis={turnAnalysis(4)} playerNames={names} linesHost={host} />);
    expect(screen.queryByRole('button', { name: /have won from here/ })).toBeNull();
  });
});

describe.each([
  ['singles', false, { ...evalResult('singles'), lines: [playedLine] }],
  ['doubles', true, { ...evalResult('doubles'), lines: [{ ...doublesLine, for: ['played' as const] }] }],
] as const)('EvalTurnAnalysis, closed sections, %s', (_kind, doubles, result) => {
  const rules = { gen: 9, mod: undefined };
  const winRun = (turn: number, from: WinPathsRun['from']): WinPathsRun => ({ turn, side: 'p2', steps: [], status: 'done', from, question: 'lost' });
  const winPaths = (run: WinPathsRun | null = null) => ({ endgame: { loser: 'p2' as const, turns: [4, 5] }, offered: { loser: 'p2' as const, turns: [4, 5] }, run, unavailable: null, playedLabel: () => null, proofAt: () => null, show: vi.fn(), hide: vi.fn() });

  test('the Lines section sits closed under a toggle: aria-controls its body, a click or the keyboard opens it, every turn starts closed', async () => {
    const host = { rules, onPlay: vi.fn() };
    const { rerender } = render(<EvalTurnAnalysis analysis={turnAnalysis(4)} playerNames={names} linesHost={host} result={result} doubles={doubles} />);
    const toggle = screen.getByRole('button', { name: 'Lines' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    const body = document.getElementById(toggle.getAttribute('aria-controls')!)!;
    expect(body).not.toBeVisible();
    expect(document.querySelector('.ps-eval-line-block')).toBeNull();
    expect(screen.queryByRole('button', { name: '▶ Play' })).toBeNull();

    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(body).toBeVisible();
    expect(screen.getByRole('button', { name: '▶ Play' })).toBeVisible();
    await userEvent.keyboard('{Enter}');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('button', { name: '▶ Play' })).toBeNull();
    await userEvent.keyboard(' ');
    expect(screen.getByRole('button', { name: '▶ Play' })).toBeVisible();

    rerender(<EvalTurnAnalysis analysis={turnAnalysis(5)} playerNames={names} linesHost={host} result={result} doubles={doubles} />);
    expect(screen.getByRole('button', { name: 'Lines' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('button', { name: '▶ Play' })).toBeNull();
  });

  test('an open Lines section stays open while its result goes away and comes back; a turn away and back starts closed again', async () => {
    const host = { rules, onPlay: vi.fn() };
    const card = (turn: number, shown: typeof result | null) => <EvalTurnAnalysis analysis={turnAnalysis(turn)} playerNames={names} linesHost={host} result={shown} doubles={doubles} />;
    const { rerender } = render(card(4, result));
    await userEvent.click(screen.getByRole('button', { name: 'Lines' }));
    rerender(card(4, null));
    expect(screen.queryByRole('button', { name: 'Lines' })).toBeNull();
    rerender(card(4, result));
    expect(screen.getByRole('button', { name: 'Lines' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: '▶ Play' })).toBeVisible();
    rerender(card(5, result));
    rerender(card(4, result));
    expect(screen.getByRole('button', { name: 'Lines' })).toHaveAttribute('aria-expanded', 'false');
  });

  test('a closed Lines section builds nothing: the host is read only after the toggle opens', async () => {
    const reads = vi.fn(() => rules);
    const host = Object.defineProperty({}, 'rules', { get: reads, enumerable: true }) as { rules: typeof rules };
    render(<EvalTurnAnalysis analysis={turnAnalysis(4)} playerNames={names} linesHost={host} result={result} doubles={doubles} />);
    expect(reads).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Lines' }));
    expect(reads).toHaveBeenCalled();
  });

  test('a card without a result has no Lines toggle', () => {
    render(<EvalTurnAnalysis analysis={turnAnalysis(4)} playerNames={names} linesHost={{ rules }} doubles={doubles} />);
    expect(screen.queryByRole('button', { name: 'Lines' })).toBeNull();
  });

  test('the win-path question is a closed toggle: a click asks the host for the card\'s run, and the panel shows for that run only', async () => {
    const closed = { rules, winPaths: winPaths() };
    const { rerender } = render(<EvalTurnAnalysis analysis={turnAnalysis(4)} playerNames={names} linesHost={closed} doubles={doubles} />);
    const toggle = screen.getByRole('button', { name: 'How could Bob have won from here?' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('region')).toBeNull();
    await userEvent.click(toggle);
    expect(closed.winPaths.show).toHaveBeenCalledWith(4, 'card', 'lost');

    const opened = { rules, winPaths: winPaths(winRun(4, 'card')) };
    rerender(<EvalTurnAnalysis analysis={turnAnalysis(4)} playerNames={names} linesHost={opened} doubles={doubles} />);
    const open = screen.getByRole('button', { name: 'How could Bob have won from here?' });
    expect(open).toHaveAttribute('aria-expanded', 'true');
    expect(open).toHaveAttribute('aria-controls', screen.getByRole('region', { name: 'How could Bob have won?' }).parentElement!.id);
    await userEvent.click(open);
    expect(opened.winPaths.hide).toHaveBeenCalled();

    rerender(<EvalTurnAnalysis analysis={turnAnalysis(5)} playerNames={names} linesHost={opened} doubles={doubles} />);
    expect(screen.getByRole('button', { name: 'How could Bob have won from here?' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('region')).toBeNull();
  });

  test('a run the Game review opened does not open the card of the same turn', () => {
    const host = { rules, winPaths: winPaths(winRun(4, 'review')) };
    render(<EvalTurnAnalysis analysis={turnAnalysis(4)} playerNames={names} linesHost={host} doubles={doubles} />);
    expect(screen.getByRole('button', { name: 'How could Bob have won from here?' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('region')).toBeNull();
  });
});

describe.each([
  ['singles', 'Earthquake', evalResult('singles'), true],
  ['doubles', 'Fake Out → Rillaboom + Spore → Tornadus', evalResult('doubles'), false],
] as const)('EvalTurnAnalysis, one line per row, %s', (_kind, label, base, tracked) => {
  const pick = (name: string) => ({ choice: name.toLowerCase(), label: name, slots: [null] });
  const usual = { side: 'p1' as const, label, choice: base.perSide.p1[0].choice, for: ['engine' as const], end: 0.1, endFainted: 0, visits: 50,
    steps: [{ p1: pick(label), p2: pick('Leech Seed'), dice: [] }, { p1: pick('Roost'), p2: pick('Encore'), dice: [] }] };
  const result = { ...base, lines: [usual, { ...usual, versus: 'worst' as const, steps: [usual.steps[0], { p1: pick('Rock Slide'), p2: pick('Taunt'), dice: [] }] }] };
  const best = rankedChoice(base.perSide.p1[0].choice, label, 0.35, { line: [{ p1: 'Stone Edge', p2: 'Protect' }] });
  const analysis = turnAnalysis(4, { playedTracking: tracked, p1: misplayedSide('mistake', { best, safe: best }) });

  test('the row reads the result\'s line; Hard mode reads the worst line', () => {
    const { rerender } = render(<EvalTurnAnalysis analysis={analysis} playerNames={names} result={result} />);
    expect(screen.getByText('then Roost · Encore')).toBeInTheDocument();
    expect(screen.queryByText('then Stone Edge · Protect')).toBeNull();
    rerender(<EvalTurnAnalysis analysis={analysis} playerNames={names} result={result} opponentReads />);
    expect(screen.getByText('then Rock Slide · Taunt')).toBeInTheDocument();
    rerender(<EvalTurnAnalysis analysis={analysis} playerNames={names} result={null} />);
    expect(screen.getByText('then Stone Edge · Protect')).toBeInTheDocument();
  });
});
