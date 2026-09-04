import type { Battle, Pokemon } from '@pkmn/sim';
import { movesFirst } from '../speed.ts';
import { livingMons, threatGetter, type MatchupCache } from './threat.ts';
import { raceClocks, raceSide } from './races.ts';
import { expectedRate, unansweredMons } from './unanswered.ts';

/**
 * The last pair (round 33): once each side is down to one living body the
 * material static is the wrong instrument (573756 t135–t137: an 89 % HP
 * burned Toxapex with no damaging move read 53 % against a 19 % Choice
 * Band Zapdos-Galar; the trees read 3 %). The race clocks already price
 * the pair — heal PP, residuals, PP budgets — so the leaf takes the race
 * winner's side at a base of LAST_PAIR_BASE plus LAST_PAIR_PER_TURN per
 * turn of clock margin, capped at LAST_PAIR_CAP, in win-prob units. Mutual
 * walls (both clocks infinite) keep the static. Variant B (flag, measured
 * in the round-33 bench, adopted nowhere yet) extends the rule to a lone
 * sweeper the decided-sweep profile sees clearing the whole other side;
 * the race against the standing enemy sets its margin.
 */
export const LAST_PAIR_BASE = 0.6;
export const LAST_PAIR_PER_TURN = 0.1;
export const LAST_PAIR_CAP = 0.9;
const MARGIN_CAP = 3;

let sweepVariant = false;
/** Variant B switch (default off): a lone decided sweeper races the standing enemy too. */
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

/** Variant B: a lone sweeper the decided profile sees clearing the rest races the standing enemy. */
function sweepRace(battle: Battle, p1: Pokemon[], p2: Pokemon[], cache?: MatchupCache): LastPairRace | null {
  const decided = unansweredMons(battle, cache).decided;
  if (!decided) return null;
  const mine = decided.side === 'p1' ? p1 : p2;
  const theirs = decided.side === 'p1' ? p2 : p1;
  if (mine.length !== 1 || !mine[0].isActive) return null;
  const standing = theirs.find(mon => mon.isActive);
  if (!standing) return null;
  const race = decided.side === 'p1' ? pairRace(battle, mine[0], standing, cache) : pairRace(battle, standing, mine[0], cache);
  // The race against the standing enemy sets the margin; the sweep profile vouches for the rest.
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

/** The leaf value the race dictates, p1 perspective in win-prob units. */
export function lastPairValue(race: LastPairRace): number {
  const magnitude = Math.min(LAST_PAIR_CAP, LAST_PAIR_BASE + LAST_PAIR_PER_TURN * race.margin);
  return race.winner === 0 ? magnitude : -magnitude;
}
