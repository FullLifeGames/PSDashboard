import { describe, expect, test } from 'vitest';
import { allTurnEvents, type EvalResult, summarizeTurn } from '@fulllifegames/eval-engine';
import type { TurnSnapshot } from '@fulllifegames/replay-core';
import {
  analyzeTurnAt,
  computeGameReportData,
  turnFaintedFraction,
  type AnalysisGraphData,
  type TurnAnalysisContext,
} from '../../../src/lib/analysis-context';
import { evalGraph, evalResult } from '../fixtures/eval-result';
import { parseReplayLog } from '@fulllifegames/replay-core';
import { replayData as replayOf, replayFixture, type ReplayKind } from '../fixtures/replay';

describe('analysis-context', () => {
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
   * Without a recorded share the fallback counted the six bodies team preview lists per side, where a VGC side brings four (2629703929 t9: the
   * sweep's 0.5 against the snapshot's 0.333). The protocol's own |teamsize| line names how many each side brought.
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

  /** The walk marks the forced-win sentence spoken whenever it speaks, including a proof under 0.9 whose open event holds the bar down (649664 t24). */
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

  /** The dice markers and move hits are read from the turn's protocol against the pre-turn snapshot, so the luck sentences can tell a roll from a re-read. */
  describe('analyzeTurnAt passes the rolls of the turn', () => {
    test('singles: a crit on turn 1 is a roll for p1, a turn without dice rolled for nobody', () => {
      const critLog = replayData.log.replace('|-damage|p2a: Kingambit|55/100', () => '|-crit|p2a: Kingambit\n|-damage|p2a: Kingambit|55/100');
      const context = { ...contextWith(snapshots), turnEventsIndex: allTurnEvents(critLog) };
      const graph = graphWith(undefined);
      expect(analyzeTurnAt({ turn: 1, graph, context, includeSacks: true })?.rolledFor).toEqual({ p1: true, p2: false });
      expect(analyzeTurnAt({ turn: 2, graph, context, includeSacks: true })?.rolledFor).toEqual({ p1: false, p2: false });
    });

    test('VGC: a crit on p2a favors p1, and the report walk carries the same rolls as the card', () => {
      const vgc = replayOf('vgc');
      vgc.log = vgc.log.replace('|switch|p2b: Ivysaur|Ivysaur, L50|100/100', () =>
        '|switch|p2b: Ivysaur|Ivysaur, L50|100/100\n|move|p1a: Raichu|Thunderbolt|p2a: Squirtle\n|-crit|p2a: Squirtle\n|-damage|p2a: Squirtle|20/100');
      const vgcSnapshots = parseReplayLog(vgc.log);
      const graph: AnalysisGraphData = {
        scores: vgcSnapshots.map(() => 0.1), results: vgcSnapshots.map(() => evalResult('doubles', { score: 0.1 })),
        played: vgcSnapshots.map(() => null), playedOutcome: vgcSnapshots.map(() => null),
        verified: vgcSnapshots.map(() => null), sensitivity: vgcSnapshots.map(() => null),
      };
      const context: TurnAnalysisContext = {
        snapshots: vgcSnapshots, turnEventsIndex: allTurnEvents(vgc.log), activesForTurn: () => null, playedHistory: { p1: [], p2: [] },
      };
      expect(analyzeTurnAt({ turn: 2, graph, context, includeSacks: true })?.rolledFor).toEqual({ p1: true, p2: false });
      const walk = computeGameReportData({ replayData: vgc, graph, context, winner: 'p1', tendencies: null });
      expect(walk?.analyses[1]?.rolledFor).toEqual({ p1: true, p2: false });
    });
  });
});

