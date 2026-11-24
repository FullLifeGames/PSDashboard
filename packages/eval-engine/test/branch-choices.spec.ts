import { test, expect, describe } from 'vitest';
import {
  branchSideChoicesReady,
  conflictingSwitchTargets,
  describeSlotChoice,
  evalChoiceToSlotChoices,
  notationDice,
  notationSideLabel,
  notationSlotChoice,
  notationSlotDice,
  requiredChoicesForActiveSlots,
  switchChoiceKey,
  switchOptionKey,
  type BranchSlotChoice,
} from '../src/branch-choices';
import type { BranchMoveOption, BranchSwitchOption, BranchTargetOption } from '../src/branch-engine';
import { toId } from '@fulllifegames/replay-core';
import { dieLabel, type DieWords } from '../src/dice/die-label';
import type { ForcedDie } from '../src/dice/types';
import { forceSwitches } from '../src/branch/corrections';
import { createBranchStateFromBattle } from '../src/branch/state';
import type { SimBattle } from '../src/branch/types';
import { setOf, startBattle } from './branch-rule-battles';
import type { PokemonSet } from '@pkmn/sim';
import { createBranchState, executeBranchChoices, reconstructBranchRuntime, resolveSideChoices } from '../src/branch-engine';

function switchTo(species: string, name = species): BranchSlotChoice {
  return { kind: 'switch', speciesId: toId(species), pokemonName: name };
}

function moveBy(name: string, targetLoc?: number): BranchSlotChoice {
  return {
    kind: 'move',
    moveId: toId(name),
    moveName: name,
    ...(targetLoc !== undefined ? { targetLoc } : {}),
  };
}

describe('branch choice helpers', () => {
  test('requires every live active slot unless a force switch request narrows the choice set', () => {
    expect(requiredChoicesForActiveSlots([{ fainted: false }, { fainted: false }], []))
      .toEqual([true, true]);
    expect(requiredChoicesForActiveSlots([{ fainted: false }, { fainted: false }], [true, false]))
      .toEqual([true, false]);
    expect(requiredChoicesForActiveSlots([{ fainted: true }, { fainted: false }], []))
      .toEqual([false, true]);
  });

  test('rejects duplicate switch targets across simultaneous doubles slots', () => {
    expect(branchSideChoicesReady([switchTo('Raichu'), switchTo('Raichu')], [true, true])).toBe(false);
    expect(conflictingSwitchTargets([switchTo('Raichu'), switchTo('Raichu')], [true, true]))
      .toEqual(['raichu|raichu']);
    expect(branchSideChoicesReady([switchTo('Raichu'), switchTo('Squirtle')], [true, true])).toBe(true);
  });

  test('allows same-species switches to different nicknamed team members', () => {
    expect(branchSideChoicesReady([switchTo('Eevee', 'Alpha'), switchTo('Eevee', 'Beta')], [true, true]))
      .toBe(true);
    expect(switchChoiceKey(switchTo('Eevee', 'Alpha')))
      .toBe(switchOptionKey({ species: 'Eevee', name: 'Alpha' }));
  });

  test('treats missing choices as not ready only for required slots', () => {
    expect(branchSideChoicesReady([switchTo('Raichu'), null], [true, false])).toBe(true);
    expect(branchSideChoicesReady([switchTo('Raichu'), null], [true, true])).toBe(false);
  });

  test('describes slot choices with move names and targets', () => {
    expect(describeSlotChoice(moveBy('Blizzard'))).toBe('move Blizzard');
    expect(describeSlotChoice(moveBy('Icy Wind', 1))).toBe('move Icy Wind +1');
    expect(describeSlotChoice(moveBy('Flamethrower', -2))).toBe('move Flamethrower -2');
    expect(describeSlotChoice(switchTo('Skarmory'))).toBe('switch Skarmory');
    expect(describeSlotChoice(null)).toBe('');
  });

  test('notation labels read as move names, never raw sim commands', () => {
    expect(notationSlotChoice(moveBy('Ice Beam'))).toBe('Ice Beam');
    expect(notationSlotChoice(switchTo('Kyurem'))).toBe('→ Kyurem');
    expect(notationSideLabel([moveBy('Ice Beam')], 'move 1')).toBe('Ice Beam');
    expect(notationSideLabel([moveBy('Icy Wind', 1), switchTo('Skarmory')], 'move 2 +1, switch 3'))
      .toBe('Icy Wind +1 + → Skarmory');
    // Entries recorded without an identity fall back raw.
    expect(notationSideLabel(undefined, 'move 1')).toBe('move 1');
    expect(notationSideLabel([null], 'switch 2')).toBe('switch 2');
  });
});

