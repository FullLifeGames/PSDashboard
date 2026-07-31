import { test, expect } from '@playwright/test';
import { Battle, State, Teams, toID } from '@pkmn/sim';
import type { PokemonSet } from '@pkmn/sim';
import {
  advancePosition, createRootPosition, legalChoices, positionBattle,
} from '../src/lib/eval/forward-model';
import { evaluatePosition } from '../src/lib/eval/eval-function';

function makeSet(name: string, species: string, moves: string[], level = 50): PokemonSet {
  return {
    name, species, item: '', ability: 'No Ability', moves,
    nature: 'Hardy',
    evs: { hp: 252, atk: 252, def: 0, spa: 0, spd: 4, spe: 0 },
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
    level, gender: '',
  };
}

function makeBattle(p1Sets: PokemonSet[], p2Sets: PokemonSet[]): Battle {
  const battle = new Battle({
    formatid: toID('gen9customgame'),
    seed: '1,2,3,4',
    p1: { name: 'Alpha', team: Teams.pack(p1Sets) },
    p2: { name: 'Beta', team: Teams.pack(p2Sets) },
  });
  // Custom Game opens at team preview — commit the default order so the
  // leads are actually on the field.
  if (battle.sides.some(side => side.requestState === 'teampreview')) {
    battle.choose('p1', 'team 1');
    battle.choose('p2', 'team 1');
  }
  return battle;
}

const serialize = (battle: Battle) => JSON.stringify(State.serializeBattle(battle));

