import { describe, expect, test } from 'vitest';
import { allTurnEvents, type EvalResult } from '@fulllifegames/eval-engine';
import type { TurnSnapshot } from '@fulllifegames/replay-core';
import {
  analyzeTurnAt, computeGameReportData, turnFaintedFraction, type AnalysisGraphData, type TurnAnalysisContext,
} from '../../src/lib/analysis-context';
import { evalGraph, evalResult } from '../fixtures/eval-result';
import { parseReplayLog } from '@fulllifegames/replay-core';
import { replayData as replayOf, replayFixture } from '../fixtures/replay';

const { replayData, snapshots } = replayFixture('singles');

/** Every result carries a near-decided roll for p1 (649664 t3 shape: a 90% roll on full teams). */
const nearResult = (score: number): EvalResult => evalResult('singles', {
  score,
  unanswered: { p1: [], p2: [], nearDecided: { side: 'p1', species: 'Medicham-Mega', odds: 0.9, removes: 'Keldeo' } },
});

const graphWith = (faintedFractions: (number | null)[] | undefined): AnalysisGraphData => {
  const full = evalGraph('singles');
  const turns = snapshots.length;
  const scores = full.scores.slice(0, turns);
  return {
    scores, results: scores.map(score => nearResult(score)),
    played: scores.map(() => null), playedOutcome: scores.map(() => null),
    verified: scores.map(() => null), sensitivity: scores.map(() => null),
    ...(faintedFractions ? { faintedFractions } : {}),
  };
};

const contextWith = (turnSnapshots: TurnSnapshot[]): TurnAnalysisContext => ({
  snapshots: turnSnapshots,
  turnEventsIndex: allTurnEvents(replayData.log),
  activesForTurn: () => null,
  playedHistory: { p1: [], p2: [] },
});

const nearAt = (turn: number, graph: AnalysisGraphData, context: TurnAnalysisContext) =>
  analyzeTurnAt({ turn, graph, context, includeSacks: false })?.p1.nearDecided;

/** Round 63 (T18): the walk and the card hand the turn's fainted share to analyzeTurn. */
describe('analyzeTurnAt passes the phase of the turn', () => {
  test('the sweep\'s recorded share decides: none fallen keeps the near sentence quiet, a quarter lets it speak', () => {
    const graph = graphWith(snapshots.map((_, index) => (index === 1 ? 0.25 : 0)));
    const context = contextWith(snapshots);
    expect(nearAt(1, graph, context)?.announce).toBe(false);
    expect(nearAt(2, graph, context)?.announce).toBe(true);
  });

  test('without a recorded share (a manual mode never records one) the pre-turn snapshot counts the fallen bodies', () => {
    const fallen = structuredClone(snapshots);
    for (const pokemon of fallen[1].p2.pokemon.slice(0, 3)) pokemon.fainted = true;
    const context = contextWith(fallen);
    for (const graph of [graphWith(undefined), graphWith(snapshots.map(() => null))]) {
      expect(nearAt(1, graph, context)?.announce).toBe(false);
      expect(nearAt(2, graph, context)?.announce).toBe(true);
    }
  });
});

/**
 * Round 64 (T123 point 7): without a recorded share the fallback counted the
 * six bodies team preview lists per side, where a VGC side brings four
 * (2629703929 t9: the sweep's 0.5 against the snapshot's 0.333). The
 * protocol's own |teamsize| line names how many each side brought.
 */
describe('the fallback share counts the bodies each side brought', () => {
  const vgc = replayOf('vgc');
  vgc.log = vgc.log.replace('|teampreview\n', '|teampreview|4\n|teamsize|p1|4\n|teamsize|p2|4\n');
  const vgcSnapshots = parseReplayLog(vgc.log);
  const vgcGraph: AnalysisGraphData = {
    scores: vgcSnapshots.map(() => 0.3),
    results: vgcSnapshots.map(() => evalResult('doubles', {
      score: 0.3,
      unanswered: { p1: [], p2: [], nearDecided: { side: 'p1', species: 'Raichu', odds: 0.9, removes: 'Bulbasaur' } },
    })),
    played: vgcSnapshots.map(() => null), playedOutcome: vgcSnapshots.map(() => null),
    verified: vgcSnapshots.map(() => null), sensitivity: vgcSnapshots.map(() => null),
  };

  test('VGC: two of the eight brought bodies fallen is a quarter, so the near sentence speaks', () => {
    const fallen = structuredClone(vgcSnapshots);
    for (const pokemon of fallen[1].p2.pokemon.slice(0, 2)) pokemon.fainted = true;
    expect(turnFaintedFraction(vgcGraph, fallen, 2)).toBe(0.25);
    expect(nearAt(2, vgcGraph, contextWith(fallen))?.announce).toBe(true);
  });

  test('singles: the protocol says six per side, the listed six, so the share is unchanged', () => {
    const fallen = structuredClone(snapshots);
    for (const pokemon of fallen[1].p2.pokemon.slice(0, 3)) pokemon.fainted = true;
    expect(turnFaintedFraction(graphWith(undefined), fallen, 2)).toBe(3 / 12);
  });
});

/**
 * Round 63 fix: the report walk marks the forced-win sentence spoken
 * whenever it speaks — since T19 that includes a proof under 0.9 whose open
 * event holds the bar down (649664 t24) — so the walk says it once.
 */
describe('the report walk speaks the forced-win sentence once', () => {
  test('a proof under 0.9 that speaks on the first turn stays quiet on the next', () => {
    const forcedWin = {
      side: 'p1' as const, turns: 5, mass: 0.8, caveat: 'barring-crit' as const, engineScore: -0.95, states: 40,
      open: { side: 'p1' as const, moveId: 'hydropump', label: 'Hydro Pump', odds: 0.8, kind: 'hit' as const },
    };
    const turns = snapshots.length;
    const graph: AnalysisGraphData = {
      scores: Array.from({ length: turns }, () => 0.7875),
      results: Array.from({ length: turns }, () => evalResult('singles', { score: 0.7875, forcedWin })),
      played: Array.from({ length: turns }, () => null), playedOutcome: Array.from({ length: turns }, () => null),
      verified: Array.from({ length: turns }, () => null), sensitivity: Array.from({ length: turns }, () => null),
    };
    const walk = computeGameReportData({ replayData, graph, context: contextWith(snapshots), winner: 'p1', tendencies: null });
    expect(walk?.analyses[0]?.p1.forcedWin?.announce).toBe(true);
    expect(walk?.analyses[1]?.p1.forcedWin?.announce).toBe(false);
  });
});