describe('engine choice → branch slot choices', () => {
  const target = (targetLoc: number): BranchTargetOption =>
    ({ label: `${targetLoc}`, targetLoc, side: 'p2', activeSlot: 0, name: 'Foe', species: 'Foe', hpPercent: 100 });
  const move = (name: string, activeSlot: number, slot: number, targets: number[] = []): BranchMoveOption => ({
    name, activeSlot, slot, pp: 16, maxpp: 16, disabled: false, type: 'Normal', targetType: 'normal',
    requiresTarget: targets.length > 0, targetOptions: targets.map(target),
  });
  const bench = (name: string, slot: number): BranchSwitchOption =>
    ({ name, species: name, activeSlot: 0, slot, hp: '100/100', hpPercent: 100, fainted: false });

  test('a singles move with a gimmick maps onto one slot', () => {
    const choices = evalChoiceToSlotChoices('move bugbite terastallize', [[move('Bug Bite', 0, 1)]], [[]]);
    expect(choices).toEqual([
      { kind: 'move', moveId: 'bugbite', moveName: 'Bug Bite', modifier: 'terastallize' },
    ]);
  });

  test('a doubles combined choice maps per slot with targets, mega, and switches', () => {
    const choices = evalChoiceToSlotChoices(
      'move bugbite 1 mega, switch 3',
      [[move('Bug Bite', 0, 1, [1, 2])], []],
      [[], [bench('Amoonguss', 3)]],
    );
    expect(choices).toEqual([
      { kind: 'move', moveId: 'bugbite', moveName: 'Bug Bite', targetLoc: 1, modifier: 'mega' },
      { kind: 'switch', speciesId: 'amoonguss', pokemonName: 'Amoonguss' },
    ]);
  });

  test('switch parts resolve by the label species, surviving bench-order divergence', () => {
    // The engine's "switch 3" indexes ITS battle's bench; here the branch
    // holds Amoonguss at slot 5, so the label species must win over the slot.
    expect(evalChoiceToSlotChoices(
      'move protect, switch 3',
      [[move('Protect', 0, 1)], []],
      [[], [bench('Amoonguss', 5)]],
      'Protect + → Amoonguss',
    )).toEqual([
      { kind: 'move', moveId: 'protect', moveName: 'Protect' },
      { kind: 'switch', speciesId: 'amoonguss', pokemonName: 'Amoonguss' },
    ]);
    expect(evalChoiceToSlotChoices('switch 3', [[]], [[bench('Amoonguss', 5)]])).toBeNull();
  });

  test('a forced-replacement choice maps onto the forced slot, not slot 0', () => {
    // Doubles wedge (VGC play-out): slot b's Pokémon fainted while slot a
    // pivoted out the same turn. The engine emits the one-part choice
    // "switch 2" FOR THE FORCED SLOT; without the mask it landed on slot 0,
    // reserved the species there, and locked the only legal button.
    expect(evalChoiceToSlotChoices(
      'switch 2',
      [[], []],
      [[], [bench('Incineroar', 2)]],
      '→ Incineroar',
      [false, true],
    )).toEqual([null, { kind: 'switch', speciesId: 'incineroar', pokemonName: 'Incineroar' }]);
  });

  test('the mask keeps aligned and full-width strings working as before', () => {
    expect(evalChoiceToSlotChoices(
      'move protect, switch 3',
      [[move('Protect', 0, 1)], []],
      [[], [bench('Amoonguss', 3)]],
      undefined,
      [true, true],
    )).toEqual([
      { kind: 'move', moveId: 'protect', moveName: 'Protect' },
      { kind: 'switch', speciesId: 'amoonguss', pokemonName: 'Amoonguss' },
    ]);
    expect(evalChoiceToSlotChoices(
      'pass, move protect',
      [[], [move('Protect', 1, 1)]],
      [[], []],
      undefined,
      [false, true],
    )).toEqual([null, { kind: 'move', moveId: 'protect', moveName: 'Protect' }]);
    expect(evalChoiceToSlotChoices('move bugbite', [[move('Bug Bite', 0, 1)]], [[]], undefined, [true]))
      .toEqual([{ kind: 'move', moveId: 'bugbite', moveName: 'Bug Bite' }]);
  });

  test('a mask/part mismatch refuses instead of guessing a slot', () => {
    // Two parts but only one slot may act, and the string is not full-width
    // either (three slots): a guessed placement could play the wrong slot.
    expect(evalChoiceToSlotChoices(
      'move protect, switch 2',
      [[move('Protect', 0, 1)], [], []],
      [[], [bench('Amoonguss', 2)], []],
      undefined,
      [false, true, false],
    )).toBeNull();
  });

  test('a pass slot stays empty and an unresolvable part rejects the whole pick', () => {
    expect(evalChoiceToSlotChoices('pass, move protect', [[], [move('Protect', 1, 1)]], [[], []]))
      .toEqual([null, { kind: 'move', moveId: 'protect', moveName: 'Protect' }]);
    // The move exists but the named switch target does not: no partial prefill.
    expect(evalChoiceToSlotChoices('move protect, switch 5', [[move('Protect', 0, 1)], []], [[], [bench('Amoonguss', 3)]]))
      .toBeNull();
  });
});

