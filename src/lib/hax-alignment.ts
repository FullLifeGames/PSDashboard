import type { PRNGSeed } from '@pkmn/sim';
import { toId } from './ids';

/**
 * Hax alignment: the replay reconstruction replays the real game's choices,
 * but the sim rolls its own crits/misses/secondaries. This module extracts
 * the protocol's discrete RNG witnesses from a turn block and scores how
 * well a trial advance reproduces them, so the reconstruction can pick the
 * candidate seed whose rolls match reality (spec: docs/superpowers/specs/
 * 2026-08-15-hax-alignment-design.md). Damage magnitude is deliberately
 * not scored — snapshots correct HP at every boundary, and matching rolls
 * would reward wrongly guessed spreads.
 *
 * PURE module: type-only sim imports. App.tsx imports it statically; a
 * runtime @pkmn/sim import here would drag the sim into the main chunk.
 */

/** `${side}:${nameId}` — slot letters dropped so a diverged doubles slot
 *  layout cannot fake a mismatch. */
function normalizeIdent(raw: string): string {
  const match = raw.match(/^(p[12])[a-d]?:\s*(.*)$/);
  if (!match) return toId(raw);
  return `${match[1]}:${toId(match[2])}`;
}

export interface ProtocolEvents {
  /** |faint| idents (hard criterion). */
  faints: Set<string>;
  /** Block contains |win| or |tie| (hard criterion). */
  ended: boolean;
  winner: string | null;
  /** `${ident}:${moveId}` sequence of |move| lines (speed-tie signal). */
  moveOrder: string[];
  /** `${ident}:${moveId}` -> count. |-miss| carries no move id: attributed
   *  to the source's immediately preceding |move|; `[miss]` sits on the
   *  |move| line itself. */
  misses: Map<string, number>;
  /** Target ident -> count. */
  crits: Map<string, number>;
  /** `${targetIdent}:status:${st}` / `${targetIdent}:boost:${stat}:${n}` /
   *  `${targetIdent}:unboost:${stat}:${n}` -> count over ALL such lines,
   *  no [from] filtering: deterministic entries appear identically on both
   *  sides and cancel; RNG-driven ones (Scald burn, Ancient Power) signal. */
  secondaries: Map<string, number>;
  /** `${targetIdent}:${n}` -> count (|-hitcount|). */
  hitCounts: Map<string, number>;
  /** `${ident}:${reasonId}` -> count (|cant| — full para, flinch, slp). */
  cants: Map<string, number>;
  /** Target ident -> count (|-damage| … [from] confusion). */
  confusionSelfHits: Map<string, number>;
}

const bump = (map: Map<string, number>, key: string) =>
  map.set(key, (map.get(key) ?? 0) + 1);

/** A protocol field, empty when the line is short. */
const field = (parts: string[], index: number): string => parts[index] ?? '';

/** Faints and game end — the hard channels. True when the tag was one of them. */
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

/** Move order and misses. True when the tag was one of them. */
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

/** Crits, secondaries, hit counts, cants, confusion self-hits — the soft channels. */
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
  // Sim battle logs interleave |split|SIDE + secret line + public line;
  // replay protocol carries only the public form. Skip marker + secret so
  // both sources extract identically.
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

export interface AlignmentScore {
  /** Hard, compared first: one side's game ended where the other's continued. */
  endedMismatch: boolean;
  /** Hard: symmetric difference of the faint sets. */
  faintMismatches: number;
  /** Soft: sum over all channels, both directions. */
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

/** `${ident}:${moveId}` -> count, derived from the move sequence so a mover
 *  present in one block but not the other (died first, sim-only flinch
 *  without |cant|) registers as a soft mismatch. */
function moveCounts(order: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const entry of order) counts.set(entry, (counts.get(entry) ?? 0) + 1);
  return counts;
}

/** 0/1 order-only signal over the entries both sequences contain — presence
 *  differences are counted by the moveCounts channel. */
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

/**
 * Pinned candidate seeds. Index 0 MUST stay '1,2,3,4' (the legacy fixed
 * reconstruction seed — candidate-0-perfect turns behave exactly as before
 * this feature, modulo the per-turn reseed). Values are arbitrary but
 * FROZEN: changing any entry changes every reconstruction and is a cache
 * version event (eval-cache-store.ts).
 */
export const ALIGNMENT_SEEDS: readonly PRNGSeed[] = [
  '1,2,3,4', '5,9,13,17', '2,4,6,8', '11,7,5,3',
  '17,29,41,53', '8,16,32,64', '101,3,7,19', '23,42,17,88',
  '3,1,4,1', '59,26,53,58', '97,93,23,84', '62,64,33,83',
  '27,18,28,18', '31,41,59,26', '161,80,33,98', '14,142,13,56',
];

export interface SeedChoice {
  seed: PRNGSeed;
  /** Best trial's score; null when every trial failed. */
  trialScore: AlignmentScore | null;
  trialPerfect: boolean;
  candidatesTried: number;
  trialsFailed: number;
}

/**
 * Deterministic best-of-K seed search: candidate 0 first (perfect → done,
 * so an RNG-quiet turn costs one trial), then the rest in order with
 * early-exit on perfect and strict-improvement argmin (ties keep the
 * earlier candidate). The trial runner is injected — the reconstruction
 * supplies a forkBattle-based runner; tests supply canned logs. A runner
 * returning null marks a failed trial; all-failed falls back to candidate 0
 * so the block runs exactly as before this feature. shouldStop (abort /
 * reconstruction deadline) halts between candidates, keeping the best so far.
 */
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

export interface TurnAlignmentRecord {
  turn: number;
  seed: PRNGSeed;
  trialPerfect: boolean;
  trialsFailed: number;
  candidatesTried: number;
  /** Scored from the TRULY emitted block, not the trial — instrumentation
   *  cannot flatter itself; a trial-vs-actual gap is a fork-fidelity finding. */
  actual: AlignmentScore;
}

export interface AlignmentSummary {
  turns: number;
  perfectTurns: number;
  softResidual: number;
  faintResidualTurns: number;
  endedMismatches: number;
}

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
  }
  return summary;
}
