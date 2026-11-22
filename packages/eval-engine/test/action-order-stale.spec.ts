import { afterAll, describe, expect, test } from 'vitest';
import type { Battle, Pokemon } from '@pkmn/sim';
import { copyOf } from '../src/sim-ask/copy';
import { actionPriority, queuePlace } from '../src/sim-ask/action-order';
import { askCheckOn, AskLeak, setAskCheck } from '../src/sim-ask/guard';
import { mon, RULES, type Mode, type Rules } from './dice-fixtures';
import { battleOf } from './power-oracle';

/**
 * Round 89 (M, fix 3 of #111): `queuePlace` and `actionPriority` read the action speed and the priority handlers of a body on the battle
 * they are given, and the rebuild gives them its LIVE battle, which it plays turn after turn. A value read in one turn must never answer a
 * later turn: Trick Room, Tailwind, paralysis, a stat stage, a body that comes back in after a switch, an item knocked off, an item or an
 * ability that gains a priority handler. The first version kept both reads per battle and body ("a position's reader battle is never
 * written"), which holds for the search's reader battles and not for the rebuild (2630685175 turn 5, Trick Room: Fake Out's user read
 * the speed of turn 4, 105 for 1703, and the cant stand-in of the flinching body got no move).
 *
 * Each row asks one body, changes the battle the way the simulator does it in play (an event, a switch, a knocked-off item), and asks the
 * same body again: the answer must equal the one a battle that was never asked gives (a copy of the live one is a new battle object, so it
 * holds no memo) and the body's own `getActionSpeed()`; the row also checks that the change moved the answer, so a row cannot pass by
 * changing nothing. The rows run in singles and doubles, with the development check off (the app and the bank) and on (`sim-ask.spec.ts`
 * and the sweeps): with it on, the memo of the first version threw `AskLeak` at the second question, and no spec asked twice.
 */

const GEN9 = RULES.find(rules => rules.generation === 9 && rules.name === 'Gen 9')!;
const MODES: Mode[] = ['singles', 'doubles'];

interface Change {
  name: string;
  move: string;
  /** The body's item and ability. */
  item?: string;
  ability?: string;
  /** Changes the live battle before the first question. */
  prepare?(battle: Battle, body: Pokemon): void;
  /** Changes the live battle after the first question. */
  apply(battle: Battle, body: Pokemon, mode: Mode): void;
  /** What the change moves: the speed or the priority of the body's action. */
  moves: 'speed' | 'priority';
  chance?: boolean;
}

const play = (battle: Battle, mode: Mode, p1: string): void => {
  if (mode === 'singles') battle.makeChoices(p1, 'move 1');
  else battle.makeChoices(`${p1}, move 1`, 'move 1, move 1');
};

const CHANGES: Change[] = [
  { name: 'paralysis', move: 'tackle', moves: 'speed', apply: (_battle, body) => { body.setStatus('par'); } },
  { name: 'a speed stage', move: 'tackle', moves: 'speed', apply: (_battle, body) => { body.boostBy({ spe: 2 }); } },
  { name: 'Trick Room set', move: 'tackle', moves: 'speed', apply: (battle, body) => { battle.field.addPseudoWeather('trickroom', body); } },
  { name: 'Tailwind set', move: 'tackle', moves: 'speed', apply: (_battle, body) => { body.side.addSideCondition('tailwind', body); } },
  { name: 'Choice Scarf knocked off', move: 'tackle', item: 'choicescarf', moves: 'speed', apply: (_battle, body) => { body.takeItem(); } },
  {
    name: 'a boosted body that switches out and comes back', move: 'tackle', moves: 'speed',
    prepare: (_battle, body) => { body.boostBy({ spe: 2 }); },
    apply: (battle, _body, mode) => {
      play(battle, mode, 'switch 3');
      play(battle, mode, 'switch 3');
    },
  },
  { name: 'Prankster gained (ability change)', move: 'thunderwave', moves: 'priority', apply: (_battle, body) => { body.setAbility('prankster'); } },
  { name: 'Quick Claw gained (item change)', move: 'tackle', moves: 'priority', chance: true, apply: (_battle, body) => { body.setItem('quickclaw'); } },
  { name: 'Quick Claw knocked off (a handler that was there, answered by the copy)', move: 'tackle', item: 'quickclaw', moves: 'priority', chance: true, apply: (_battle, body) => { body.takeItem(); } },
];

function sceneOf(rules: Rules, mode: Mode, change: Change): { battle: Battle; body: Pokemon } {
  const plain = (species: string) => mon(rules, { species, moves: ['splash', 'tackle', 'thunderwave'] });
  const holder = { ...plain('Snorlax'), ...(change.item ? { item: change.item } : {}), ...(change.ability ? { ability: change.ability } : {}) };
  const p1 = mode === 'singles' ? [holder, plain('Blissey'), plain('Chansey')] : [holder, plain('Blissey'), plain('Chansey'), plain('Pikachu')];
  const p2 = mode === 'singles' ? [plain('Vaporeon')] : [plain('Vaporeon'), plain('Jolteon')];
  const battle = battleOf(mode === 'singles' ? rules.singles : rules.doubles!, p1, p2);
  return { battle, body: battle.sides[0].active[0] as Pokemon };
}

/** A battle that was never asked: a copy is a new battle object, so no memo of the live one reaches it. */
const unasked = (battle: Battle, body: Pokemon, move: string, chance: boolean) => {
  const copy = copyOf(battle);
  const same = copy.sides[0].pokemon[body.side.pokemon.indexOf(body)];
  const check = askCheckOn();
  setAskCheck(false); // a copy has no live prng to fingerprint
  try { return queuePlace(copy, same, move, chance); } finally { setAskCheck(check); }
};

afterAll(() => setAskCheck(null));

describe.each(MODES)('a body asked twice on one live battle: %s', mode => {
  describe.each([false, true])('development check %s', check => {
    test.each(CHANGES.map(change => [change.name, change] as const))('%s', (_name, change) => {
      setAskCheck(check);
      const chance = change.chance ?? false;
      const { battle, body } = sceneOf(GEN9, mode, change);
      change.prepare?.(battle, body);
      const before = queuePlace(battle, body, change.move, chance);
      change.apply(battle, battle.sides[0].active[0] as Pokemon, mode);
      const now = battle.sides[0].active[0] as Pokemon;
      const expected = unasked(battle, now, change.move, chance);
      const after = queuePlace(battle, now, change.move, chance);
      // the row proves its change: the answer a never-asked battle gives is not the first one
      expect(change.moves === 'speed' ? expected.speed : expected.priority).not.toBe(change.moves === 'speed' ? before.speed : before.priority);
      expect(after).toEqual({ priority: expected.priority, speed: expected.speed });
      expect(after.speed).toBe(now.getActionSpeed());
      expect(actionPriority(battle, now, change.move, chance)).toBe(expected.priority);
    });
  });

  test('the check on a body whose answers did not change stays silent', () => {
    setAskCheck(true);
    const { battle, body } = sceneOf(GEN9, mode, { name: 'none', move: 'tackle', moves: 'speed', apply: () => {} });
    const first = queuePlace(battle, body, 'tackle', false);
    expect(() => queuePlace(battle, body, 'tackle', false)).not.toThrow(AskLeak);
    expect(queuePlace(battle, body, 'tackle', false)).toEqual(first);
  });
});