// The labels of a slot's forced dice come from `dieLabel`, so a history row, a share link
// and a frame line say the same thing about a die.
describe('notation of forced dice', () => {
  const words: DieWords = { move: id => `Move ${id}`, effect: id => `Effect ${id}`, slot: slot => `Body ${slot}` };
  const flinch: ForcedDie = { name: { slot: 'p1a', moveId: 'airslash', targetSlot: 'p2a', kind: 'secondary', effectId: 'flinch' }, result: { happens: true } };
  const miss: ForcedDie = { name: { slot: 'p1a', moveId: 'airslash', targetSlot: 'p2a', kind: 'accuracy' }, result: { happens: false } };

  test('a choice names each of its dice by the label the chips and the frame lines use', () => {
    const choice: BranchSlotChoice = { ...moveBy('Air Slash'), dice: [miss, flinch] };
    expect(notationSlotDice(choice, words)).toEqual([dieLabel(miss, words), dieLabel(flinch, words)]);
    expect(notationSlotDice(choice, words)).toEqual(['Move airslash: misses', 'Move airslash: Effect flinch']);
    expect(notationDice([flinch])).toEqual([dieLabel(flinch)]);
  });

  test('a choice without dice, a pass and a switch name none', () => {
    expect(notationSlotDice(moveBy('Ice Beam'), words)).toEqual([]);
    expect(notationSlotDice(null, words)).toEqual([]);
    expect(notationSlotDice({ ...switchTo('Kyurem'), dice: [flinch] }, words)).toEqual(['Move airslash: Effect flinch']);
    expect(notationDice(undefined)).toEqual([]);
  });

  test('the notation of the choice itself stays as it was', () => {
    expect(notationSlotChoice({ ...moveBy('Air Slash'), dice: [flinch] })).toBe('Air Slash');
    expect(notationSideLabel([{ ...moveBy('Air Slash'), dice: [flinch] }], 'move 1')).toBe('Air Slash');
  });
});

const EXIT = ['Memento', 'Splash'];
const BENCH_SPECIES = ['Pikachu', 'Eevee'];
const FOES = ['Snorlax', 'Corviknight', 'Amoonguss', 'Gliscor'];
const sideId = (index: number) => (index === 0 ? 'p1' : 'p2') as 'p1' | 'p2';

/** The leavers' team: `actives` Pokémon that faint on a Memento or stand, then `bench` living ones. */
function team(actives: number, bench: number) {
  const front = ['Rillaboom', 'Parasect'].slice(0, actives).map(species => setOf(species, EXIT));
  return [...front, ...BENCH_SPECIES.slice(0, bench).map(species => setOf(species, ['Splash']))];
}

function playOut(format: string, leaverIndex: number, actives: number, bench: number, leaving: number[]) {
  const leaver = team(actives, bench);
  const foes = FOES.map(species => setOf(species, ['Splash']));
  const battle = startBattle(format, leaverIndex === 0 ? leaver : foes, leaverIndex === 0 ? foes : leaver);
  const leaverCommand = Array.from({ length: actives }, (_, slot) => (leaving.includes(slot) ? 'move 1 1' : 'move 2')).join(', ');
  const foeCommand = Array.from({ length: actives }, () => 'move 1').join(', ');
  expect(battle.choose(sideId(leaverIndex), leaverCommand)).toBe(true);
  expect(battle.choose(sideId(1 - leaverIndex), foeCommand)).toBe(true);
  return battle;
}

const askedSlots = (battle: SimBattle, index: number): boolean[] =>
  battle.sides[index].activeRequest?.forceSwitch ?? battle.sides[index].active.map(() => false);

