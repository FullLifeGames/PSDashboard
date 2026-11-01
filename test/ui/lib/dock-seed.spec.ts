import { describe, expect, test } from 'vitest';
import { Battle, Teams, toID, type PokemonSet } from '@pkmn/sim';
import {
  createBranchStateFromBattle, requiredChoicesForActiveSlots, resolveSideChoices, type BranchSimState, type BranchSlotChoice,
} from '@fulllifegames/eval-engine';
import { mergeChoices, seedChoices } from '../../../src/lib/dock-seed';
import type { PlayedAtPosition, PlayedPick } from '../../../src/lib/played-pick';
import { NO_MODIFIERS, simState } from '../fixtures/sim-state';

/**
 * Round 84 (turn dock), lane A, step A2: the seed of the dock. Each slot starts with the choice the viewed line played, but only
 * a choice the picker offers: a move that is listed and enabled, a bench Pokémon that is alive, a target the move lists and a
 * gimmick the slot has. What the picker lacks leaves the slot empty with the played pick kept for the chip's note.
 */

const move = (name: string, extra: Partial<PlayedPick> = {}): PlayedPick => ({ kind: 'move', name, ...extra });
const doublesAt = (p1: (PlayedPick | null)[], p2: (PlayedPick | null)[] = [null, null]): PlayedAtPosition => (
  { p1: p1.find(Boolean) ?? null, p2: p2.find(Boolean) ?? null, p1Slots: p1, p2Slots: p2 });