test.describe('sim forward model', () => {
  test('legal choices mirror the request: moves, tera variants, switches', () => {
    const root = createRootPosition(serialize(makeBattle(
      [makeSet('Snorlax', 'Snorlax', ['Protect', 'Substitute']), makeSet('Chansey', 'Chansey', ['Protect'])],
      [makeSet('Pikachu', 'Pikachu', ['Protect'])],
    )));
    const p1 = legalChoices(root, 'p1');
    const p1Choices = p1.map(option => option.choice);
    expect(p1Choices).toContain('move protect');
    expect(p1Choices).toContain('move substitute');
    expect(p1Choices).toContain('switch 2');
    // gen 9: every request slot carries canTerastallize in Custom Game.
    expect(p1Choices).toContain('move protect terastallize');
    expect(p1.find(option => option.choice === 'switch 2')?.label).toBe('→ Chansey');
  });

  test('tera variants can be disabled', () => {
    const root = createRootPosition(serialize(makeBattle(
      [makeSet('Snorlax', 'Snorlax', ['Protect'])],
      [makeSet('Pikachu', 'Pikachu', ['Protect'])],
    )));
    const withTera = legalChoices(root, 'p1').map(option => option.choice);
    expect(withTera).toContain('move protect terastallize');
    const withoutTera = legalChoices(root, 'p1', { tera: false }).map(option => option.choice);
    expect(withoutTera).toContain('move protect');
    expect(withoutTera.some(choice => choice.includes('terastallize'))).toBe(false);
  });

  test('a fainted bench Pokémon never appears as a switch', () => {
    const battle = makeBattle(
      [makeSet('Snorlax', 'Snorlax', ['Protect']), makeSet('Chansey', 'Chansey', ['Protect'])],
      [makeSet('Pikachu', 'Pikachu', ['Protect'])],
    );
    const bench = battle.sides[0].pokemon[1];
    bench.hp = 0;
    bench.fainted = true;
    const root = createRootPosition(serialize(battle));
    expect(legalChoices(root, 'p1').map(option => option.choice)).not.toContain('switch 2');
  });

  test('advance resolves one full turn and leaves the parent untouched', () => {
    const root = createRootPosition(serialize(makeBattle(
      [makeSet('Snorlax', 'Snorlax', ['Protect', 'Substitute'])],
      [makeSet('Pikachu', 'Pikachu', ['Protect', 'Substitute'])],
    )));
    const child = advancePosition(root, 'move substitute', 'move substitute', '1,2,3,4');
    expect(positionBattle(child).turn).toBe(positionBattle(root).turn + 1);
    expect(positionBattle(root).turn).toBe(1); // parent unchanged
    expect(positionBattle(child).sides[0].active[0]!.volatiles['substitute']).toBeTruthy();
  });

  test('same seed ⇒ identical child, advancePosition is deterministic', () => {
    const root = createRootPosition(serialize(makeBattle(
      [makeSet('Kyurem', 'Kyurem', ['Draco Meteor'])],
      [makeSet('Snorlax', 'Snorlax', ['Protect', 'Substitute'])],
    )));
    const a = advancePosition(root, 'move dracometeor', 'move substitute', '1,2,3,4');
    const b = advancePosition(root, 'move dracometeor', 'move substitute', '1,2,3,4');
    expect(a.serialized).toBe(b.serialized);
  });

  test('a mid-turn KO auto-resolves the forced switch, avoiding a replacement that dies on entry', () => {
    // Explosion guarantees the p1 active faints. Pichu sits at 4% behind
    // Stealth Rock (12.5% entry chip) — sending it in would faint it, which
    // the greedy eval-trial must recognize, picking Blissey instead even
    // though Pichu comes first in slot order.
    const battle = makeBattle(
      [
        makeSet('Electrode', 'Electrode', ['Explosion']),
        makeSet('Pichu', 'Pichu', ['Protect']),
        makeSet('Blissey', 'Blissey', ['Protect']),
      ],
      [makeSet('Snorlax', 'Snorlax', ['Protect', 'Substitute'])],
    );
    battle.sides[0].addSideCondition('stealthrock', battle.sides[1].active[0]!);
    const pichu = battle.sides[0].pokemon[1];
    pichu.hp = Math.max(1, Math.floor(pichu.maxhp / 25));
    const root = createRootPosition(serialize(battle));

    const child = advancePosition(root, 'move explosion', 'move substitute', '1,2,3,4');
    const childBattle = positionBattle(child);
    expect(childBattle.turn).toBe(2); // back at a turn boundary
    expect(childBattle.sides[0].active[0]!.name).toBe('Blissey');
    // Only Electrode fainted — Pichu was spared the suicide entry.
    expect(childBattle.sides[0].pokemon.filter(pokemon => pokemon.fainted).map(pokemon => pokemon.name))
      .toEqual(['Electrode']);
  });

  test('a game-ending turn returns a terminal position', () => {
    const root = createRootPosition(serialize(makeBattle(
      [makeSet('Electrode', 'Electrode', ['Explosion'])],
      [makeSet('Snorlax', 'Snorlax', ['Protect', 'Substitute']), makeSet('Chansey', 'Chansey', ['Protect'])],
    )));
    const child = advancePosition(root, 'move explosion', 'move substitute', '1,2,3,4');
    expect(positionBattle(child).ended).toBe(true);
    expect(evaluatePosition(positionBattle(child))).toBe(-1); // p1 lost its only Pokémon
  });

  test('a rejected choice throws with the sim error text', () => {
    const root = createRootPosition(serialize(makeBattle(
      [makeSet('Snorlax', 'Snorlax', ['Protect'])],
      [makeSet('Pikachu', 'Pikachu', ['Protect'])],
    )));
    expect(() => advancePosition(root, 'move dracometeor', 'move protect', '1,2,3,4'))
      .toThrow(/dracometeor|doesn't have/i);
  });

  test('round-trip: a serialized mid-request battle keeps its open request', () => {
    const root = createRootPosition(serialize(makeBattle(
      [makeSet('Snorlax', 'Snorlax', ['Protect'])],
      [makeSet('Pikachu', 'Pikachu', ['Protect'])],
    )));
    const battle = positionBattle(root);
    expect(battle.sides[0].activeRequest).toBeTruthy();
    expect(legalChoices(root, 'p1').length).toBeGreaterThan(0);
    expect(legalChoices(root, 'p2').length).toBeGreaterThan(0);
  });
});
