import { describe, expect, test } from 'vitest';
import type { PokemonSet } from '@pkmn/sim';
import { loadSimMods } from '../src/forward/sim-mods';
import type { BranchRuntime } from '../src/branch-engine';
import type { DiceReport, ForcedDie } from '../src/dice/types';
import {
  accuracy, branchOf, clickWith, mon, runTurn, seedOfBranch, switchTo, turnLines, type Commands, type SlotChoices,
} from './branch-dice-support';

/**
 * Round 82 (forced dice), step A6, item 3: a turn that pauses for a switch in the middle (U-turn, Volt Switch, Flip Turn, Parting
 * Shot, Eject Button, Eject Pack, Emergency Exit, Wimp Out) goes on in a later `choose`: the app plays it as two calls of
 * `executeBranchChoices`, the second one the forced replacement. The forced dice span the whole turn, so a die of an action that
 * runs after the pause still applies, the report joins both calls, and the stream ends on the seed the turn without the die leaves.
 */
await loadSimMods('gen9championsou');

type Mode = 'singles' | 'doubles';
const SEEDS = ['1,2,3,4', '5,6,7,8', '9,10,11,12'];

interface Scene {
  name: string;
  /** The side whose body leaves: it gets the switch request. */
  leaves: 'p1' | 'p2';
  /** Pikachu's move in p1a: a pivot's own, or the hit that sets the holder off. */
  trigger: string;
  /** The body in p2a that holds the item or ability, and its share of HP at the start of the turn. */
  holder?: { set: PokemonSet; hp: number };
}

const SCENES: Scene[] = [
  ...['uturn', 'voltswitch', 'flipturn', 'partingshot'].map(move => ({ name: move, leaves: 'p1' as const, trigger: move })),
  { name: 'Eject Button', leaves: 'p2', trigger: 'tackle', holder: { set: mon('Snorlax', ['tackle'], { item: 'Eject Button' }), hp: 1 } },
  { name: 'Eject Pack', leaves: 'p2', trigger: 'growl', holder: { set: mon('Snorlax', ['tackle'], { item: 'Eject Pack' }), hp: 1 } },
  { name: 'Emergency Exit', leaves: 'p2', trigger: 'tackle', holder: { set: mon('Golisopod', ['tackle'], { ability: 'Emergency Exit' }), hp: 0.55 } },
  { name: 'Wimp Out', leaves: 'p2', trigger: 'tackle', holder: { set: mon('Wimpod', ['tackle'], { ability: 'Wimp Out' }), hp: 0.6 } },
];

/** The two calls of a turn: both sides' clicks, then the replacement. The die rides on the action that runs after the pause. */
function plan(scene: Scene, mode: Mode, happens: boolean) {
  const doubles = mode === 'doubles';
  const pivots = scene.leaves === 'p1';
  const lead1 = mon('Pikachu', [scene.trigger]);
  const p1 = doubles ? [lead1, mon('Eevee', ['splash']), mon('Blissey', ['splash'])] : [lead1, mon('Blissey', ['splash'])];
  const lead2 = scene.holder?.set ?? mon('Snorlax', ['poisonpowder']);
  const partner2 = mon('Snorlax', [pivots ? 'splash' : 'poisonpowder']);
  const p2 = doubles ? [lead2, partner2, mon('Chansey', ['splash'])] : [lead2, mon('Chansey', ['splash'])];
  // Pivot: the foe's Poison Powder comes after the pause. Eject kinds in doubles: the second foe's Poison Powder does. Singles ejects:
  // nothing runs after the pause, so the die is the accuracy of the hit that sets the holder off (forced yes keeps the pause).
  const die: ForcedDie = !pivots && !doubles
    ? accuracy('p1a', scene.trigger, 'p2a', happens)
    : accuracy(pivots ? 'p2a' : 'p2b', 'poisonpowder', doubles ? 'p1b' : 'p1a', happens);
  // a spread move takes no aim
  const aim = scene.trigger === 'growl' ? '' : ' 1';
  const commands: Commands = doubles
    ? [{ side: 'p1', command: `move 1${aim}, move 1` }, { side: 'p2', command: pivots ? 'move 1 2, move 1' : 'move 1 1, move 1 2' }]
    : [{ side: 'p1', command: 'move 1' }, { side: 'p2', command: 'move 1' }];
  const own = (index: number, side: 'p1' | 'p2') => (die.name.slot === `${side}${'ab'[index]}` ? [die] : []);
  const choices: SlotChoices = doubles
    ? {
      p1: [clickWith(scene.trigger, own(0, 'p1')), clickWith('splash', own(1, 'p1'))],
      p2: [clickWith(pivots ? 'poisonpowder' : 'tackle', own(0, 'p2')), clickWith(pivots ? 'splash' : 'poisonpowder', own(1, 'p2'))],
    }
    : { p1: [clickWith(scene.trigger, own(0, 'p1'))], p2: [clickWith('poisonpowder', own(0, 'p2'))] };
  const bench = pivots ? 'blissey' : 'chansey';
  const replacement = doubles
    ? { command: 'switch 3, pass', slots: [switchTo(bench), null] }
    : { command: 'switch 2', slots: [switchTo(pivots ? 'blissey' : 'chansey')] };
  return { format: doubles ? 'gen9doublescustomgame' : 'gen9customgame', p1, p2, commands, choices, replacement, die };
}

