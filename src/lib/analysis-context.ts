import { toID } from '@pkmn/dex';
import type { ReplayData, TurnSnapshot } from '@fulllifegames/replay-core';
import {
  analyzeTurn, decidedSeenKey, diceEventTurns, forcedWinSeenKey, forcedWinSpeaks, PAYOFF_WINDOW, unansweredSeenKey, type TurnAnalysis, detectSacks,
  type PlayedTurn, type StreakHistoryEntry, buildGameReport, type GameReport, computeRead, type EvalResult, releaseBrokenClaims,
} from '@fulllifegames/eval-engine';

/** The graph slices the analyses read — matches useEvaluation's graph. */
export interface AnalysisGraphData {
  results: (EvalResult | null)[];
  scores: (number | null)[];
  played: (PlayedTurn | null)[];
  playedOutcome: (number | null)[];
  verified: Parameters<typeof analyzeTurn>[0]['verified'][];
  sensitivity: Parameters<typeof analyzeTurn>[0]['sensitivity'][];
  /** The auto mode's per-turn phase (null where the sweep never resolved one). */
  faintedFractions?: (number | null)[];
}

/**
 * Round 64 (T123): how many bodies each side brought, as the protocol's
 * `|teamsize|` line before turn 1 states it (VGC: 4 of the 6 team preview
 * lists); null for a side the log does not size.
 */
function broughtCounts(snapshots: TurnSnapshot[]): { p1: number | null; p2: number | null } {
  const counts: { p1: number | null; p2: number | null } = { p1: null, p2: null };
  for (const line of snapshots[0]?.log ?? []) {
    const match = line.match(/^\|teamsize\|(p[12])\|(\d+)/);
    if (match) counts[match[1] as 'p1' | 'p2'] = Number(match[2]);
  }
  return counts;
}

/**
 * Round 63 (T18): the turn's phase for the near sentence — the sweep's own
 * measure first (it counts the bodies a VGC side brought), else the fallen
 * share of the pre-turn snapshot (manual modes record no phase); null
 * without either. Round 64 (T123): the snapshot share counts the bodies a
 * side brought, not the six its team preview lists.
 */
export function turnFaintedFraction(graph: AnalysisGraphData, snapshots: TurnSnapshot[], turn: number): number | null {
  const recorded = graph.faintedFractions?.[turn - 1];
  if (recorded !== undefined && recorded !== null) return recorded;
  const snapshot = snapshots[turn - 1];
  if (!snapshot) return null;
  const brought = broughtCounts(snapshots);
  const total = (brought.p1 ?? snapshot.p1.pokemon.length) + (brought.p2 ?? snapshot.p2.pokemon.length);
  const fallen = [...snapshot.p1.pokemon, ...snapshot.p2.pokemon].filter(pokemon => pokemon.fainted).length;
  return total > 0 ? fallen / total : null;
}

export interface TurnAnalysisContext {
  snapshots: TurnSnapshot[];
  turnEventsIndex: string[][];
  activesForTurn: (turn: number) => Parameters<typeof analyzeTurn>[0]['actives'];
  playedHistory: { p1: (StreakHistoryEntry | null)[]; p2: (StreakHistoryEntry | null)[] };
}

type TurnReads = NonNullable<Parameters<typeof analyzeTurn>[0]['reads']>;
/** Each player's own tendencies from the replay log (parseTendencies). */
export type ReplayTendencies = NonNullable<Parameters<typeof analyzeTurn>[0]['tendencies']>;

/** One argument assembly for analyzeTurn — the per-turn view and the report
 *  walk used to paste the same block at two sites. */
export function analyzeTurnAt(args: {
  turn: number;
  graph: AnalysisGraphData;
  context: TurnAnalysisContext;
  includeSacks: boolean;
  reads?: TurnReads | null;
  tendencies?: ReplayTendencies | null;
  unansweredSeen?: Set<string>;
  decidedSeen?: Set<string>;
}): TurnAnalysis | null {
  const { turn, graph, context } = args;
  const result = graph.results[turn - 1];
  const scoreBefore = graph.scores[turn - 1];
  if (!result || scoreBefore === null) return null;
  return analyzeTurn({
    turn,
    result,
    played: graph.played[turn - 1] ?? null,
    playedOutcome: graph.playedOutcome[turn - 1] ?? null,
    futureOutcomes: graph.playedOutcome
      .slice(turn, turn + PAYOFF_WINDOW)
      .map(value => value ?? null),
    verified: graph.verified[turn - 1] ?? null,
    sensitivity: graph.sensitivity[turn - 1] ?? null,
    scoreBefore,
    scoreAfter: graph.scores[turn] ?? null,
    playedTracking: true,
    ...(args.includeSacks
      ? { sacks: detectSacks(context.turnEventsIndex[turn] ?? [], context.snapshots[turn - 1] ?? null) }
      : {}),
    ...(args.reads ? { reads: args.reads } : {}),
    ...(args.tendencies ? { tendencies: args.tendencies } : {}),
    actives: context.activesForTurn(turn),
    playedHistory: context.playedHistory,
    faintedFraction: turnFaintedFraction(graph, context.snapshots, turn),
    ...(args.unansweredSeen ? { unansweredSeen: args.unansweredSeen } : {}),
    ...(args.decidedSeen ? { decidedSeen: args.decidedSeen } : {}),
  });
}

/** Streak-detector history (narrative channel): per side per turn, who
 *  attacked whom with what — read from the replay's own snapshots and
 *  protocol lines, render-time only. Gaps push null (breaks streaks; the
 *  detector fails closed). */
