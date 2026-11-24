import type { PRNGSeed } from '@pkmn/sim';
import { toId } from '@fulllifegames/replay-core';

// Damage is not scored (snapshots correct HP at each boundary); type-only sim imports keep the sim out of main.

// Slot letters dropped, so a diverged doubles slot layout cannot fake a mismatch.
function normalizeIdent(raw: string): string {
  const match = raw.match(/^(p[12])[a-d]?:\s*(.*)$/);
  if (!match) return toId(raw);
  return `${match[1]}:${toId(match[2])}`;
}

export interface ProtocolEvents {
  faints: Set<string>;
  ended: boolean;
  winner: string | null;
  moveOrder: string[];
  /** |-miss| has no move id: it counts for the source's preceding |move|; `[miss]` sits on the |move| line itself. */
  misses: Map<string, number>;
  crits: Map<string, number>;
  /** No [from] filter: deterministic entries appear on both sides and cancel; RNG-driven ones (Scald burn) signal. */
  secondaries: Map<string, number>;
  hitCounts: Map<string, number>;
  cants: Map<string, number>;
  confusionSelfHits: Map<string, number>;
}

const bump = (map: Map<string, number>, key: string) =>
  map.set(key, (map.get(key) ?? 0) + 1);

const field = (parts: string[], index: number): string => parts[index] ?? '';

function recordHardEvent(events: ProtocolEvents, tag: string, parts: string[]): boolean {
  if (tag === 'faint') {
    events.faints.add(normalizeIdent(field(parts, 2)));
  } else if (tag === 'win') {
    events.ended = true;
    events.winner = parts[2] ?? null;
  } else if (tag === 'tie') {
    events.ended = true;
  } else {
    return false;
  }
  return true;
}

function recordMoveEvent(events: ProtocolEvents, lastMove: Map<string, string>, tag: string, parts: string[], line: string): boolean {
  if (tag === 'move') {
    const ident = normalizeIdent(field(parts, 2));
    const moveId = toId(field(parts, 3));
    events.moveOrder.push(`${ident}:${moveId}`);
    lastMove.set(ident, moveId);
    if (line.includes('[miss]')) bump(events.misses, `${ident}:${moveId}`);
  } else if (tag === '-miss') {
    const ident = normalizeIdent(field(parts, 2));
    bump(events.misses, `${ident}:${lastMove.get(ident) ?? ''}`);
  } else {
    return false;
  }
  return true;
}

function recordSecondaryEvent(events: ProtocolEvents, tag: string, parts: string[], line: string) {
  const ident = normalizeIdent(field(parts, 2));
  if (tag === '-crit') {
    bump(events.crits, ident);
  } else if (tag === '-status') {
    bump(events.secondaries, `${ident}:status:${field(parts, 3)}`);
  } else if (tag === '-boost' || tag === '-unboost') {
    bump(events.secondaries, `${ident}:${tag.slice(1)}:${field(parts, 3)}:${field(parts, 4)}`);
  } else if (tag === '-hitcount') {
    bump(events.hitCounts, `${ident}:${field(parts, 3)}`);
  } else if (tag === 'cant') {
    bump(events.cants, `${ident}:${toId(field(parts, 3))}`);
  } else if (tag === '-damage' && line.includes('[from] confusion')) {
    bump(events.confusionSelfHits, ident);
  }
}

export function extractProtocolEvents(lines: string[]): ProtocolEvents {
  const events: ProtocolEvents = {
    faints: new Set(), ended: false, winner: null, moveOrder: [],
    misses: new Map(), crits: new Map(), secondaries: new Map(),
    hitCounts: new Map(), cants: new Map(), confusionSelfHits: new Map(),
  };
  const lastMove = new Map<string, string>();
  // Sim logs interleave |split|SIDE + secret + public; the replay carries only the public line: skip marker and secret.
  let skipSecret = false;
  for (const line of lines) {
    const parts = line.split('|');
    const tag = parts[1] ?? '';
    if (tag === 'split') { skipSecret = true; continue; }
    if (skipSecret) { skipSecret = false; continue; }
    if (recordHardEvent(events, tag, parts)) continue;
    if (recordMoveEvent(events, lastMove, tag, parts, line)) continue;
    recordSecondaryEvent(events, tag, parts, line);
  }
  return events;
}

/** How far a trial's events are from the expected ones: the hard channels are compared first, then the soft sum. */
export interface AlignmentScore {
  endedMismatch: boolean;
  faintMismatches: number;
  softMismatches: number;
}

function mapMismatch(a: Map<string, number>, b: Map<string, number>): number {
  let total = 0;
  for (const key of new Set([...a.keys(), ...b.keys()])) {
    total += Math.abs((a.get(key) ?? 0) - (b.get(key) ?? 0));
  }
  return total;
}

function setMismatch(a: Set<string>, b: Set<string>): number {
  let total = 0;
  for (const key of a) if (!b.has(key)) total += 1;
  for (const key of b) if (!a.has(key)) total += 1;
  return total;
}

function moveCounts(order: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const entry of order) counts.set(entry, (counts.get(entry) ?? 0) + 1);
  return counts;
}

function orderMismatch(a: string[], b: string[]): number {
  const shared = new Set(a.filter(entry => b.includes(entry)));
  const filteredA = a.filter(entry => shared.has(entry));
  const filteredB = b.filter(entry => shared.has(entry));
  return filteredA.join('\n') === filteredB.join('\n') ? 0 : 1;
}

