import { State, type Battle } from '@pkmn/sim';
import { recordTurn, type FlipTurn } from '../src/dice/flip';
import { createRootPosition, legalChoices, type SimPosition } from '../src/forward-model';
import { forkBattle } from '../src/forward/position';
import { applyChoice, resolveForcedSwitches } from '../src/forward/switches';
import { cellSeeds } from '../src/search/root-quantile';
import { proveForcedWin } from '../src/endgame/prover';
import type { ForcedWinProof } from '../src/types';
import { CHAMPIONS, mon, playClicks, seedOf, type Mode, type Rules } from './dice-fixtures';
import { dexOfRules } from './dice-sweep-support';
import { battleOf } from './power-oracle';

export const rulesetOf = (rules: Rules): 'champions' | 'standard' => (rules === CHAMPIONS ? 'champions' : 'standard');

export const WELL_UNDER_100 = 91;

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

function strikeBy(rules: Rules, mode: Mode, nonContact: boolean, accuracy: (move: DexMove) => boolean, tries: number): Strike | null {
  const dex = dexOfRules(rules);
  const candidates = dex.moves.all()
    .filter(move => playable(dex, move) && accuracy(move) && plainDamage(move) && ['normal', 'allAdjacentFoes'].includes(move.target) && (!nonContact || !move.flags['contact']))
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  for (const move of candidates.slice(0, 40)) {
    for (let index = 0; index < tries; index++) {
      const battle = delayBoard(rules, mode, move.id, { stall: 'splash' }, index === 0 ? '1,2,3,4' : seedOf(index));
      try {
        playClicks(battle, { p1: ownClick(mode, move.target === 'normal', 1), p2: foeClick(2) });
      } catch {
        break;
      }
      if (battle.ended && battle.winner === battle.sides[0].name) return { id: move.id, click: ownClick(mode, move.target === 'normal', 1) };
    }
  }
  return null;
}

// Read from the Dex and tried on the simulator, never named.
export const strikeOf = (rules: Rules, mode: Mode, nonContact = true): Strike | null => strikeBy(rules, mode, nonContact, move => move.accuracy === true, 1);

export const missOf = (rules: Rules, mode: Mode, ceiling: number): Strike | null =>
  strikeBy(rules, mode, true, move => typeof move.accuracy === 'number' && move.accuracy < ceiling, 8);

export const PP_LISTS = Array.from({ length: 56 }, (_, index) => ({ own: 9 + (index % 8), foe: 2 + Math.floor(index / 8) }));

export interface StalledCell { root: SimPosition; own: string; foe: string; splash: string }

export function stalledCell(rules: Rules, mode: Mode, strike: Strike, stall: string, pp: { own: number; foe: number }): StalledCell {
  const battle = delayBoard(rules, mode, strike.id, { stall });
  battle.sides[0].active[0]!.moveSlots[0].pp = pp.own;
  battle.sides[1].active[0]!.moveSlots[0].pp = pp.foe;
  playClicks(battle, { p1: strike.click, p2: foeClick(1) });
  const root = positionOf(battle, rules);
  const clicks = (side: 'p1' | 'p2'): string[] => legalChoices(root, side, { tera: false }).map(option => option.choice);
  const own = clicks('p1').find(choice => choice.startsWith(`move ${strike.id}`) && (mode === 'singles' || choice.endsWith('move splash')));
  const foe = clicks('p2').find(choice => choice === `move ${stall}`);
  const splash = clicks('p2').find(choice => choice === 'move splash');
  if (!own || !foe || !splash) throw new Error(`no listed choice for ${strike.id} against ${stall}`);
  return { root, own, foe, splash };
}

export function turnOf(root: SimPosition, p1Choice: string, p2Choice: string, seedIndex = 0): FlipTurn {
  const seed = cellSeeds(root, p1Choice, p2Choice)[seedIndex];
  return {
    fork: () => forkBattle(root, seed),
    play: battle => {
      applyChoice(battle, 'p1', p1Choice);
      applyChoice(battle, 'p2', p2Choice);
      resolveForcedSwitches(battle, seed, { p1: undefined, p2: undefined });
    },
  };
}

export function chancesOf(cell: StalledCell): { hold: number; hit: number } {
  const stall = recordTurn(turnOf(cell.root, cell.own, cell.foe)).dice.find(die => die.name.kind === 'stalling');
  const hit = recordTurn(turnOf(cell.root, cell.own, cell.splash)).dice.find(die => die.name.kind === 'accuracy');
  if (!stall || !hit) throw new Error('the cell records no stall die or no accuracy die');
  return { hold: stall.chance, hit: hit.chance };
}
