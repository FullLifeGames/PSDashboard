import { describe, expect, test } from 'vitest';
import { resolveSideChoices } from '../src/branch/execute';
import { createBranchStateFromBattle } from '../src/branch/state';
import type { SimBattle } from '../src/branch/types';
import { FORMATS, moveCommand, setOf, sideId, startBattle } from './branch-rule-battles';

/**
 * Round 77, A-3: Magnezone (Magnet Pull) stood against Melmetal, the picker offered five switch chips,
 * and Execute failed with "Can't switch: The active Pokémon is trapped". The simulator refuses a switch
 * while `pokemon.trapped` is set in a move request (side.js chooseSwitch), whatever put it there: a
 * trapping ability (Shadow Tag, Arena Trap, Magnet Pull), a trapping move (Mean Look, Block, Spider
 * Web, the binding moves, Octolock, Ingrain, No Retreat, Jaw Lock, Anchor Shot and the rest the Dex
 * knows), a locked move. What frees it (a Ghost type, Shed Shell) is the simulator's rule too.
 *
 * The sweep plays every move of the Dex once from a No Guard source against the victim, and every
 * ability the Dex gives a trap handler, then asks the simulator's own `choose` whether the victim may
 * switch and compares: the picker's chip is disabled exactly when the simulator refuses. The victim
 * stands on either side, in singles and in doubles. The scene of the report is one row (Magnet Pull
 * against a Steel type).
 */

interface Victim { species: string; item?: string }
const PLAIN: Victim = { species: 'Pikachu' };
const swapCommand = (doubles: boolean) => (doubles ? 'switch 3, move 1' : 'switch 2');

/** The picker's view: whether every chip of slot A is disabled for trapping (all or none, never a mix). */
function chipsTrapped(battle: SimBattle, victimSide: number): boolean {
  const state = createBranchStateFromBattle(battle, [], {});
  const chips = (victimSide === 0 ? state.p1SwitchesBySlot : state.p2SwitchesBySlot)[0];
  expect(chips.length).toBeGreaterThan(0);
  const trapped = chips.filter(chip => chip.trapped);
  expect([0, chips.length]).toContain(trapped.length);
  return trapped.length > 0;
}

/** The simulator's answer: may slot A switch to the first bench body? */
function simulatorRefusesSwitch(battle: SimBattle, victimSide: number, doubles: boolean): boolean {
  return !battle.choose(sideId(victimSide), swapCommand(doubles));
}

interface Setup { source: { species: string; ability: string; moves: string[] }; victim: Victim; move: string }

function play(format: typeof FORMATS[number], victimSide: number, setup: Setup): SimBattle | null {
  const doubles = format.doubles;
  const victim = [setOf(setup.victim.species, ['Splash'], { item: setup.victim.item ?? '' }),
    ...(doubles ? [setOf('Eevee', ['Splash'])] : []), setOf('Meowth', ['Splash']), setOf('Persian', ['Splash'])];
  const source = [setOf(setup.source.species, setup.source.moves, { ability: setup.source.ability }),
    ...(doubles ? [setOf('Corviknight', ['Splash'])] : []), setOf('Gliscor', ['Splash'])];
  const battle = startBattle(format.id, victimSide === 0 ? victim : source, victimSide === 0 ? source : victim);
  const victimTurn = doubles ? 'move Splash, move Splash' : 'move Splash';
  const sourceTurn = setup.move ? moveCommand(battle, setup.move, doubles) : (doubles ? 'move Splash, move Splash' : 'move Splash');
  if (!battle.choose(sideId(victimSide), victimTurn) || !battle.choose(sideId(1 - victimSide), sourceTurn)) return null;
  // Only a plain next turn is compared: a move that left a replacement open or ended the game has no switch to ask about.
  const side = battle.sides[victimSide];
  if (battle.ended || side.requestState !== 'move' || side.active[0].fainted) return null;
  return battle;
}