function pickReplacements(battle: SimBattle, index: number, required: boolean[]): (BranchSlotChoice | null)[] {
  const state = createBranchStateFromBattle(battle, [], {});
  const switches = index === 0 ? state.p1SwitchesBySlot : state.p2SwitchesBySlot;
  const used = new Set<string>();
  return required.map((needed, slot) => {
    if (!needed) return null;
    const option = switches[slot].find(candidate => !used.has(switchOptionKey(candidate)));
    expect(option, `slot ${slot} has a switch-in left`).toBeDefined();
    used.add(switchOptionKey(option!));
    return { kind: 'switch', speciesId: option!.species.toLowerCase(), pokemonName: option!.name };
  });
}

const DOUBLES = 'gen9doublescustomgame';
const LEAVING_ROWS = [[0], [1], [0, 1]];

describe('doubles: the bench decides how many replacements are chosen', () => {
  for (const leaverIndex of [0, 1]) {
    for (const leaving of LEAVING_ROWS) {
      for (const bench of [0, 1, 2]) {
        const name = `${sideId(leaverIndex)} loses slot${leaving.length > 1 ? 's' : ''} ${leaving.map(slot => 'AB'[slot]).join('+')} with ${bench} in the back`;
        test(name, () => {
          const battle = playOut(DOUBLES, leaverIndex, 2, bench, leaving);
          const asked = askedSlots(battle, leaverIndex);
          const fillable = Math.min(asked.filter(Boolean).length, bench);
          const forced = forceSwitches(battle, leaverIndex);
          const required = requiredChoicesForActiveSlots(battle.sides[leaverIndex].active, forced);
          const state = createBranchStateFromBattle(battle, [], {});
          expect(leaverIndex === 0 ? state.p1ForceSwitches : state.p2ForceSwitches).toEqual(forced);

          if (!asked.some(Boolean)) {
            // The simulator asks nothing (zero in the back, or one slot fainted and nothing to send): the side passes by itself.
            expect(forced.some(Boolean)).toBe(false);
            expect(battle.requestState === 'move' || battle.ended).toBe(true);
            return;
          }
          expect(required.filter(Boolean).length).toBe(fillable);
          // A slot that passes offers no switch-in: its header says nobody is left, and no chip can reserve a Pokémon there.
          const switches = leaverIndex === 0 ? state.p1SwitchesBySlot : state.p2SwitchesBySlot;
          battle.sides[leaverIndex].active.forEach((active, slot) => { if (active.fainted && !forced[slot]) expect(switches[slot]).toEqual([]); });
          required.forEach((needed, slot) => { if (needed) expect(asked[slot]).toBe(true); });
          const choices = pickReplacements(battle, leaverIndex, required);
          expect(branchSideChoicesReady(choices, required)).toBe(true);
          const command = resolveSideChoices(battle, sideId(leaverIndex), choices, required);
          expect(command.ok).toBe(true);
          if (!command.ok) return;
          expect(battle.choose(sideId(leaverIndex), command.command)).toBe(true);
          expect(battle.sides[leaverIndex].activeRequest?.forceSwitch?.some(Boolean) ?? false).toBe(false);
        });
      }
    }
  }

  test('the reported scene: two actives down, one Pokémon left, one pick and Execute is ready', () => {
    const battle = playOut(DOUBLES, 1, 2, 1, [0, 1]);
    expect(askedSlots(battle, 1)).toEqual([true, true]);
    const forced = forceSwitches(battle, 1);
    expect(forced).toEqual([true, false]);
    const required = requiredChoicesForActiveSlots(battle.sides[1].active, forced);
    expect(branchSideChoicesReady([null, null], required)).toBe(false);
    expect(branchSideChoicesReady(pickReplacements(battle, 1, required), required)).toBe(true);
    const command = resolveSideChoices(battle, 'p2', pickReplacements(battle, 1, required), required);
    expect(command).toEqual({ ok: true, command: expect.stringMatching(/^switch \d, pass$/) });
  });
});

describe('singles: a forced replacement always has a Pokémon to take', () => {
  for (const leaverIndex of [0, 1]) {
    for (const bench of [1, 2]) {
      test(`${sideId(leaverIndex)} with ${bench} in the back stays one required pick`, () => {
        const battle = playOut('gen9customgame', leaverIndex, 1, bench, [0]);
        expect(askedSlots(battle, leaverIndex)).toEqual([true]);
        const forced = forceSwitches(battle, leaverIndex);
        expect(forced).toEqual([true]);
        const required = requiredChoicesForActiveSlots(battle.sides[leaverIndex].active, forced);
        expect(required).toEqual([true]);
        const choices = pickReplacements(battle, leaverIndex, required);
        const command = resolveSideChoices(battle, sideId(leaverIndex), choices, required);
        expect(command.ok).toBe(true);
        if (command.ok) expect(battle.choose(sideId(leaverIndex), command.command)).toBe(true);
      });
    }
  }
});

