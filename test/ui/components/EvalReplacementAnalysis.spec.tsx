import { describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';
import { winPctText, type EvalResult, type ReplacementEvalData } from '@fulllifegames/eval-engine';
import { EvalReplacementAnalysis } from '../../../src/components/eval/EvalReplacementAnalysis';
import { EvalPanel } from '../../../src/components/EvalPanel';
import { evalGraph, evalResult, rankedChoice } from '../fixtures/eval-result';
import { turnAnalysis } from '../fixtures/analysis';

/**
 * Round 79 (T290): the replacement note on the card of the turn after a knockout. One sentence per replacing side: what the
 * player sent in with the win chance, then the engine's pick, "matches the engine", or "only X was left". Doubles name each slot;
 * nothing is graded, so no tier, mark or colour of a verdict appears.
 */

const names: [string, string] = ['LordEnz', 'SOULWIND'];
const WAIT = [rankedChoice('wait', '(waiting)', 0)];
const resultOf = (p1: ReturnType<typeof rankedChoice>[], p2: ReturnType<typeof rankedChoice>[]) =>
  ({ ...evalResult(), perSide: { p1, p2 } }) as EvalResult;

const record = (overrides: Partial<ReplacementEvalData> & Pick<ReplacementEvalData, 'result'>): ReplacementEvalData =>
  ({ turn: 73, ordinal: 0, forced: { p1: [0], p2: [] }, played: { p1: [], p2: [] }, ...overrides });

describe('EvalReplacementAnalysis', () => {
  const ranked = [
    rankedChoice('switch 4', '→ Zapdos-Galar', 0.47), rankedChoice('switch 2', '→ Corviknight', 0.41), rankedChoice('switch 5', '→ Toxapex', 0.2),
  ];

  test('singles: the player\'s pick and the engine\'s pick with their win chances', () => {
    render(<EvalReplacementAnalysis turn={74} records={[record({ result: resultOf(ranked, WAIT), played: { p1: ['Toxapex'], p2: [] } })]} playerNames={names} />);
    expect(screen.getByText('Before turn 74')).toBeInTheDocument();
    expect(screen.getByText(`LordEnz sent in Toxapex (${winPctText(0.2)}). The engine would have sent Zapdos-Galar (${winPctText(0.47)}).`)).toBeInTheDocument();
    expect(screen.queryByText(/matches the engine/)).toBeNull();
  });

  test('singles: the engine\'s own pick, and a pick within the inaccuracy bar, read as a match', () => {
    const { unmount } = render(<EvalReplacementAnalysis turn={74} records={[record({ result: resultOf(ranked, WAIT), played: { p1: ['Zapdos-Galar'], p2: [] } })]} playerNames={names} />);
    expect(screen.getByText(`LordEnz sent in Zapdos-Galar (${winPctText(0.47)}). That matches the engine.`)).toBeInTheDocument();
    unmount();
    render(<EvalReplacementAnalysis turn={74} records={[record({ result: resultOf([rankedChoice('switch 4', '→ A', 0.5), rankedChoice('switch 2', '→ B', 0.499)], WAIT), played: { p1: ['B'], p2: [] } })]} playerNames={names} />);
    expect(screen.getByText(/That matches the engine\./)).toBeInTheDocument();
  });

  test('one body left reads as no choice, and a pick the engine did not price says so', () => {
    const { unmount } = render(<EvalReplacementAnalysis turn={74} records={[record({
      result: resultOf([], [rankedChoice('switch 3', '→ Corviknight', 0.3)]), forced: { p1: [], p2: [0] }, played: { p1: [], p2: ['Corviknight'] },
    })]} playerNames={names} />);
    expect(screen.getByText('SOULWIND had only Corviknight left.')).toBeInTheDocument();
    unmount();
    render(<EvalReplacementAnalysis turn={74} records={[record({ result: resultOf(ranked, WAIT), played: { p1: ['Dragapult'], p2: [] } })]} playerNames={names} />);
    expect(screen.getByText('LordEnz sent in Dragapult. The engine\'s list does not price that pick.')).toBeInTheDocument();
  });

  test('doubles: two slots read as both species, a body with no second to fill the pair as no choice, a hazard knockout as a second sentence', () => {
    const pair = [rankedChoice('switch 3, switch 4', '→ Garchomp + → Rotom-Wash', 0.55), rankedChoice('switch 3, switch 5', '→ Garchomp + → Kingambit', 0.3)];
    const lone = [rankedChoice('switch 3, pass', '→ Garchomp + pass', 0.4), rankedChoice('pass, switch 3', 'pass + → Garchomp', 0.4)];
    render(<EvalReplacementAnalysis
      turn={9}
      records={[
        record({ turn: 8, result: resultOf(pair, WAIT), forced: { p1: [0, 1], p2: [] }, played: { p1: ['Rotom-Wash', 'Garchomp'], p2: [] } }),
        record({ turn: 8, ordinal: 1, result: resultOf(WAIT, lone), forced: { p1: [], p2: [1] }, played: { p1: [], p2: ['Garchomp'] } }),
      ]}
      playerNames={names}
    />);
    expect(screen.getByText(`LordEnz sent in Rotom-Wash and Garchomp (${winPctText(0.55)}). That matches the engine.`)).toBeInTheDocument();
    expect(screen.getByText('Then SOULWIND had only Garchomp left.')).toBeInTheDocument();
  });

  test('both sides at once read as two sentences', () => {
    render(<EvalReplacementAnalysis
      turn={5}
      records={[record({
        result: resultOf([rankedChoice('switch 2', '→ A', 0.5), rankedChoice('switch 3', '→ B', 0.2)], [rankedChoice('switch 2', '→ C', 0.6), rankedChoice('switch 3', '→ D', 0.1)]),
        forced: { p1: [0], p2: [0] }, played: { p1: ['B'], p2: ['C'] },
      })]}
      playerNames={names}
    />);
    expect(screen.getByText(`LordEnz sent in B (${winPctText(0.2)}). The engine would have sent A (${winPctText(0.5)}).`)).toBeInTheDocument();
    expect(screen.getByText(`SOULWIND sent in C (${winPctText(0.6)}). That matches the engine.`)).toBeInTheDocument();
  });

  test('nothing is graded: no tier word, no verdict mark', () => {
    const { container } = render(<EvalReplacementAnalysis turn={74} records={[record({ result: resultOf(ranked, WAIT), played: { p1: ['Toxapex'], p2: [] } })]} playerNames={names} />);
    expect(container.textContent).not.toMatch(/blunder|mistake|inaccuracy|✓|✗/);
  });
});

describe('the replacement note on the turn card', () => {
  const graphWith = (records: ReplacementEvalData[] | null) => {
    const graph = evalGraph();
    return { ...graph, replacements: [null, records, null] };
  };
  const props = (graph: ReturnType<typeof evalGraph>, extra: Record<string, unknown> = {}) => ({
    status: 'done', result: null, error: null, progress: null, prefs: { depth: 1, samples: 1, mode: 'matrix', auto: false, autoAnalyze: false, tera: 'auto' },
    onPrefsChange: () => {}, onCancel: () => {}, showAuto: false, showTera: true, graph, currentTurn: 2, analysis: turnAnalysis(2),
    playerNames: names, analysisTurn: 2, graphMaxTurn: 3, onAnalyzeGame: () => {}, ...extra,
  }) as unknown as Parameters<typeof EvalPanel>[0];
  const data = record({ turn: 1, result: resultOf([rankedChoice('switch 4', '→ A', 0.5), rankedChoice('switch 2', '→ B', 0.2)], WAIT), played: { p1: ['B'], p2: [] } });

  test('the card of the turn after the knockout shows the note above the turn analysis; other turns and a variation show none', () => {
    const { rerender } = render(<EvalPanel {...props(graphWith([data]))} />);
    expect(screen.getByText('Before turn 2')).toBeInTheDocument();
    expect(screen.getByText('Turn 2')).toBeInTheDocument();
    const note = screen.getByText('Before turn 2');
    const card = screen.getByText('Turn 2');
    expect(note.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    rerender(<EvalPanel {...props(graphWith([data]), { currentTurn: 3, analysisTurn: 3, analysis: turnAnalysis(3) })} />);
    expect(screen.queryByText(/^Before turn d+$/)).toBeNull();
    rerender(<EvalPanel {...props(graphWith(null))} />);
    expect(screen.queryByText(/^Before turn d+$/)).toBeNull();
    rerender(<EvalPanel {...props(graphWith([data]), { analysis: null })} />);
    expect(screen.queryByText(/^Before turn d+$/)).toBeNull();
  });
});