describe('A-3 the switch chips follow the simulator on trapping', () => {
  for (const format of FORMATS) {
    for (const victimSide of [0, 1]) {
      test(`${format.name}, ${sideId(victimSide)}: every Dex move, then the chips match what the simulator refuses`, () => {
        const dex = startBattle(format.id, ['Pikachu', 'Meowth'].map(name => setOf(name, ['Splash'])), ['Eevee', 'Persian'].map(name => setOf(name, ['Splash']))).dex;
        let compared = 0;
        const trappedBy: string[] = [];
        for (const move of dex.moves.all()) {
          if (move.isMax || move.isZ || move.id === 'struggle' || move.id === 'recharge') continue;
          const battle = play(format, victimSide, {
            source: { species: 'Dugtrio', ability: 'No Guard', moves: [move.name, 'Splash'] }, victim: PLAIN, move: move.name,
          });
          if (!battle) continue;
          compared++;
          const picker = chipsTrapped(battle, victimSide);
          const refused = simulatorRefusesSwitch(battle, victimSide, format.doubles);
          expect(picker, move.name).toBe(refused);
          if (refused) trappedBy.push(move.id);
        }
        // The sweep reached the trapping moves: the binding family, Mean Look and its kin all show up.
        expect(compared).toBeGreaterThan(500);
        expect(trappedBy.length).toBeGreaterThanOrEqual(8);
      });

      test(`${format.name}, ${sideId(victimSide)}: every Dex ability with a trap handler, against every kind of victim`, () => {
        const dex = startBattle(format.id, ['Pikachu', 'Meowth'].map(name => setOf(name, ['Splash'])), ['Eevee', 'Persian'].map(name => setOf(name, ['Splash']))).dex;
        const trappers = dex.abilities.all().filter(ability => 'onFoeTrapPokemon' in ability || 'onTrapPokemon' in ability || 'onFoeMaybeTrapPokemon' in ability);
        expect(trappers.length).toBeGreaterThanOrEqual(3);
        const victims: Victim[] = [PLAIN, { species: 'Aron' }, { species: 'Gengar' }, { species: 'Skarmory' }, { species: 'Pikachu', item: 'Shed Shell' }];
        let refusals = 0;
        for (const ability of trappers) {
          for (const victim of victims) {
            const battle = play(format, victimSide, { source: { species: 'Dugtrio', ability: ability.name, moves: ['Splash'] }, victim, move: '' });
            expect(battle, `${ability.name} against ${victim.species}`).not.toBeNull();
            const picker = chipsTrapped(battle!, victimSide);
            const refused = simulatorRefusesSwitch(battle!, victimSide, format.doubles);
            expect(picker, `${ability.name} against ${victim.species}${victim.item ? ` with ${victim.item}` : ''}`).toBe(refused);
            if (refused) refusals++;
          }
        }
        expect(refusals).toBeGreaterThanOrEqual(3);
      });
    }
  }

  test('the reported scene: Magnet Pull holds a Steel type, and Execute would have failed', () => {
    const battle = play(FORMATS[0], 0, { source: { species: 'Magnezone', ability: 'Magnet Pull', moves: ['Splash'] }, victim: { species: 'Aron' }, move: '' })!;
    expect(chipsTrapped(battle, 0)).toBe(true);
    const resolved = resolveSideChoices(battle, 'p1', [{ kind: 'switch', speciesId: 'meowth', pokemonName: 'Meowth' }], [true]);
    expect(resolved.ok).toBe(false);
    if (!resolved.ok) expect(resolved.error).toMatch(/trapped/);
  });

  test('a pivot move stays available while the Pokémon is trapped', () => {
    const victim = [setOf('Aron', ['U-turn', 'Splash']), setOf('Meowth', ['Splash'])];
    const source = [setOf('Magnezone', ['Splash'], { ability: 'Magnet Pull' })];
    const battle = startBattle('gen9customgame', victim, source);
    battle.choose('p1', 'move Splash');
    battle.choose('p2', 'move Splash');
    expect(chipsTrapped(battle, 0)).toBe(true);
    const state = createBranchStateFromBattle(battle, [], {});
    expect(state.p1MovesBySlot[0].find(move => move.name === 'U-turn')?.disabled).toBe(false);
  });

  test('a forced replacement is never trapped: the chips are live on a switch request', () => {
    const victim = [setOf('Aron', ['Memento', 'Splash']), setOf('Meowth', ['Splash'])];
    const source = [setOf('Magnezone', ['Splash'], { ability: 'Magnet Pull' })];
    const battle = startBattle('gen9customgame', victim, source);
    battle.choose('p1', 'move Memento');
    battle.choose('p2', 'move Splash');
    expect(battle.sides[0].activeRequest?.forceSwitch).toEqual([true]);
    const state = createBranchStateFromBattle(battle, [], {});
    expect(state.p1SwitchesBySlot[0].every(chip => !chip.trapped)).toBe(true);
    expect(battle.choose('p1', 'switch 2')).toBe(true);
  });
});