const walkOver = (kind: ReplayKind, scores: number[], decidedAt: Set<number>, forcedAt: Set<number> = new Set(), mass = 1) => {
  const { replayData, snapshots } = replayFixture(kind);
  const format = kind === 'singles' ? 'singles' : 'doubles';
  const results: EvalResult[] = scores.map((score, index) => evalResult(format, {
    score,
    unanswered: { p1: [], p2: [], ...(decidedAt.has(index + 1) ? { decided: { side: 'p1' as const, species: 'Calyrex-Ice' } } : {}) },
    ...(forcedAt.has(index + 1) ? { forcedWin: { side: 'p1' as const, turns: 1, mass, caveat: 'sampled-rolls' as const, engineScore: 1, states: 6 } } : {}),
  }));
  const graph: AnalysisGraphData = {
    scores, results,
    played: scores.map(() => null), playedOutcome: scores.map(() => null),
    verified: scores.map(() => null), sensitivity: scores.map(() => null),
  };
  const context: TurnAnalysisContext = {
    snapshots, turnEventsIndex: allTurnEvents(replayData.log), activesForTurn: () => null, playedHistory: { p1: [], p2: [] },
  };
  return computeGameReportData({ replayData, graph, context, winner: 'p1', tendencies: null })!.analyses;
};

describe('the walk speaks a side\'s decided sentence again after the board left the decided zone', () => {
  for (const kind of ['singles', 'vgc'] as const) {
    test(`${kind}: decided, the bar falls under 0.7, decided again: the second stage speaks`, () => {
      const walk = walkOver(kind, [0.8, 0.8, -0.2, 0.8, 0.8], new Set([1, 4]));
      expect(walk[0]?.p1.decided?.announce).toBe(true);
      expect(walk[3]?.p1.decided?.announce).toBe(true);
    });

    test(`${kind}: a bar that holds keeps the second stage quiet (2663093831 t12 and t13)`, () => {
      const walk = walkOver(kind, [0.8, 0.8, 0.75, 0.8, 0.8], new Set([1, 4]));
      expect(walk[0]?.p1.decided?.announce).toBe(true);
      expect(walk[3]?.p1.decided?.announce).toBe(false);
    });
  }

  test('doubles (2630685175 t7 to t11): a proof spoken before the fall no longer mutes the later decided stage, and a new proof speaks', () => {
    const walk = walkOver('vgc', [0.9, 1, -0.9, 0.85, 0.99, 1], new Set([1, 5]), new Set([2, 6]));
    expect(walk[1]?.p1.forcedWin?.announce).toBe(true);
    expect(walk[4]?.p1.decided?.announce).toBe(true);
    expect(walk[5]?.p1.forcedWin?.announce).toBe(true);
  });

  // A proof spoken under the line (mass 0.75, open branch at -0.4, bar 0.65 by applyForcedWin) left no decided zone behind; releasing it on the
  // next turn made it speak on every turn.
  for (const kind of ['singles', 'vgc'] as const) {
    test(`${kind}: a proof spoken while the bar sits under 0.7 speaks once, not on every turn`, () => {
      const walk = walkOver(kind, [0.65, 0.65, 0.65, 0.65], new Set(), new Set([1, 2, 3, 4]), 0.75);
      expect(walk.map(analysis => analysis?.p1.forcedWin?.announce)).toEqual([true, false, false, false]);
    });
  }
});

const GEN6_ACTIVES = (gen: number) => ({ p1: null, p2: null, gen });

function rolledFor(kind: 'singles' | 'doubles', actives: TurnAnalysisContext['activesForTurn']) {
  const { snapshots } = replayFixture(kind);
  const full = evalGraph(kind);
  const scores = full.scores.slice(0, snapshots.length);
  const graph: AnalysisGraphData = {
    scores, results: scores.map(score => evalResult(kind, { score })),
    played: scores.map(() => null), playedOutcome: scores.map(() => null),
    verified: scores.map(() => null), sensitivity: scores.map(() => null),
  };
  const turnEventsIndex: string[][] = snapshots.map(() => []);
  turnEventsIndex[1] = ['|move|p1a: Raichu|Thunder Wave|p2a: Bulbasaur', '|-status|p2a: Bulbasaur|par'];
  const context: TurnAnalysisContext = {
    snapshots: snapshots as TurnSnapshot[], turnEventsIndex, activesForTurn: actives, playedHistory: { p1: [], p2: [] },
  };
  return analyzeTurnAt({ turn: 1, graph, context, includeSacks: false })?.rolledFor;
}

