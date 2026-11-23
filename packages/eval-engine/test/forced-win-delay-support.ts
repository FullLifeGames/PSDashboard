import { State, type Battle } from '@pkmn/sim';
import { createRootPosition, type SimPosition } from '../src/forward-model';
import { proveForcedWin } from '../src/endgame/prover';
import type { ForcedWinProof } from '../src/types';
import { CHAMPIONS, mon, playClicks, type Mode, type Rules } from './dice-fixtures';
import { dexOfRules } from './dice-sweep-support';
import { battleOf } from './power-oracle';

/**
 * The boards of the delay specs. A pure delay board is one body against one body (in doubles the foe's partner has fallen and
 * the attacker's partner splashes): the foe stands at 1 HP behind a stalling move and a Splash, the attacker holds a
 * damaging move that cannot miss and knocks it out. Every kind of "stall that matters" changes that board by one fact the held turn
 * writes (a heal, a status, a weather timer, a contact shield's damage, an Endure that held a body up from full HP, the foe's partner
 * attacking), and the spec asks the prover for no delay there and for no mass above what the simulator plays out.
 */
export const rulesetOf = (rules: Rules): 'champions' | 'standard' => (rules === CHAMPIONS ? 'champions' : 'standard');

export interface Strike { id: string; /** the attacker's clicks for it */ click: string }

/** The attacker's click for its move number `slot` (an aim at the first foe when the move names a foe in doubles) and its partner's Splash. */
export const ownClick = (mode: Mode, aim: boolean, slot: number): string => (mode === 'singles' ? `move ${slot}` : `move ${slot}${aim ? ' 1' : ''}, move 1`);

/** The foe's click for its move number `slot`: one body stands on its side in both game types. */
export const foeClick = (slot: number): string => `move ${slot}`;

interface Options { moves?: string[]; stall: string; foeItem?: string; hp?: number }

function fall(battle: Battle, sideIndex: 0 | 1, index: number): void {
  const body = battle.sides[sideIndex].pokemon[index];
  body.hp = 0;
  body.fainted = true;
  body.faint();
  battle.sides[sideIndex].pokemonLeft--;
  battle.sides[sideIndex].faintedThisTurn = null;
}

/** The pure delay board in one rule set and game type: `strike` is the attacker's move, `stall` the foe's stalling move. */
export function delayBoard(rules: Rules, mode: Mode, strike: string, options: Options, seed = '1,2,3,4'): Battle {
  const attacker = { ...mon(rules, { species: 'Snorlax', moves: [strike, 'splash'], gender: 'M' }) };
  const foe = { ...mon(rules, { species: 'Vaporeon', moves: [options.stall, 'splash'] }), ...(options.foeItem ? { item: options.foeItem } : {}) };
  const one = [attacker];
  const two = [foe];
  if (mode === 'doubles') {
    one.push(mon(rules, { species: 'Blissey', moves: ['splash'] }));
    two.push(mon(rules, { species: 'Chansey', moves: ['splash'] }));
  }
  const battle = battleOf(mode === 'singles' ? rules.singles : rules.doubles!, one, two, seed);
  battle.sides[1].active[0]!.hp = options.hp ?? 1;
  if (mode === 'doubles') fall(battle, 1, 1);
  return battle;
}

export const positionOf = (battle: Battle, rules: Rules): SimPosition => createRootPosition(JSON.stringify(State.serializeBattle(battle)), rulesetOf(rules));

/** The side p1's proof from the root of a board, the way the app asks for it (no ranking, the odds order). */
export const proofOf = (battle: Battle, rules: Rules): ForcedWinProof => proveForcedWin(positionOf(battle, rules), { side: 'p1', rootOrder: [], tera: false });

type DexMove = ReturnType<ReturnType<typeof dexOfRules>['moves']['get']>;

/** Whether a Dex move is a plain damaging move of the kind a strike may be: no charge or recharge turn, no self effect, no recoil, one hit, no secondary. */
const plainDamage = (move: DexMove): boolean => move.basePower > 0 && move.priority === 0 && !move.flags['charge'] && !move.flags['recharge']
  && !move.selfdestruct && !move.multihit && !move.self && !move.secondaries && !move.recoil;

const playable = (dex: ReturnType<typeof dexOfRules>, move: DexMove): boolean => move.exists && !move.isZ && !move.isMax && move.gen <= dex.gen
  && (move.isNonstandard === null || move.isNonstandard === undefined || move.isNonstandard === 'Past');

/**
 * The first move of the rule set's Dex (in id order) that cannot miss, has no contact and no charge turn, and knocks a 1 HP Vaporeon out
 * on the board's own simulator: the strike of the pure delay board. Read from the Dex and tried on the simulator, never named.
 */
export function strikeOf(rules: Rules, mode: Mode, nonContact = true): Strike | null {
  const dex = dexOfRules(rules);
  const candidates = dex.moves.all()
    .filter(move => playable(dex, move) && move.accuracy === true && plainDamage(move) && ['normal', 'allAdjacentFoes'].includes(move.target) && (!nonContact || !move.flags['contact']))
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  for (const move of candidates.slice(0, 40)) {
    const battle = delayBoard(rules, mode, move.id, { stall: 'splash' });
    try {
      playClicks(battle, { p1: ownClick(mode, move.target === 'normal', 1), p2: foeClick(2) });
    } catch {
      continue;
    }
    if (battle.ended && battle.winner === battle.sides[0].name) return { id: move.id, click: ownClick(mode, move.target === 'normal', 1) };
  }
  return null;
}
