import type { Battle, Pokemon, PokemonSet } from '@pkmn/sim';
import { deserializeBattleExact, serializeBattleStable } from '../src/forward/serialize';
import { FixedDice } from '../src/sim-ask';
import { set } from './move-oracle';
import { battleOf } from './power-oracle';

/**
 * Round 72 (T196a): the two oracles the speed-tie checker holds `speedTie` to, written from the simulator's queue and
 * independent of the code under test.
 *
 * The cheap oracle is the round-70 probe: each side's move action resolved by `battle.queue.resolveAction` on a
 * disposable battle (a round trip through the stable serialization, not the module's copy), a tie when
 * `battle.comparePriority` says 0. Quick Claw and Quick Draw draw from the PRNG inside the resolve: it is asked with
 * every chance answering false and again with every chance true, and a tie under either answer is a possible tie.
 *
 * The played oracle plays the turn on a copy with the same dice and watches `speedSort`: a tie is a shuffle of a range
 * that holds both move actions.
 */

export type Chance = boolean;
export const CHANCES: readonly Chance[] = [false, true];

export interface Slot { side: 0 | 1; index: number }

const disposable = (live: Battle): Battle => deserializeBattleExact(serializeBattleStable(live));

/** The move action of one slot as the queue builds it, on a disposable battle with these dice. */
export function resolvedAction(live: Battle, at: Slot, moveId: string, chance: Chance): { priority: number; speed: number; order: number; fractionalPriority: number } & object {
  const copy = disposable(live);
  copy.prng = new FixedDice({ chance });
  const pokemon = copy.sides[at.side].active[at.index] as Pokemon;
  const actions = copy.queue.resolveAction({ choice: 'move', pokemon, moveid: moveId, targetLoc: 1 } as never);
  const action = actions.find(candidate => candidate.choice === 'move');
  if (!action) throw new Error(`no move action for ${moveId}`);
  return action as never;
}

/** Does the queue see these two move actions as equal, under either answer of the dice? Each side's action is resolved once per answer. */
export function cheapOracle(live: Battle, first: Slot, second: Slot): (m1: string, m2: string) => boolean {
  const held = new Map<string, ReturnType<typeof resolvedAction>>();
  const actionOf = (at: Slot, moveId: string, chance: Chance) => {
    const key = `${at.side}:${at.index}:${moveId}:${chance}`;
    let action = held.get(key);
    if (!action) held.set(key, action = resolvedAction(live, at, moveId, chance));
    return action;
  };
  return (m1, m2) => CHANCES.some(chance => live.comparePriority(actionOf(first, m1, chance) as never, actionOf(second, m2, chance) as never) === 0);
}

/** Plays one turn on a copy and reports whether `speedSort` flipped a coin between the two move actions. */
export function playedOracle(live: Battle, first: Slot, second: Slot, choices: { p1: string; p2: string }, chance: Chance): boolean {
  const copy = disposable(live);
  const a = copy.sides[first.side].active[first.index] as Pokemon;
  const b = copy.sides[second.side].active[second.index] as Pokemon;
  let flipped = false;
  const dice = new (class extends FixedDice {
    override shuffle<T>(items: T[], start = 0, end: number = items.length): void {
      const range = items.slice(start, end) as { choice?: string; pokemon?: Pokemon }[];
      const holds = (mon: Pokemon) => range.some(action => action.choice === 'move' && action.pokemon === mon);
      if (holds(a) && holds(b)) flipped = true;
      super.shuffle(items, start, end);
    }
  })({ chance });
  copy.prng = dice;
  copy.makeChoices(choices.p1, choices.p2);
  return flipped;
}

/** The played oracle under either answer of the dice. */
export const playedTie = (live: Battle, first: Slot, second: Slot, choices: { p1: string; p2: string }): boolean =>
  CHANCES.some(chance => playedOracle(live, first, second, choices, chance));

/** One board of the round-70 probe: two Pokémon, the two moves they click, an optional field set-up. */
export interface Board {
  name: string;
  p1: PokemonSet;
  p2: PokemonSet;
  m1: string;
  m2: string;
  setup?: (battle: Battle) => void;
}

const fast = (species: string, moves: string[], extra: Partial<PokemonSet> = {}) =>
  set(species, moves, { evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 252 }, ...extra });

/** The eight boards of the lessons' speed-tie probe. */
export function boards(): Board[] {
  return [
    { name: 'control: Tackle against Tackle', p1: fast('Sableye', ['tackle'], { ability: 'Keen Eye' }), p2: fast('Sableye', ['tackle'], { ability: 'Keen Eye' }), m1: 'tackle', m2: 'tackle' },
    { name: 'Prankster Thunder Wave against Quick Attack', p1: fast('Sableye', ['thunderwave'], { ability: 'Prankster' }), p2: fast('Sableye', ['quickattack'], { ability: 'Keen Eye' }), m1: 'thunderwave', m2: 'quickattack' },
    { name: 'Prankster Taunt against Tackle', p1: fast('Sableye', ['taunt'], { ability: 'Prankster' }), p2: fast('Sableye', ['tackle'], { ability: 'Keen Eye' }), m1: 'taunt', m2: 'tackle' },
    { name: 'Gale Wings Brave Bird against Quick Attack', p1: fast('Talonflame', ['bravebird'], { ability: 'Gale Wings' }), p2: fast('Talonflame', ['quickattack'], { ability: 'Flame Body' }), m1: 'bravebird', m2: 'quickattack' },
    { name: 'Triage Giga Drain against Quick Attack', p1: fast('Sableye', ['gigadrain'], { ability: 'Triage' }), p2: fast('Sableye', ['quickattack'], { ability: 'Keen Eye' }), m1: 'gigadrain', m2: 'quickattack' },
    { name: 'Quick Claw holder against plain', p1: fast('Sableye', ['tackle'], { ability: 'Keen Eye', item: 'Quick Claw' }), p2: fast('Sableye', ['tackle'], { ability: 'Keen Eye' }), m1: 'tackle', m2: 'tackle' },
    { name: 'Stall against plain', p1: fast('Sableye', ['tackle'], { ability: 'Stall' }), p2: fast('Sableye', ['tackle'], { ability: 'Keen Eye' }), m1: 'tackle', m2: 'tackle' },
    {
      name: 'Trick Room at equal speed', p1: fast('Sableye', ['tackle'], { ability: 'Keen Eye' }), p2: fast('Sableye', ['tackle'], { ability: 'Keen Eye' }), m1: 'tackle', m2: 'tackle',
      setup: battle => { battle.field.addPseudoWeather('trickroom', battle.sides[0].active[0] as Pokemon); },
    },
  ];
}

/** A board as a battle: one body per side, or two (the partner is slower and clicks Tackle) in doubles. */
export function boardBattle(format: string, doubles: boolean, board: Board): Battle {
  const partner = () => set('Snorlax', ['tackle'], { level: 50 });
  const battle = battleOf(format, doubles ? [board.p1, partner()] : [board.p1], doubles ? [board.p2, partner()] : [board.p2]);
  board.setup?.(battle);
  return battle;
}

/** The choices of a board's turn: slot a clicks the board's move at the foe's slot a, the partner (doubles) clicks Tackle. */
export const boardChoices = (board: Board, doubles: boolean): { p1: string; p2: string } => ({
  p1: doubles ? `move ${board.m1} 1, move tackle 1` : `move ${board.m1}`,
  p2: doubles ? `move ${board.m2} 1, move tackle 1` : `move ${board.m2}`,
});

export const SLOT_A: readonly [Slot, Slot] = [{ side: 0, index: 0 }, { side: 1, index: 0 }];