describe('seedChoices, doubles', () => {
  const state = simState('doubles');

  test('a listed move seeds as the choice the picker builds for it, with a target the move lists', () => {
    const seed = seedChoices(doublesAt([move('Flare Blitz', { targetLoc: 2 }), move('Spore', { targetLoc: 1 })]), state);
    expect(seed.p1[0]).toEqual({
      choice: { kind: 'move', moveId: 'flareblitz', moveName: 'Flare Blitz', targetLoc: 2 }, played: move('Flare Blitz', { targetLoc: 2 }),
    });
    expect(seed.p1[1].choice).toEqual({ kind: 'move', moveId: 'spore', moveName: 'Spore', targetLoc: 1 });
  });

  test('a move that takes no target seeds without one, whatever the log named (C3)', () => {
    // Protect lists no targets in the fixture; the log names the first foe for a spread move too.
    expect(seedChoices(doublesAt([move('Protect', { targetLoc: 1 }), null]), state).p1[0].choice)
      .toEqual({ kind: 'move', moveId: 'protect', moveName: 'Protect' });
  });

  test('a target the move does not list is dropped, and null is no target', () => {
    const seed = seedChoices(doublesAt([move('Flare Blitz', { targetLoc: -1 }), move('Spore', { targetLoc: null })]), state);
    expect(seed.p1.map(slot => slot.choice)).toEqual([
      { kind: 'move', moveId: 'flareblitz', moveName: 'Flare Blitz' },
      { kind: 'move', moveId: 'spore', moveName: 'Spore' },
    ]);
  });

  test('a gimmick seeds only where the slot offers it', () => {
    const withTera = simState('doubles', {
      p1ModifiersBySlot: [{ ...NO_MODIFIERS, teraType: 'Fire' }, { ...NO_MODIFIERS }],
    });
    const played = doublesAt([move('Flare Blitz', { modifier: 'terastallize' }), move('Spore', { modifier: 'terastallize' })]);
    const seed = seedChoices(played, withTera);
    expect(seed.p1[0].choice).toMatchObject({ modifier: 'terastallize' });
    expect(seed.p1[1].choice).not.toHaveProperty('modifier');
    expect(seedChoices(played, state).p1[0].choice).not.toHaveProperty('modifier');
  });

  test('a played move the picker lacks, or lists disabled, leaves the slot empty and keeps the played pick', () => {
    const disabled = simState('doubles');
    disabled.p1MovesBySlot[0] = disabled.p1MovesBySlot[0].map(option => (option.name === 'Fake Out' ? { ...option, disabled: true } : option));
    const played = doublesAt([move('Fake Out', { targetLoc: 1 }), move('Moonblast', { targetLoc: 1 })], [move('Wood Hammer', { targetLoc: 1 }), null]);
    const seed = seedChoices(played, disabled);
    expect(seed.p1[0]).toEqual({ choice: null, played: played.p1Slots![0] });
    expect(seed.p1[1]).toEqual({ choice: null, played: played.p1Slots![1] });
    expect(seed.p2[0].choice).toMatchObject({ moveName: 'Wood Hammer' });
  });

  test('a switch seeds by species or nickname, never a fainted body or one off the bench', () => {
    const fainted = simState('doubles');
    fainted.p1SwitchesBySlot[1] = fainted.p1SwitchesBySlot[1].map(option => (option.species === 'Urshifu' ? { ...option, fainted: true } : option));
    const played = doublesAt([
      { kind: 'switch', name: 'Flutter Mane', species: 'Flutter Mane' },
      { kind: 'switch', name: 'Urshifu', species: 'Urshifu' },
    ], [{ kind: 'switch', name: 'Kingambit', species: 'Kingambit' }, { kind: 'switch', name: 'Garchomp', species: 'Garchomp' }]);
    const seed = seedChoices(played, fainted);
    expect(seed.p1[0].choice).toEqual({ kind: 'switch', speciesId: 'fluttermane', pokemonName: 'Flutter Mane' });
    expect(seed.p1[1].choice).toBeNull();
    expect(seed.p2[0].choice).toEqual({ kind: 'switch', speciesId: 'kingambit', pokemonName: 'Kingambit' });
    expect(seed.p2[1]).toEqual({ choice: null, played: played.p2Slots![1] });
  });

  test('a slot with no logged action starts empty (C2)', () => {
    const seed = seedChoices(doublesAt([move('Flare Blitz'), null]), state);
    expect(seed.p1[1]).toEqual({ choice: null, played: null });
    expect(seed.p2).toEqual([{ choice: null, played: null }, { choice: null, played: null }]);
  });

  test('a side with a forced replacement seeds nothing: the pick is the user\'s', () => {
    const forced = simState('doubles', { p1ForceSwitch: true, p1ForceSwitches: [true, false] });
    expect(seedChoices(doublesAt([move('Flare Blitz'), move('Spore')]), forced).p1.map(slot => slot.choice)).toEqual([null, null]);
  });

  test('behind the tip, the recorded choice is the seed after the same validation, dice included', () => {
    const dice = [{ kind: 'flinch', who: 'rillaboom.0' }] as never;
    const recorded: BranchSlotChoice = { kind: 'move', moveId: 'flareblitz', moveName: 'Flare Blitz', targetLoc: 2, dice };
    const stale: BranchSlotChoice = { kind: 'move', moveId: 'moonblast', moveName: 'Moonblast', targetLoc: 1 };
    const played = doublesAt([move('Flare Blitz', { recorded }), move('Moonblast', { recorded: stale })]);
    const seed = seedChoices(played, state);
    expect(seed.p1[0].choice).toEqual(recorded);
    expect(seed.p1[1]).toEqual({ choice: null, played: played.p1Slots![1] });
  });

  test('no played record seeds nothing, also from a state that lacks the pickers', () => {
    expect(seedChoices(null, state)).toEqual({ p1: [], p2: [] });
    expect(seedChoices(null, {} as BranchSimState)).toEqual({ p1: [], p2: [] });
  });
});

describe('seedChoices, singles', () => {
  const state = simState('singles');

  test('the side pick seeds slot A; singles name no target', () => {
    const played: PlayedAtPosition = { p1: move('Earthquake', { modifier: 'terastallize' }), p2: { kind: 'switch', name: 'Keldeo', species: 'Keldeo' } };
    const seed = seedChoices(played, simState('singles', { p1ModifiersBySlot: [{ ...NO_MODIFIERS, teraType: 'Ground' }] }));
    expect(seed.p1).toHaveLength(1);
    expect(seed.p1[0].choice).toEqual({ kind: 'move', moveId: 'earthquake', moveName: 'Earthquake', modifier: 'terastallize' });
    expect(seed.p2[0].choice).toEqual({ kind: 'switch', speciesId: 'keldeo', pokemonName: 'Keldeo' });
    expect(seedChoices({ p1: move('Surf'), p2: null }, state).p1[0]).toEqual({ choice: null, played: move('Surf') });
  });
});