export function scoreAlignment(expected: ProtocolEvents, trial: ProtocolEvents): AlignmentScore {
  return {
    endedMismatch: expected.ended !== trial.ended,
    faintMismatches: setMismatch(expected.faints, trial.faints),
    softMismatches:
      mapMismatch(expected.misses, trial.misses) +
      mapMismatch(expected.crits, trial.crits) +
      mapMismatch(expected.secondaries, trial.secondaries) +
      mapMismatch(expected.hitCounts, trial.hitCounts) +
      mapMismatch(expected.cants, trial.cants) +
      mapMismatch(expected.confusionSelfHits, trial.confusionSelfHits) +
      mapMismatch(moveCounts(expected.moveOrder), moveCounts(trial.moveOrder)) +
      orderMismatch(expected.moveOrder, trial.moveOrder),
  };
}

/** Lexicographic: ended, then faints, then soft. Negative = a better. */
export function compareAlignment(a: AlignmentScore, b: AlignmentScore): number {
  if (a.endedMismatch !== b.endedMismatch) return a.endedMismatch ? 1 : -1;
  if (a.faintMismatches !== b.faintMismatches) return a.faintMismatches - b.faintMismatches;
  return a.softMismatches - b.softMismatches;
}

export function isPerfectAlignment(score: AlignmentScore): boolean {
  return !score.endedMismatch && score.faintMismatches === 0 && score.softMismatches === 0;
}

/** Pinned candidate seeds; index 0 must stay '1,2,3,4', the fixed reconstruction seed. */
// Frozen: changing any entry changes every reconstruction and is a cache version event (eval-cache-store.ts).
export const ALIGNMENT_SEEDS: readonly PRNGSeed[] = [
  '1,2,3,4', '5,9,13,17', '2,4,6,8', '11,7,5,3',
  '17,29,41,53', '8,16,32,64', '101,3,7,19', '23,42,17,88',
  '3,1,4,1', '59,26,53,58', '97,93,23,84', '62,64,33,83',
  '27,18,28,18', '31,41,59,26', '161,80,33,98', '14,142,13,56',
];

/** The chosen seed with the score of its best trial and the search's counts. */
export interface SeedChoice {
  seed: PRNGSeed;
  /** Best trial's score; null when every trial failed. */
  trialScore: AlignmentScore | null;
  trialPerfect: boolean;
  candidatesTried: number;
  trialsFailed: number;
}

/** Seed search: candidate 0 first, early exit on perfect, ties keep the earlier; all trials failed falls back to 0. */
export function chooseAlignedSeed(params: {
  expected: ProtocolEvents;
  trial: (seed: PRNGSeed) => { log: string[] } | null;
  shouldStop?: () => boolean;
}): SeedChoice {
  const { expected, trial, shouldStop } = params;
  let best: { seed: PRNGSeed; score: AlignmentScore } | null = null;
  let candidatesTried = 0;
  let trialsFailed = 0;
  for (const seed of ALIGNMENT_SEEDS) {
    if (candidatesTried > 0 && shouldStop?.()) break;
    candidatesTried += 1;
    const outcome = trial(seed);
    if (outcome === null) {
      trialsFailed += 1;
      continue;
    }
    const score = scoreAlignment(expected, extractProtocolEvents(outcome.log));
    if (!best || compareAlignment(score, best.score) < 0) best = { seed, score };
    if (isPerfectAlignment(score)) break;
  }
  if (!best) {
    return {
      seed: ALIGNMENT_SEEDS[0], trialScore: null, trialPerfect: false,
      candidatesTried, trialsFailed,
    };
  }
  return {
    seed: best.seed, trialScore: best.score,
    trialPerfect: isPerfectAlignment(best.score),
    candidatesTried, trialsFailed,
  };
}

/** The alignment of one turn: the seed chosen, the trial's outcome and the score of the truly emitted block. */
export interface TurnAlignmentRecord {
  turn: number;
  seed: PRNGSeed;
  trialPerfect: boolean;
  trialsFailed: number;
  candidatesTried: number;
  /**
   * `forced`: the log's dice forced on seed index 0 (no search, `candidatesTried` 0, `trialPerfect` false).
   * `fallback`: the forced turn could not play and the sixteen-seed search ran.
   */
  via?: 'forced' | 'fallback';
  /** Scored from the truly emitted block, not the trial: a gap between them is a fork-fidelity finding. */
  actual: AlignmentScore;
}

/** The totals of a game's per-turn alignment records. */
export interface AlignmentSummary {
  turns: number;
  perfectTurns: number;
  softResidual: number;
  faintResidualTurns: number;
  endedMismatches: number;
  /** Forced turns that play under a seed other than index 0; absent when none did. */
  seededTurns?: number;
  /** Turns that fell back to the seed search; absent when none did. */
  fallbackTurns?: number;
}

/** Totals a game's per-turn records. */
export function summarizeAlignment(records: TurnAlignmentRecord[]): AlignmentSummary {
  const summary: AlignmentSummary = {
    turns: records.length, perfectTurns: 0, softResidual: 0,
    faintResidualTurns: 0, endedMismatches: 0,
  };
  for (const record of records) {
    if (isPerfectAlignment(record.actual)) summary.perfectTurns += 1;
    summary.softResidual += record.actual.softMismatches;
    if (record.actual.faintMismatches > 0) summary.faintResidualTurns += 1;
    if (record.actual.endedMismatch) summary.endedMismatches += 1;
    if (record.via === 'fallback') summary.fallbackTurns = (summary.fallbackTurns ?? 0) + 1;
    else if (record.via === 'forced' && record.seed !== ALIGNMENT_SEEDS[0]) summary.seededTurns = (summary.seededTurns ?? 0) + 1;
  }
  return summary;
}