function historyEntryFor(
  side: 'p1' | 'p2',
  playedTurn: PlayedTurn | null,
  snapshot: TurnSnapshot | null,
  firstMover: string | null,
): StreakHistoryEntry | null {
  const action = playedTurn?.[side] ?? null;
  const own = snapshot?.[side].pokemon.find(pokemon => pokemon.isActive && !pokemon.fainted) ?? null;
  const opp = snapshot?.[side === 'p1' ? 'p2' : 'p1'].pokemon.find(pokemon => pokemon.isActive && !pokemon.fainted) ?? null;
  if (!action || action.kind !== 'move' || !own || !opp) return null;
  return {
    attacker: own.speciesForme,
    moveId: toID(action.name) || null,
    defender: opp.speciesForme,
    movedFirst: firstMover === side,
    attackerAbility: toID(own.ability),
    defenderAbility: toID(opp.ability),
    defenderItem: toID(opp.item),
    defenderBoosts: { def: opp.boosts['def'] ?? 0, spd: opp.boosts['spd'] ?? 0 },
  };
}

export function buildPlayedHistory(
  played: (PlayedTurn | null)[],
  snapshots: TurnSnapshot[],
  turnEventsIndex: string[][],
): { p1: (StreakHistoryEntry | null)[]; p2: (StreakHistoryEntry | null)[] } {
  const sides = { p1: [] as (StreakHistoryEntry | null)[], p2: [] as (StreakHistoryEntry | null)[] };
  const turns = played.length;
  for (let t = 1; t <= turns; t++) {
    const playedTurn = played[t - 1];
    const snapshot = snapshots[t - 1] ?? null;
    const events = turnEventsIndex[t] ?? [];
    const firstMover = events.find(line => line.startsWith('|move|'))?.split('|')[2]?.slice(0, 2) ?? null;
    for (const side of ['p1', 'p2'] as const) {
      sides[side].push(historyEntryFor(side, playedTurn, snapshot, firstMover));
    }
  }
  return sides;
}

/** Exploitative Read lens: best response to the opponent model over the
 *  already-solved matrix — advisory only, verdicts stay equilibrium-graded. */
export function computeTurnReads(
  turn: number,
  graph: AnalysisGraphData,
  tendencies: ReplayTendencies | null,
): { p1: ReturnType<typeof computeRead>; p2: ReturnType<typeof computeRead> } | null {
  if (turn < 1 || !tendencies) return null;
  const result = graph.results[turn - 1];
  if (!result?.matrix) return null;
  return {
    p1: computeRead(result.matrix, 'p1', tendencies.p2),
    p2: computeRead(result.matrix, 'p2', tendencies.p1),
  };
}

/** The report walk: analyze every swept turn once, with the entry/decided
 *  announcement bookkeeping, then build the game report (three analyzed
 *  turns minimum). */
export function computeGameReportData(args: {
  replayData: ReplayData;
  graph: AnalysisGraphData;
  context: TurnAnalysisContext;
  winner: 'p1' | 'p2' | null;
  /** Round 47: the walk reads the opponent model like the turn card, so the dump and the pins see the card's text. */
  tendencies: ReplayTendencies | null;
}): { report: GameReport; analyses: (TurnAnalysis | null)[] } | null {
  // The report walk speaks each entry sentence once: keys of already-spoken
  // unanswered stages accumulate turn by turn, so a mon's tenth entry stays
  // quiet here while the per-turn card (no set passed) keeps its sentence.
  const unansweredSeen = new Set<string>();
  // The decided/near announcements share the walk regime — the state stays
  // on every decided turn, the sentence speaks once.
  const decidedSeen = new Set<string>();
  const analyses = args.graph.results.map((_, index) => {
    // Round 64 (T123): a bar that left the decided zone frees the side's decided and forced sentences again.
    const bar = args.graph.scores[index];
    if (bar !== null && bar !== undefined) releaseBrokenClaims(decidedSeen, bar);
    const analysis = analyzeTurnAt({
      turn: index + 1, graph: args.graph, context: args.context,
      includeSacks: true, unansweredSeen, decidedSeen,
      reads: computeTurnReads(index + 1, args.graph, args.tendencies), tendencies: args.tendencies,
    });
    if (!analysis) return null;
    for (const key of ['p1', 'p2'] as const) {
      const signal = analysis[key].unanswered;
      if (signal) unansweredSeen.add(unansweredSeenKey(key, signal));
      const decided = analysis[key].decided;
      if (decided?.announce) decidedSeen.add(decidedSeenKey(key, { species: decided.species }));
      const near = analysis[key].nearDecided;
      if (near?.announce) {
        decidedSeen.add(decidedSeenKey(key, { species: near.species, removes: near.removes }));
      }
      const forced = analysis[key].forcedWin;
      // Round 63: whenever the sentence speaks, the 0.9 proof and the open event under it (T19) alike.
      if (forcedWinSpeaks(forced, key === 'p1' ? analysis.scoreBefore : -analysis.scoreBefore)) decidedSeen.add(forcedWinSeenKey(key));
    }
    return analysis;
  });
  if (analyses.filter(Boolean).length < 3) return null;
  const report = buildGameReport(
    analyses, [args.replayData.players[0], args.replayData.players[1]], args.winner, true,
    // Protocol dice anchor for the luck claims (crits, misses, rolled statuses).
    diceEventTurns(args.context.turnEventsIndex),
  );
  return { report, analyses };
}