describe.each(['singles', 'doubles'] as const)('the context hands the generation to the dice detection, %s', kind => {
  test('Gen 6: a sure Thunder Wave is no roll; Gen 9: its 90% is; no generation keeps the old reading', () => {
    expect(rolledFor(kind, () => GEN6_ACTIVES(6))).toEqual({ p1: false, p2: false });
    expect(rolledFor(kind, () => GEN6_ACTIVES(9))).toEqual({ p1: true, p2: false });
    expect(rolledFor(kind, () => null)).toEqual({ p1: true, p2: false });
  });
});

const FORCED: Record<ReplayKind, NonNullable<EvalResult['forcedWin']>> = {
  singles: { side: 'p1', turns: 2, mass: 1, caveat: 'sampled-rolls', delay: 'protect', delayName: 'Protect', engineScore: 0.4, states: 4 },
  doubles: {
    side: 'p1', turns: 2, mass: 1, caveat: 'sampled-rolls', delay: 'protect', delayName: 'Protect', engineScore: 0.4, states: 4,
    choice: 'move heatwave, move aquajet 1', choiceNames: { first: 'Aqua Jet', partner: 'Heat Wave' },
  },
  vgc: {
    side: 'p1', turns: 2, mass: 1, caveat: 'sampled-rolls', delay: 'detect', delayName: 'Detect', engineScore: 0.4, states: 4,
    choice: 'move heatwave, move aquajet 1', choiceNames: { first: 'Aqua Jet', partner: 'Heat Wave' },
  },
};

describe.each(['singles', 'doubles', 'vgc'] as const)('%s: the delay clause on the card and in the Game review', kind => {
  const { replayData, snapshots } = replayFixture(kind);
  const forcedWin = FORCED[kind];
  const game: 'singles' | 'doubles' = kind === 'singles' ? 'singles' : 'doubles';
  const graph: AnalysisGraphData = {
    scores: snapshots.map(() => 0.95),
    results: snapshots.map(() => evalResult(game, { score: 0.95, forcedWin })),
    played: snapshots.map(() => null), playedOutcome: snapshots.map(() => null),
    verified: snapshots.map(() => null), sensitivity: snapshots.map(() => null),
  };
  const context: TurnAnalysisContext = { snapshots, turnEventsIndex: allTurnEvents(replayData.log), activesForTurn: () => null, playedHistory: { p1: [], p2: [] } };
  const stall = forcedWin.delayName!;
  const count = (text: string, part: string): number => text.split(part).length - 1;

  test('the card says it once, with the stall the engine named', () => {
    const analysis = analyzeTurnAt({ turn: 1, graph, context, includeSacks: false });
    expect(analysis?.p1.forcedWin?.delayName).toBe(stall);
    const card = summarizeTurn(analysis!, [replayData.players[0], replayData.players[1]]);
    expect(count(card, `a repeated ${stall} only delays it`)).toBe(1);
    expect(card).toContain(`wins within 2 turns against every reply on the sampled rolls; a repeated ${stall} only delays it.`);
    expect(count(card, 'The winning line is Aqua Jet, which strikes first, with Heat Wave beside it.')).toBe(forcedWin.choiceNames ? 1 : 0);
  });

  // the doubles fixture is two turns long, under the three a report needs; the VGC fixture is the doubles case of the report
  test.skipIf(kind === 'doubles')('the Game review says it once, in the past tense', () => {
    const walk = computeGameReportData({ replayData, graph, context, winner: 'p1', tendencies: null });
    const summary = walk!.report.summary;
    expect(count(summary, `a repeated ${stall} only delayed it`)).toBe(1);
    expect(summary).toContain(`every reply lost within 2 turns on the sampled rolls; a repeated ${stall} only delayed it.`);
    expect(count(summary, 'The winning line was Aqua Jet, which struck first, with Heat Wave beside it.')).toBe(forcedWin.choiceNames ? 1 : 0);
  });
});