const p1Team: PokemonSet[] = [
  {
    name: 'Garchomp',
    species: 'Garchomp',
    item: 'Loaded Dice',
    ability: 'Rough Skin',
    moves: ['Earthquake', 'Protect'],
    nature: 'Jolly',
    evs: { hp: 0, atk: 252, def: 0, spa: 0, spd: 4, spe: 252 },
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
    level: 100,
    teraType: 'Fire',
  },
];

const p2Team: PokemonSet[] = [
  {
    name: 'Skarmory',
    species: 'Skarmory',
    item: 'Rocky Helmet',
    ability: 'Sturdy',
    moves: ['Roost', 'Spikes'],
    nature: 'Bold',
    evs: { hp: 252, atk: 0, def: 252, spa: 0, spd: 4, spe: 0 },
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
    level: 100,
  },
];

const singlesLog = [
  '|switch|p1a: Garchomp|Garchomp, M|100/100',
  '|switch|p2a: Skarmory|Skarmory, F|100/100',
  '|turn|1',
].join('\n');

describe('battle gimmick choices', () => {
  test('describes modifier choices in pending chips', () => {
    const tera: BranchSlotChoice = { kind: 'move', moveId: 'earthquake', moveName: 'Earthquake', modifier: 'terastallize' };
    expect(describeSlotChoice(tera)).toBe('move Earthquake (Tera)');
    const z: BranchSlotChoice = { kind: 'move', moveId: 'thunderbolt', moveName: 'Thunderbolt', targetLoc: 1, modifier: 'zmove' };
    expect(describeSlotChoice(z)).toBe('move Thunderbolt +1 (Z)');
  });

  test('exposes Tera availability and executes a terastallized turn in gen 9', async () => {
    const runtime = await reconstructBranchRuntime({
      format: 'gen9ou',
      p1Team,
      p2Team,
      replayLog: singlesLog,
      targetTurn: 1,
    });
    const battle = runtime.battleStream.battle!;

    const state = createBranchState(runtime.battleStream, runtime.log, { p1Choices: [], p2Choices: [] });
    expect(state.p1ModifiersBySlot[0]?.teraType).toBe('Fire');

    const choice: BranchSlotChoice = { kind: 'move', moveId: 'earthquake', moveName: 'Earthquake', modifier: 'terastallize' };
    const resolved = resolveSideChoices(battle, 'p1', [choice], [true]);
    expect(resolved).toEqual({ ok: true, command: 'move 1 terastallize' });

    const result = await executeBranchChoices({
      streams: runtime.streams,
      log: runtime.log,
      choiceErrors: runtime.choiceErrors,
      commands: [
        { side: 'p1', command: resolved.ok ? resolved.command : '' },
        { side: 'p2', command: 'move 1' },
      ],
    });
    expect(result.ok).toBe(true);

    const deadline = Date.now() + 2000;
    while (Date.now() < deadline && !runtime.log.some(line => line.startsWith('|-terastallize|p1a'))) {
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    expect(runtime.log.some(line => line.startsWith('|-terastallize|p1a'))).toBe(true);

    // Tera is once per battle: availability disappears afterwards.
    const nextState = createBranchState(runtime.battleStream, runtime.log, { p1Choices: [], p2Choices: [] });
    expect(nextState.p1ModifiersBySlot[0]?.teraType).toBeNull();
  });

  test('offers no gimmicks in gen 3', async () => {
    const runtime = await reconstructBranchRuntime({
      format: 'gen3ou',
      p1Team: [{ ...p1Team[0], item: 'Choice Band', teraType: undefined, moves: ['Earthquake', 'Protect'] }],
      p2Team,
      replayLog: singlesLog,
      targetTurn: 1,
    });
    const state = createBranchState(runtime.battleStream, runtime.log, { p1Choices: [], p2Choices: [] });
    const modifiers = state.p1ModifiersBySlot[0];
    expect(modifiers?.teraType ?? null).toBeNull();
    expect(modifiers?.canMegaEvo ?? false).toBe(false);
    expect((modifiers?.zMoves ?? []).some(Boolean)).toBe(false);
  });
});
