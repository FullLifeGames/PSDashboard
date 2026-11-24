import type { Battle, Pokemon } from '@pkmn/sim';
import { movesFirst } from '../speed.ts';
import { livingMons, threatGetter, type MatchupCache } from './threat.ts';
import { raceClocks, raceSide } from './races.ts';
import { expectedRate, unansweredMons } from './unanswered.ts';

/** The race winner's value: base plus a step per turn of clock margin, capped; mutual walls keep the static. */
export const LAST_PAIR_BASE = 0.6;
export const LAST_PAIR_PER_TURN = 0.1;
export const LAST_PAIR_CAP = 0.9;
const MARGIN_CAP = 3;

let sweepVariant = false;
/** Variant B (default off): a lone sweeper the decided-sweep profile sees clearing the other side races the foe too. */
export function setLastPairSweep(on: boolean): void {
  sweepVariant = on;
}

export interface LastPairRace {
  /** 0 = p1's body wins the race, 1 = p2's. */
  winner: 0 | 1;
  /** Turns of clock margin, capped; the loser never landing counts as the full cap. */
  margin: number;
}

function pairRace(battle: Battle, a: Pokemon, b: Pokemon, cache?: MatchupCache): LastPairRace | null {
  const threat = threatGetter(battle, cache);
  const threatA = threat(a, b);
  const threatB = threat(b, a);
  const clocks = raceClocks(
    raceSide(a, a.hp / a.maxhp, expectedRate(threatA, a, b), battle),
    raceSide(b, b.hp / b.maxhp, expectedRate(threatB, b, a), battle),
  );
  if (clocks.turnsA === Infinity && clocks.turnsB === Infinity) return null;
  if (clocks.turnsA === clocks.turnsB) return { winner: movesFirst(a, b, threatA, threatB, battle) ? 0 : 1, margin: 0 };
  const aWins = clocks.turnsA < clocks.turnsB;
  const [winnerTurns, loserTurns] = aWins ? [clocks.turnsA, clocks.turnsB] : [clocks.turnsB, clocks.turnsA];
  const margin = loserTurns === Infinity ? MARGIN_CAP : Math.min(MARGIN_CAP, loserTurns - winnerTurns);
  return { winner: aWins ? 0 : 1, margin };
}

function sweepRace(battle: Battle, p1: Pokemon[], p2: Pokemon[], cache?: MatchupCache): LastPairRace | null {
  const decided = unansweredMons(battle, cache).decided;
  if (!decided) return null;
  const mine = decided.side === 'p1' ? p1 : p2;
  const theirs = decided.side === 'p1' ? p2 : p1;
  if (mine.length !== 1 || !mine[0].isActive) return null;
  const standing = theirs.find(mon => mon.isActive);
  if (!standing) return null;
  const race = decided.side === 'p1' ? pairRace(battle, mine[0], standing, cache) : pairRace(battle, standing, mine[0], cache);
  return race && race.winner === (decided.side === 'p1' ? 0 : 1) ? race : null;
}

/** The race of the last pair, or null when the rule does not apply (more bodies, benched body, mutual walls). */
export function lastPairRace(battle: Battle, cache?: MatchupCache): LastPairRace | null {
  const p1 = livingMons(battle, 0);
  const p2 = livingMons(battle, 1);
  if (p1.length === 1 && p2.length === 1) {
    if (!p1[0].isActive || !p2[0].isActive) return null;
    return pairRace(battle, p1[0], p2[0], cache);
  }
  return sweepVariant ? sweepRace(battle, p1, p2, cache) : null;
}

/** The leaf value the race dictates, in p1 perspective. */
export function lastPairValue(race: LastPairRace): number {
  const magnitude = Math.min(LAST_PAIR_CAP, LAST_PAIR_BASE + LAST_PAIR_PER_TURN * race.margin);
  return race.winner === 0 ? magnitude : -magnitude;
}