describe('mergeChoices', () => {
  const state = simState('doubles');
  const seed = seedChoices(doublesAt([move('Flare Blitz', { targetLoc: 1 }), move('Spore', { targetLoc: 2 })]), state);
  const mine: BranchSlotChoice = { kind: 'move', moveId: 'protect', moveName: 'Protect' };

  test('a touched slot keeps the draft, an untouched one the seed', () => {
    const merged = mergeChoices(seed, { p1: [null, mine], p2: [] });
    expect(merged.p1[0]).toMatchObject({ moveName: 'Flare Blitz' });
    expect(merged.p1[1]).toBe(mine);
    expect(merged.p2).toEqual([null, null]);
  });

  test('without a seeded choice the draft stands as it is', () => {
    const draft = { p1: [mine], p2: [] };
    expect(mergeChoices(seedChoices(null, state), draft)).toBe(draft);
  });
});

/**
 * C3 against the simulator: a spread move takes no target. The log names the first foe for Rock Slide, and a choice that carried
 * it would show a target the move does not take; the seed drops it, so the command the dock sends is one the simulator takes.
 */
describe('a spread move run through resolveSideChoices and the simulator', () => {
  const STATS = { hp: 0, atk: 252, def: 0, spa: 252, spd: 0, spe: 0 };
  const set = (species: string, moves: string[]): PokemonSet => ({
    name: species, species, item: '', ability: 'No Ability', moves, nature: 'Hardy', evs: STATS,
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }, level: 50, gender: '',
  });
  const make = () => {
    const battle = new Battle({
      formatid: toID('gen9doublescustomgame'), seed: '1,2,3,4',
      p1: { name: 'Alpha', team: Teams.pack([set('Greninja', ['Rock Slide', 'Surf']), set('Conkeldurr', ['Drain Punch', 'Bulk Up'])]) },
      p2: { name: 'Beta', team: Teams.pack([set('Snorlax', ['Splash']), set('Blissey', ['Splash'])]) },
    });
    if (battle.sides.some(side => side.requestState === 'teampreview')) {
      battle.choose('p1', 'team 12');
      battle.choose('p2', 'team 12');
    }
    return battle;
  };

  test('the seeded Rock Slide carries no target, resolves and the simulator takes it', () => {
    const battle = make();
    const state = createBranchStateFromBattle(battle as never, [], {});
    const rockSlide = state.p1MovesBySlot[0].find(option => option.name === 'Rock Slide')!;
    expect(rockSlide.targetOptions).toEqual([]);
    const played = doublesAt([move('Rock Slide', { targetLoc: 1 }), move('Drain Punch', { targetLoc: 2 })]);
    const seeded = seedChoices(played, state).p1.map(slot => slot.choice);
    expect(seeded[0]).toEqual({ kind: 'move', moveId: 'rockslide', moveName: 'Rock Slide' });
    expect(seeded[1]).toMatchObject({ moveName: 'Drain Punch', targetLoc: 2 });
    const required = requiredChoicesForActiveSlots(state.p1ActiveSlots, state.p1ForceSwitches);
    const resolved = resolveSideChoices(battle as never, 'p1', seeded, required);
    expect(resolved.ok).toBe(true);
    if (resolved.ok) expect(make().choose('p1', resolved.command), resolved.command).toBe(true);

    // The executor drops a target the move does not take (shouldAppendTargetLoc), so the stray loc would have cost nothing at
    // Execute; the simulator itself refuses it, and the chip would have shown "→ P2A" for a move that hits both foes.
    const withTarget: BranchSlotChoice[] = [{ ...seeded[0]!, targetLoc: 1 } as BranchSlotChoice, seeded[1]!];
    const stray = resolveSideChoices(battle as never, 'p1', withTarget, required);
    expect(stray.ok && resolved.ok && stray.command).toBe(resolved.ok && resolved.command);
    expect(make().choose('p1', 'move 1 1, move 1 2')).toBe(false);
  });
});
