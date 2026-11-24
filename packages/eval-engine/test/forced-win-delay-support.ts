import { State, type Battle } from '@pkmn/sim';
import { createRootPosition, type SimPosition } from '../src/forward-model';
import { proveForcedWin } from '../src/endgame/prover';
import type { ForcedWinProof } from '../src/types';
import { CHAMPIONS, mon, playClicks, type Mode, type Rules } from './dice-fixtures';
import { dexOfRules } from './dice-sweep-support';
import { battleOf } from './power-oracle';

export const rulesetOf = (rules: Rules): 'champions' | 'standard' => (rules === CHAMPIONS ? 'champions' : 'standard');

export interface Strike { id: string; /** the attacker's clicks for it */ click: string }

export const ownClick = (mode: Mode, aim: boolean, slot: number): string => (mode === 'singles' ? `move ${slot}` : `move ${slot}${aim ? ' 1' : ''}, move 1`);

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

export const proofOf = (battle: Battle, rules: Rules): ForcedWinProof => proveForcedWin(positionOf(battle, rules), { side: 'p1', rootOrder: [], tera: false });

type DexMove = ReturnType<ReturnType<typeof dexOfRules>['moves']['get']>;

const plainDamage = (move: DexMove): boolean => move.basePower > 0 && move.priority === 0 && !move.flags['charge'] && !move.flags['recharge']
  && !move.selfdestruct && !move.multihit && !move.self && !move.secondaries && !move.recoil;

const playable = (dex: ReturnType<typeof dexOfRules>, move: DexMove): boolean => move.exists && !move.isZ && !move.isMax && move.gen <= dex.gen
  && (move.isNonstandard === null || move.isNonstandard === undefined || move.isNonstandard === 'Past');

// Read from the Dex and tried on the simulator, never named.
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
