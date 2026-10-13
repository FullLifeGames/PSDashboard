import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { EvalPreferences } from '@fulllifegames/eval-engine';
import { EvalPanel } from '../../../src/components/EvalPanel';
import { WorkspaceEvalColumn } from '../../../src/components/WorkspaceEvalColumn';
import type { AppController } from '../../../src/hooks/useAppController';
import type { BranchHistoryEntry } from '../../../src/lib/branch-history';
import { evalGraph, evalResult } from '../../fixtures/eval-result';
import { pokemon, type FormatKind } from '../../fixtures/sim-state';

// The workspace test needs the evaluation column only; the bars below it have their own specs.
vi.mock('../../../src/components/PlayOutBar', () => ({ PlayOutBar: () => null }));
vi.mock('../../../src/components/BattleStatsPanel', () => ({ BattleStatsPanel: () => null }));

/**
 * Round 70 (T216): a variation point in the graph and the panel's bar of the same position print one number, at the
 * fainted share of the variation's own board (not the main line's share of that turn number, and not the opening map),
 * in every engine mode. Expected values come from the formula (K 1.85 up to a share of 0.25, then +5 per share to 3.10
 * at 0.5), not from winPercent. Scene: late game, the main line stood at 3 of 8 bodies down on turn 7, the variation
 * lost one more body and stands at 4 of 8; the live result scores 0.79 for Alice.
 */
const kAt = (share: number) => 1.85 + 5 * Math.min(0.25, Math.max(0, share - 0.25));
const pct = (score: number, share = 0) => Math.round(100 / (1 + Math.exp(-kAt(share) * score)));
const names: [string, string] = ['Alice', 'Bob'];

const SCORE = 0.79;
const MAIN_SHARE = 0.375;
const BOARD_SHARE = 0.5;
const TURN = 7;
const MODES = ['auto', 'matrix', 'mcts'] as const;

const prefsFor = (mode: EvalPreferences['mode']): EvalPreferences => ({ depth: 1, samples: 1, mode, auto: false, autoAnalyze: false, tera: 'auto' });

/** The card's share per swept turn as useGameAnalysis lists it in any engine mode; turn 7 is the late one. */
const mainShares = () => Array.from({ length: 10 }, (_, i) => (i === TURN - 1 ? MAIN_SHARE : i / 40));

/** The sweep's own record: the auto engine writes it, Matrix and MCTS leave it empty. */
function lateGraph(kind: FormatKind, mode: EvalPreferences['mode']) {
  const base = evalGraph(kind);
  return evalGraph(kind, {
    scores: base.scores.map((score, i) => (i === TURN - 1 ? SCORE : score)),
    results: base.results.map((result, i) => (i === TURN - 1 ? evalResult(kind, { score: SCORE }) : result)),
    faintedFractions: mode === 'auto' ? mainShares() : Array.from({ length: 10 }, () => null),
  });
}

const variationScores = () => Array.from({ length: 10 }, (_, i) => (i === TURN - 1 ? SCORE : null));
const variationShares = () => Array.from({ length: 10 }, (_, i) => (i === TURN - 1 ? BOARD_SHARE : null));

const expectedBar = (share: number) => `Advantage estimate: Alice ${pct(SCORE, share)}%, Bob ${100 - pct(SCORE, share)}%`;
const barLabel = () => screen.getByRole('img', { name: /^Advantage estimate:/ }).getAttribute('aria-label');
const variationTooltip = () => document.querySelector(`rect[data-turn="${TURN}"][data-line="variation"] title`)!.textContent;
const mainTooltip = () => document.querySelector(`rect[data-turn="${TURN}"]:not([data-line]) title`)!.textContent;

describe('a variation point and the panel print one number', () => {
  const panelProps = (kind: FormatKind, mode: EvalPreferences['mode'], overrides: Partial<Parameters<typeof EvalPanel>[0]> = {}): Parameters<typeof EvalPanel>[0] => ({
    playerNames: names, status: 'done', progress: null, reconstructProgress: null, error: null, prefs: prefsFor(mode),
    onPrefsChange: vi.fn(), onCancel: vi.fn(), showAuto: true, showTera: true, report: null,
    graph: lateGraph(kind, mode), faintedShares: mainShares(), result: evalResult(kind, { score: SCORE }),
    positionLabel: `Turn ${TURN} · variation`, currentTurn: TURN, currentLine: 'variation', analysisTurn: TURN - 1, analysis: null, graphMaxTurn: 10,
    variation: { startTurn: TURN - 1, scores: variationScores(), shares: variationShares() },
    ...overrides,
  });

  test('the scene discriminates: the three maps give three different percents', () => {
    expect(new Set([pct(SCORE, BOARD_SHARE), pct(SCORE, MAIN_SHARE), pct(SCORE)]).size).toBe(3);
  });

  test.each(MODES.flatMap(mode => (['singles', 'doubles'] as const).map(kind => [kind, mode] as const)))(
    '%s, engine %s: the tooltip of the variation point and the bar read the share of the variation board', (kind, mode) => {
      render(<EvalPanel {...panelProps(kind, mode)} />);
      const p1 = pct(SCORE, BOARD_SHARE);
      expect(variationTooltip()).toContain(`Alice ${p1}% · Bob ${100 - p1}%`);
      expect(barLabel()).toBe(expectedBar(BOARD_SHARE));
    },
  );

  test.each(['singles', 'doubles'] as const)('%s: a variation board with an unknown share prints the opening map in both places', kind => {
    render(<EvalPanel {...panelProps(kind, 'matrix', { variation: { startTurn: TURN - 1, scores: variationScores() } })} />);
    expect(variationTooltip()).toContain(`Alice ${pct(SCORE)}% · Bob ${100 - pct(SCORE)}%`);
    expect(barLabel()).toBe(expectedBar(0));
  });

  test.each(MODES.flatMap(mode => (['singles', 'doubles'] as const).map(kind => [kind, mode] as const)))(
    '%s, engine %s: a branch standing on the main line (no variation move yet) prints at the main line share of that turn', (kind, mode) => {
      render(<EvalPanel {...panelProps(kind, mode, { currentLine: 'main', variation: null, analysisTurn: null })} />);
      const p1 = pct(SCORE, MAIN_SHARE);
      expect(mainTooltip()).toContain(`Alice ${p1}% · Bob ${100 - p1}%`);
      expect(barLabel()).toBe(expectedBar(MAIN_SHARE));
    },
  );

  test('the lead result (turn 0, before any body fell) keeps the opening map', () => {
    const graph = { ...lateGraph('singles', 'matrix'), lead: { result: evalResult('singles', { score: SCORE }), played: { p1: null, p2: null } } };
    render(<EvalPanel {...panelProps('singles', 'matrix', { graph, result: graph.lead.result, analysisTurn: 0, currentLine: 'main', variation: null, positionLabel: null })} />);
    expect(barLabel()).toBe(expectedBar(0));
  });
});

