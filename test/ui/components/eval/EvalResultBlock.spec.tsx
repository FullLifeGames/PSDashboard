import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { winDeltaText, winPercent } from '@fulllifegames/eval-engine';
import { EvalResultBlock } from '../../../../src/components/eval/EvalResultBlock';
import { evalResult, rankedChoice } from '../../fixtures/eval-result';

const names: [string, string] = ['Alice', 'Bob'];

describe('EvalResultBlock', () => {
  test('the advantage bar, the provenance line, and the top three lines per side with their gaps', () => {
    const result = evalResult();
    const settings = { depth: 2 as const, samples: 3 as const, mode: 'matrix' as const };
    render(<EvalResultBlock result={result} status="done" playerNames={names} positionLabel="Turn 5 · main line" resultSettings={settings} />);
    const pct = winPercent(result.score);
    expect(screen.getByText('Turn 5 · main line')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: `Advantage estimate: Alice ${pct}%, Bob ${100 - pct}%` })).toBeInTheDocument();
    expect(document.querySelector('.ps-eval-bar-fill')).toHaveStyle({ width: `${pct}%` });
    expect(screen.getByText('depth 2 · 3 samples')).toBeInTheDocument();
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
    const shared = { result, playerNames: names, onPickChoice, onPickPair };
    const { rerender } = render(<EvalResultBlock {...shared} status="done" />);
    await userEvent.click(screen.getByRole('button', { name: /Swords Dance/ }));
    expect(onPickChoice).toHaveBeenCalledWith('p1', result.perSide.p1[1], result.perSide.p2[0], result);
    await userEvent.click(screen.getByRole('button', { name: /Body Press/ }));
    expect(onPickChoice).toHaveBeenLastCalledWith('p2', result.perSide.p2[1], result.perSide.p1[0], result);
    expect(screen.getByRole('button', { name: /Earthquake/ })).toHaveAttribute('title', expect.stringContaining('Play this turn in a variation; the opponent plays its top choice.'));
    expect(screen.getByText('depth 1')).toBeInTheDocument();

    rerender(<EvalResultBlock {...shared} status="stale" />);
    expect(screen.queryByRole('button', { name: /Swords Dance/ })).toBeNull();
    expect(document.querySelector('.ps-eval-stale')).not.toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Matrix' }));
    expect(screen.getByTitle(/^Earthquake × Leech Seed:/).tagName).toBe('TD');
  });

  test.each([['singles'], ['doubles']] as const)('the ranked rows (%s) name the reply the opponent plays, by the Setup setting; a result with no handler has no click sentence', kind => {
    const shared = { result: evalResult(kind), playerNames: names, status: 'done' as const, onPickChoice: vi.fn() };
    const titles = () => [...document.querySelectorAll('button.ps-eval-choice')].map(button => button.getAttribute('title') ?? '');
    const { rerender } = render(<EvalResultBlock {...shared} />);
    expect(titles().length).toBeGreaterThan(0);
    for (const title of titles()) expect(title).toMatch(/Win probability .* Play this turn in a variation; the opponent plays its top choice\.$/);
    rerender(<EvalResultBlock {...shared} opponentReads />);
    for (const title of titles()) expect(title).toMatch(/Win probability .* Play this turn in a variation; the opponent reads your move and answers with .+\.$/);
    rerender(<EvalResultBlock {...shared} onPickChoice={undefined} opponentReads />);
    for (const row of document.querySelectorAll('.ps-eval-choice')) expect(row.getAttribute('title')).not.toMatch(/Play this turn/);
  });

  test.each([
    ['singles', 0, '→ Rotom-Wash'],
    ['doubles', 0, 'Taunt → Amoonguss + Wood Hammer → Incineroar'],
  ] as const)('%s: on, a row with a floor names the reply the click plays as its worst reply; off, the floor', (kind, row, reply) => {
    const base = evalResult(kind);
    const floor = base.matrix!.p2Labels[0];
    const perSide = { ...base.perSide, p1: [{ ...base.perSide.p1[row], punishedBy: floor }, ...base.perSide.p1.slice(1)] };
    const shared = { result: { ...base, perSide }, playerNames: names, status: 'done' as const, onPickChoice: vi.fn() };
    const first = () => document.querySelector('button.ps-eval-choice')!.getAttribute('title')!;
    const { rerender } = render(<EvalResultBlock {...shared} />);
    expect(first()).toContain(`(worst reply: ${floor})`);
    rerender(<EvalResultBlock {...shared} opponentReads />);
    expect(first()).toContain(`(worst reply: ${reply})`);
    expect(first()).toContain(`the opponent reads your move and answers with ${reply}.`);
  });

  test('a wide interval flags a toss-up; MCTS provenance and the follow-up line render; no matrix, no matrix button', () => {
    const line = [{ p1: 'Stone Edge', p2: 'Protect' }];
    const perSide = { p1: [rankedChoice('move earthquake', 'Earthquake', 0.3, { line })], p2: [rankedChoice('move protect', 'Protect', -0.3)] };
    const result = evalResult('singles', { interval: 0.3, perSide, matrix: undefined });
    render(<EvalResultBlock result={result} status="done" playerNames={names} resultSettings={{ depth: 1, samples: 1, mode: 'mcts' }} />);
    expect(screen.getByText('toss-up: prediction battle')).toBeInTheDocument();
    expect(screen.getByText('MCTS')).toBeInTheDocument();
    expect(screen.getByText('then Stone Edge · Protect')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Matrix' })).toBeNull();
  });

  test('a follow-up line through a forced switch shows the switch alone, never the waiting placeholder', () => {
    const line = [{ p1: '→ Keldeo', p2: '(waiting)' }, { p1: 'Hydro Pump', p2: 'High Jump Kick' }];
    const perSide = { p1: [rankedChoice('move rapidspin', 'Rapid Spin', 0.3, { line })], p2: [rankedChoice('move fakeout', 'Fake Out', -0.3)] };
    const result = evalResult('singles', { perSide, matrix: undefined });
    render(<EvalResultBlock result={result} status="done" playerNames={names} resultSettings={{ depth: 1, samples: 1, mode: 'mcts' }} />);
    expect(screen.getByText('then → Keldeo → Hydro Pump · High Jump Kick')).toBeInTheDocument();
    expect(screen.queryByText(/\(waiting\)/)).toBeNull();
  });
});

