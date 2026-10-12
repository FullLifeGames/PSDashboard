import type { Battle, Pokemon } from '@pkmn/sim';
import { sideIndex } from '@fulllifegames/replay-core';
import { strengthMix } from '../calc/fickle.ts';
import { bodyAsClicked } from '../calc/tera-click.ts';
import { critRate, moveAccuracy, unpriceable } from '../ko-odds.ts';
import type { KoOddsInfo } from '../types.ts';
import { parsePairChoice, type PairAction } from './guards.ts';
import { mixedKillShare } from './kill-table.ts';
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

type ModifyMoveHandler = (this: unknown, move: unknown, user: unknown, target: unknown) => void;

/**
 * The move's target as the simulator's ModifyMove leaves it for this user (round 69, T152): the move's own handler from the
 * Dex runs on a stand-in for the attacker (the species its Tera click makes, the body otherwise) and for the battle (its
 * field, cleared when the click clears it), so Tera Starstorm of Terapagos-Stellar and Expanding Force of a grounded user
 * on Psychic Terrain read allAdjacentFoes. A handler that needs more than that leaves the Dex target.
 */
function targetAtUse(battle: Battle, attacker: Pokemon, action: MoveAction): string {
  const dexMove = battle.dex.moves.get(action.moveId);
  const handler = (dexMove as { onModifyMove?: unknown }).onModifyMove;
  if (typeof handler !== 'function') return dexMove.target;
  const body = bodyAsClicked(battle, attacker, action.tera === true);
  const user = Object.create(attacker, { species: { value: battle.dex.species.get(body.species) } });
  const field = body.abilityOn ? Object.create(battle.field, { weather: { value: '' }, terrain: { value: '' } }) : battle.field;
  const move = battle.dex.getActiveMove(action.moveId);
  try {
    (handler as ModifyMoveHandler).call({ field, debug: () => undefined }, move, user, null);
  } catch {
    return dexMove.target;
  }
  return move.target;
}

/** The living foes a move action names on the root: every foe for a spread move, the named slot (its partner when it fell), the lone foe without a slot. */
function rootTargets(battle: Battle, own: 0 | 1, action: MoveAction, target: string): Pokemon[] {
  const foeSide = battle.sides[own === 0 ? 1 : 0];
  const foes = foeSide.active.filter((mon): mon is Pokemon => !!mon && !mon.fainted);
  if (SPREAD.has(target)) return foes;
  if (!SINGLE_FOE.has(target)) return [];
  if (action.loc !== null && action.loc > 0) {
    const named = foeSide.active[action.loc - 1];
    return named && !named.fainted ? [named] : foes.slice(0, 1);
  }
  return foes.length === 1 ? foes : [];
}

/** The sim's spread flag at the start of the move: two or more targets, the living ally among them for an allAdjacent move. */
function spreadAtStart(battle: Battle, own: 0 | 1, action: MoveAction, targets: readonly Pokemon[], target: string): boolean {
  if (target !== 'allAdjacent') return targets.length > 1;
  const allies = battle.sides[own].active.filter(mon => mon && !mon.fainted && mon.position !== action.slot).length;
  return targets.length + allies > 1;
}

/**
 * One slot's event; a slot that clicks Tera is priced on the body the click makes (round 67, T84). `cleared`: a click of
 * the option clears the weather and the terrain (Teraform Zero, T152) before any of its slots moves, so every slot meets
 * the cleared field, the clicking one and its partner alike.
 */
function slotOdds(battle: Battle, attacker: Pokemon, defender: Pokemon, action: MoveAction, spread: boolean, cleared: boolean): Odds | null {
  const move = battle.dex.moves.get(action.moveId);
  if (move.category === 'Status' || unpriceable(attacker, defender, move)) return null;
  const crit = critRate(battle.gen, move.critRatio ?? 1);
  const snapshot = snapshotPair(battle, attacker, defender, action.moveId, spread, action.tera === true);
  if (crit === null) return null;
  const killFraction = mixedKillShare(cleared ? { ...snapshot, weather: '', terrain: '' } : snapshot, defender.hp, crit, strengthMix(battle.dex, move.name));
  if (killFraction === null) return null;
  const accuracy = moveAccuracy(battle, move, attacker, defender, cleared ? '' : undefined);
  return {
    accuracy, killFraction, pKill: accuracy * killFraction, label: `${move.name}→${defender.species.name}`,
    attacker: { slot: action.slot, species: attacker.species.name },
  };
}

/** Does a slot of the option click a Tera that clears the field (the body the click makes carries abilityOn)? */
function clearsField(battle: Battle, own: 0 | 1, actions: readonly PairAction[]): boolean {
  return actions.some(action => {
    const mon = action.kind === 'move' && action.tera ? battle.sides[own].active[action.slot] : null;
    return !!mon && !mon.fainted && !!bodyAsClicked(battle, mon, true).abilityOn;
  });
}

/**
 * The option's headline: the uncertain kill with the best chance, or null. A
 * foe another slot of the option kills for sure is left out: odds on it say
 * nothing about whether it lives (Karate Chop kills Eevee, Tackle's crit
 * into the same Eevee is no headline).
 */
function optionOdds(battle: Battle, own: 0 | 1, choice: string): KoOddsInfo | null {
  const events: { defender: Pokemon; odds: Odds }[] = [];
  const actions = parsePairChoice(battle, own, choice) ?? [];
  const cleared = clearsField(battle, own, actions);
  for (const action of actions) {
    if (action.kind !== 'move') continue;
    const attacker = battle.sides[own].active[action.slot];
    if (!attacker || attacker.fainted) continue;
    const target = targetAtUse(battle, attacker, action);
    const targets = rootTargets(battle, own, action, target);
    for (const defender of targets) {
      const odds = slotOdds(battle, attacker, defender, action, spreadAtStart(battle, own, action, targets, target), cleared);
      if (odds) events.push({ defender, odds });
    }
  }
  const doomed = new Set(events.filter(event => event.odds.pKill >= 1).map(event => event.defender));
  let best: Odds | null = null;
  for (const { defender, odds } of events) {
    if (doomed.has(defender) || odds.killFraction <= 0 || odds.pKill >= 1) continue;
    if (!best || odds.pKill > best.pKill) best = odds;
  }
  return best ? { accuracy: best.accuracy, killFraction: best.killFraction, label: best.label, attacker: best.attacker } : null;
}

export function pairKoOdds(battle: Battle, side: 'p1' | 'p2', choices: string[]): (KoOddsInfo | null)[] {
  const own = sideIndex(side);
  return choices.map(choice => optionOdds(battle, own, choice));
}