describe('the workspace feeds the variation board shares from the branch history', () => {
  /** A late variation of one executed turn: `down` bodies of each side fainted on the board it ended on. */
  const lateEntry = (kind: FormatKind, down: number): BranchHistoryEntry => {
    const bodies = kind === 'singles' ? 6 : 4;
    const roster = () => Array.from({ length: bodies }, (_, i) => (i < down ? pokemon(`Mon${i}`, { fainted: true, hp: 0, hpPercent: 0 }) : pokemon(`Mon${i}`)));
    return {
      turnNumber: TURN - 1, kind: 'turn', p1Choice: 'move a', p2Choice: 'move b',
      p1Active: null, p1ActiveSlots: [], p2Active: null, p2ActiveSlots: [], p1Pokemon: roster(), p2Pokemon: roster(),
    };
  };

  function workspace(kind: FormatKind, mode: EvalPreferences['mode']) {
    const graph = lateGraph(kind, mode);
    // Half of each roster is down on the variation board: singles 3 of 6 per side, doubles 2 of 4 per side.
    const history = [lateEntry(kind, kind === 'singles' ? 3 : 2)];
    return {
      ctx: {
        evaluation: { graph, prefs: prefsFor(mode), setPrefs: vi.fn(), progress: null, reconstructProgress: null, error: null, cancel: vi.fn() },
        meta: { replayGen: 9, replayGameType: kind },
        smogon: { usageStats: { loading: false }, setAssumptions: { loading: false } },
        knowledge: { statsP1Info: null, statsP2Info: null },
        branch: { history },
      },
      board: {
        liveEvalStatus: 'done',
        deviation: { branchPreparing: false },
        timeline: {
          viewTurn: TURN, viewingVariation: true, liveEvalView: true, liveSimTurn: TURN, analyzableTurns: 10, analysisTurn: TURN - 1,
          handleGraphSelectLine: vi.fn(), variationSpan: { startTurn: TURN - 1, length: 1 }, variationScores: variationScores(),
        },
      },
      engine: {
        smogonPending: false,
        evalView: {
          handleEvaluate: vi.fn(), handleAnalyzeGame: vi.fn(), analyzedResult: evalResult(kind, { score: SCORE }), analyzedSettings: null,
          analyzeTarget: null, handleAnalyzeTurn: vi.fn(), evalAvailable: true,
        },
        walk: { handleExploreChoice: vi.fn(), handlePickPair: vi.fn() },
        playOutControls: { startPlayOut: vi.fn(), stopPlayOut: vi.fn(), watchFrom: vi.fn() },
      },
      transients: { playOut: null, playOutNotice: null, fastPlayOut: false, setFastPlayOut: vi.fn() },
      analysis: { turnAnalysis: null, faintedShares: mainShares(), turnReads: null, leadAnalysisData: null, gameReport: null },
    } as unknown as AppController;
  }

  test.each(MODES.flatMap(mode => (['singles', 'doubles'] as const).map(kind => [kind, mode] as const)))(
    '%s, engine %s: the gold point and the bar show the variation board, not the main line of turn 7', (kind, mode) => {
      const replayData = { players: names } as unknown as Parameters<typeof WorkspaceEvalColumn>[0]['replayData'];
      render(<WorkspaceEvalColumn app={workspace(kind, mode)} replayData={replayData} />);
      const p1 = pct(SCORE, BOARD_SHARE);
      expect(variationTooltip()).toContain(`Alice ${p1}% · Bob ${100 - p1}%`);
      expect(barLabel()).toBe(expectedBar(BOARD_SHARE));
      expect(p1).not.toBe(pct(SCORE, MAIN_SHARE));
    },
  );
});