describe('EvalResultBlock: a floor whose reply the matrix lists no column for', () => {
  const unlisted = 'Tera + Precipice Blades + Sleep Powder → Calyrex-Shadow';
  const titleOf = (result: ReturnType<typeof evalResult>) => {
    render(<EvalResultBlock result={result} status="done" playerNames={names} />);
    return document.querySelector('.ps-eval-choice')!.getAttribute('title')!;
  };
  test.each([['singles'], ['doubles']] as const)('a reply that is a column of the table reads as before (%s)', kind => {
    const base = evalResult(kind);
    const listed = base.matrix!.p2Labels[0];
    const result = evalResult(kind, { perSide: { ...base.perSide, p1: [{ ...base.perSide.p1[0], punishedBy: listed }, ...base.perSide.p1.slice(1)] } });
    expect(titleOf(result)).toContain(`(worst reply: ${listed})`);
  });

  test('doubles: a reply the table does not list is named as such', () => {
    const base = evalResult('doubles');
    const result = evalResult('doubles', { perSide: { ...base.perSide, p1: [{ ...base.perSide.p1[0], punishedBy: unlisted }, ...base.perSide.p1.slice(1)] } });
    expect(titleOf(result)).toContain(`(worst reply: ${unlisted}, which the matrix dialog does not list)`);
  });
});

describe('EvalResultBlock: the row\'s "then ..." follows the Lines section', () => {
  const pick = (label: string, slots = 1) => ({ choice: label.toLowerCase(), label, slots: Array.from({ length: slots }, () => null) });
  test.each([
    ['singles', 'Earthquake', 'Stone Edge', 'Protect', 'then Stone Edge · Protect', 'then Swords Dance · Fake Out'],
    ['doubles', 'Fake Out → Rillaboom + Spore → Tornadus', 'Flare Blitz + Protect', 'Tailwind + Protect', 'then Flare Blitz + Protect · Tailwind + Protect', 'then Rage Powder + Spore · Taunt + Protect'],
  ] as const)('%s: the line of the row replaces the principal variation', (kind, label, pvP1, pvP2, pvText, lineText) => {
    const base = evalResult(kind);
    const [lineP1, lineP2] = lineText.slice(5).split(' · ');
    const perSide = { ...base.perSide, p1: [{ ...base.perSide.p1[0], line: [{ p1: pvP1, p2: pvP2 }] }, ...base.perSide.p1.slice(1)] };
    const lines = [{
      side: 'p1' as const, label, choice: base.perSide.p1[0].choice, for: ['engine' as const], end: 0.1, endFainted: 0, visits: 50,
      steps: [{ p1: pick(label), p2: pick('Leech Seed'), dice: [] }, { p1: pick(lineP1), p2: pick(lineP2), dice: [] }],
    }];
    const result = { ...base, perSide, lines, matrix: undefined };
    render(<EvalResultBlock result={result} status="done" playerNames={names} doubles={kind === 'doubles'} />);
    expect(screen.getByText(lineText)).toBeInTheDocument();
    expect(screen.queryByText(pvText)).toBeNull();
  });
});
