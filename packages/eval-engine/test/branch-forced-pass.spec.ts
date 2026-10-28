import { describe, expect, test } from 'vitest';
import { branchSideChoicesReady, requiredChoicesForActiveSlots, switchOptionKey, type BranchSlotChoice } from '../src/branch-choices';
import { resolveSideChoices } from '../src/branch/execute';
import { forceSwitches } from '../src/branch/corrections';
import { createBranchStateFromBattle } from '../src/branch/state';
import type { SimBattle } from '../src/branch/types';
import { setOf, startBattle } from './branch-rule-battles';

/**
 * Round 77, B1: a forced replacement with fewer Pokémon in the back than slots to fill. The simulator
 * asks every fainted slot for a replacement and accepts one switch plus a pass (side.js clearChoice:
 * forcedPasses = canSwitchOut - min(canSwitchOut, canSwitchIn)). The picker must not make the user
 * choose twice from a bench of one: the slots the bench cannot fill pass by themselves, the rest is
 * chosen, and the command the app sends is the one the simulator accepts.
 *
 * The scene (VGC regi-2629703929 T8): both Pokémon of P2 faint, only Jumpluff is left. Rows below play
 * every position of one and two fainted actives against zero, one and two Pokémon in the back, on both
 * sides, in doubles (and singles, where one slot can never be left unfilled: the game ends first).
 */

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

/** The user's way through the picker: a distinct switch-in for each slot the panel requires. */
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

describe('B1 doubles: the bench decides how many replacements are chosen', () => {
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
          // The panel's own state agrees with the helper the hooks use.
          const state = createBranchStateFromBattle(battle, [], {});
          expect(leaverIndex === 0 ? state.p1ForceSwitches : state.p2ForceSwitches).toEqual(forced);

          if (!asked.some(Boolean)) {
            // The simulator asks nothing (zero in the back, or one slot fainted and nothing to send): the side passes by itself.
            expect(forced.some(Boolean)).toBe(false);
            expect(battle.requestState === 'move' || battle.ended).toBe(true);
            return;
          }
          expect(required.filter(Boolean).length).toBe(fillable);
          // Only slots the simulator asked about can be required.
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

describe('B1 singles: a forced replacement always has a Pokémon to take', () => {
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
