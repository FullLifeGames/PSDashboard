import type { Battle, Pokemon } from '@pkmn/sim';
import { sideIndex } from '@fulllifegames/replay-core';
import { critRate, moveAccuracy, unpriceable } from '../ko-odds.ts';
import type { KoOddsInfo } from '../types.ts';
import { parsePairChoice, type PairAction } from './guards.ts';
import { killCount, killTable } from './kill-table.ts';
import { snapshotPair } from './snapshot.ts';

/**
 * Round 56: kill odds for doubles options, the narrative payload the singles
 * rows carry since round 6. Per option, every own slot's damaging move is
 * priced against the living foes it names on the root with the doubles
 * calc (partner abilities, ruin, the spread modifier by target count); the
 * option shows the slot event with the best kill chance among the uncertain
 * ones (0 < kill, hit × kill < 1), labeled with its move and target.
 */

type Odds = Required<KoOddsInfo> & { pKill: number };
type MoveAction = Extract<PairAction, { kind: 'move' }>;

const SPREAD = new Set(['allAdjacentFoes', 'allAdjacent']);
const SINGLE_FOE = new Set(['normal', 'any', 'adjacentFoe']);

/** The living foes a move action names on the root: every foe for a spread move, the named slot (its partner when it fell), the lone foe without a slot. */
function rootTargets(battle: Battle, own: 0 | 1, action: MoveAction): Pokemon[] {
  const foeSide = battle.sides[own === 0 ? 1 : 0];
  const foes = foeSide.active.filter((mon): mon is Pokemon => !!mon && !mon.fainted);
  const move = battle.dex.moves.get(action.moveId);
  if (SPREAD.has(move.target)) return foes;
  if (!SINGLE_FOE.has(move.target)) return [];
  if (action.loc !== null && action.loc > 0) {
    const named = foeSide.active[action.loc - 1];
    return named && !named.fainted ? [named] : foes.slice(0, 1);
  }
  return foes.length === 1 ? foes : [];
}

function slotOdds(battle: Battle, attacker: Pokemon, defender: Pokemon, moveId: string, spread: boolean): Odds | null {
  const move = battle.dex.moves.get(moveId);
  if (move.category === 'Status' || unpriceable(attacker, defender, move)) return null;
  const crit = critRate(battle.gen, move.critRatio ?? 1);
  const table = killTable(snapshotPair(battle, attacker, defender, moveId, spread));
  if (!table || crit === null) return null;
  const killFraction = (1 - crit) * killCount(table.normal, defender.hp) / 16 + crit * killCount(table.crit, defender.hp) / 16;
  const accuracy = moveAccuracy(battle, move, attacker, defender);
  return { accuracy, killFraction, pKill: accuracy * killFraction, label: `${move.name}→${defender.species.name}` };
}

/**
 * The option's headline: the uncertain kill with the best chance, or null. A
 * foe another slot of the option kills for sure is left out: odds on it say
 * nothing about whether it lives (Karate Chop kills Eevee, Tackle's crit
 * into the same Eevee is no headline).
 */
function optionOdds(battle: Battle, own: 0 | 1, choice: string): KoOddsInfo | null {
  const events: { defender: Pokemon; odds: Odds }[] = [];
  for (const action of parsePairChoice(battle, own, choice) ?? []) {
    if (action.kind !== 'move') continue;
    const attacker = battle.sides[own].active[action.slot];
    if (!attacker || attacker.fainted) continue;
    const targets = rootTargets(battle, own, action);
    for (const defender of targets) {
      const odds = slotOdds(battle, attacker, defender, action.moveId, targets.length > 1);
      if (odds) events.push({ defender, odds });
    }
  }
  const doomed = new Set(events.filter(event => event.odds.pKill >= 1).map(event => event.defender));
  let best: Odds | null = null;
  for (const { defender, odds } of events) {
    if (doomed.has(defender) || odds.killFraction <= 0 || odds.pKill >= 1) continue;
    if (!best || odds.pKill > best.pKill) best = odds;
  }
  return best ? { accuracy: best.accuracy, killFraction: best.killFraction, label: best.label } : null;
}

export function pairKoOdds(battle: Battle, side: 'p1' | 'p2', choices: string[]): (KoOddsInfo | null)[] {
  const own = sideIndex(side);
  return choices.map(choice => optionOdds(battle, own, choice));
}