/** Both calls of the turn. `happens` null plays the turn as today: no dice argument in either call. */
async function playTurn(scene: Scene, mode: Mode, seed: string, happens: boolean | null) {
  const setup = plan(scene, mode, happens ?? true);
  const runtime: BranchRuntime = await branchOf(setup.format, setup.p1, setup.p2, seed);
  const battle = runtime.battleStream.battle!;
  if (scene.holder) {
    const body = battle.sides[1].active[0]!;
    body.hp = Math.max(1, Math.floor(body.maxhp * scene.holder.hp));
  }
  const start = battle.log.length;
  const first = await runTurn(runtime, setup.commands, happens === null ? null : setup.choices);
  const paused = battle.sides[scene.leaves === 'p1' ? 0 : 1].requestState === 'switch' && battle.turn === 1;
  const slots = scene.leaves === 'p1' ? { p1: setup.replacement.slots, p2: [] } : { p1: [], p2: setup.replacement.slots };
  const second = await runTurn(runtime, [{ side: scene.leaves, command: setup.replacement.command }], happens === null ? null : slots);
  return { runtime, first, second, paused, lines: turnLines(runtime, start), seed: seedOfBranch(runtime), die: setup.die };
}

const missed = (lines: string[], slot: string) => lines.some(line => line.startsWith(`|-miss|${slot}`));
const tookOf = (result: { ok: boolean; dice?: DiceReport }) => result.dice?.forced.map(entry => entry.took);

describe.each(['singles', 'doubles'] as const)('a turn that pauses for a switch keeps its dice, %s', mode => {
  test.each(SCENES)('$name: the die applies on both answers, the report joins the calls and the stream ends where the natural turn ends', { timeout: 120000 }, async scene => {
    let paused = 0;
    for (const seed of SEEDS) {
      const twin = await playTurn(scene, mode, seed, null);
      expect(twin.paused, `${seed} the turn without a die pauses`).toBe(true);
      for (const happens of [true, false]) {
        const label = `${seed} ${happens}`;
        const forced = await playTurn(scene, mode, seed, happens);
        expect(forced.first.ok, label).toBe(true);
        expect(forced.second.ok, label).toBe(true);
        expect(forced.runtime.battleStream.battle!.turn, label).toBe(2);
        const laterAction = forced.die.name.moveId === 'poisonpowder';
        if (laterAction) {
          expect(forced.paused, label).toBe(true);
          paused += 1;
          expect(missed(forced.lines, forced.die.name.slot), label).toBe(!happens);
          expect(tookOf(forced.second), label).toEqual(['applied']);
          expect(forced.seed, label).toBe(twin.seed);
        } else if (happens) {
          // a forced yes on the 100 percent hit that sets the holder off changes nothing
          expect(forced.paused, label).toBe(true);
          expect(tookOf(forced.second), label).toEqual(['applied']);
          expect(forced.seed, label).toBe(twin.seed);
        }
      }
    }
    expect(paused + (mode === 'singles' && scene.leaves === 'p2' ? 1 : 0)).toBeGreaterThan(0);
  });
});
