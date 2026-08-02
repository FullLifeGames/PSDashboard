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

function makeDoublesBattle(p1Sets: PokemonSet[], p2Sets: PokemonSet[]): Battle {
  const battle = new Battle({
    formatid: toID('gen9doublescustomgame'),
    seed: '1,2,3,4',
    p1: { name: 'Alpha', team: Teams.pack(p1Sets) },
    p2: { name: 'Beta', team: Teams.pack(p2Sets) },
  });
  if (battle.sides.some(side => side.requestState === 'teampreview')) {
    battle.choose('p1', `team ${p1Sets.map((_, index) => index + 1).join('')}`);
    battle.choose('p2', `team ${p2Sets.map((_, index) => index + 1).join('')}`);
  }
  return battle;
}

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
    // Wall-clock timestamp lines would break identity across second boundaries.
    expect(a.serialized).not.toContain('|t:|');
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

  test('leaf children are not serialized until the string is needed', () => {
    const root = createRootPosition(serialize(makeBattle(
      [makeSet('Snorlax', 'Snorlax', ['Protect', 'Substitute'])],
      [makeSet('Pikachu', 'Pikachu', ['Protect', 'Substitute'])],
    )));
    const original = State.serializeBattle;
    let calls = 0;
    State.serializeBattle = (battle: Parameters<typeof State.serializeBattle>[0]) => {
      calls += 1;
      return original.call(State, battle);
    };
    try {
      const child = advancePosition(root, 'move protect', 'move protect', '1,2,3,4');
      // The evaluation path (depth-1 leaves) must not pay for serialization.
      expect(calls).toBe(0);
      void child.serialized;
      expect(calls).toBe(1);
      void child.serialized;
      expect(calls).toBe(1); // cached after first access
    } finally {
      State.serializeBattle = original;
    }
  });

  test('a fainted active under a stale move request is repaired by auto-replacement', () => {
    // Snapshot corrections can faint an active without updating the request
    // (rare diverged reconstructions) — the sim then auto-passes the dead
    // slot and rejects every choice with "more choices than unfainted".
    const battle = makeBattle(
      [makeSet('Snorlax', 'Snorlax', ['Protect'])],
      [makeSet('Pikachu', 'Pikachu', ['Protect']), makeSet('Eevee', 'Eevee', ['Protect'])],
    );
    const active = battle.sides[1].active[0]!;
    active.hp = 0;
    active.fainted = true;
    const root = createRootPosition(serialize(battle));

    expect(positionBattle(root).sides[1].active[0]!.name).toBe('Eevee');
    expect(legalChoices(root, 'p2').map(option => option.choice)).toContain('move protect');
    const child = advancePosition(root, 'move protect', 'move protect', '1,2,3,4');
    expect(positionBattle(child).turn).toBe(positionBattle(root).turn + 1);
  });

  test('doubles: combined two-slot options with targets, spreads, tera, and switches', () => {
    const root = createRootPosition(serialize(makeDoublesBattle(
      [
        makeSet('Machamp', 'Machamp', ['Rock Slide', 'Karate Chop']),
        makeSet('Snorlax', 'Snorlax', ['Tackle']),
        makeSet('Chansey', 'Chansey', ['Protect']),
      ],
      [makeSet('Pikachu', 'Pikachu', ['Protect']), makeSet('Eevee', 'Eevee', ['Protect'])],
    )));
    const p1 = legalChoices(root, 'p1');
    const choices = p1.map(option => option.choice);
    // Single-target moves enumerate both living foe slots.
    expect(choices).toContain('move karatechop 1, move tackle 1');
    expect(choices).toContain('move karatechop 1, move tackle 2');
    // Spread moves take no target.
    expect(choices).toContain('move rockslide, move tackle 1');
    // Moves combine with switches in either slot.
    expect(choices).toContain('move karatechop 1, switch 3');
    expect(choices).toContain('switch 3, move tackle 1');
    // Both slots can never take the same bench target.
    expect(choices.some(choice => /switch 3.*switch 3/.test(choice))).toBe(false);
    // Tera on one slot or the other, never both at once.
    expect(choices).toContain('move karatechop 1 terastallize, move tackle 1');
    expect(choices).toContain('move karatechop 1, move tackle 1 terastallize');
    expect(choices.some(choice => (choice.match(/terastallize/g) ?? []).length > 1)).toBe(false);
    // Labels name the target so PVs stay readable.
    expect(p1.find(option => option.choice === 'move karatechop 2, move tackle 1')?.label)
      .toBe('Karate Chop→Eevee + Tackle→Pikachu');
  });

  test('doubles: a dead foe slot is never targeted; the shorthanded side chooses one slot', () => {
    const battle = makeDoublesBattle(
      [
        makeSet('Machamp', 'Machamp', ['Karate Chop']),
        makeSet('Snorlax', 'Snorlax', ['Tackle']),
      ],
      [makeSet('Pikachu', 'Pikachu', ['Protect']), makeSet('Eevee', 'Eevee', ['Protect'])],
    );
    // Eevee is down with no bench behind it — the slot stays empty.
    const eevee = battle.sides[1].active[1]!;
    eevee.hp = 0;
    eevee.faint();
    battle.faintMessages();
    const root = createRootPosition(serialize(battle));
    const p1Choices = legalChoices(root, 'p1').map(option => option.choice);
    expect(p1Choices).toContain('move karatechop 1, move tackle 1');
    expect(p1Choices.some(choice => choice.includes('karatechop 2'))).toBe(false);
    // The shorthanded side issues a plain one-slot choice for its living slot.
    expect(legalChoices(root, 'p2').map(option => option.choice)).toContain('move protect');
  });

  test('mega evolution variants appear when the stone allows it', () => {
    const battle = new Battle({
      formatid: toID('gen7customgame'),
      seed: '1,2,3,4',
      p1: { name: 'Alpha', team: Teams.pack([{ ...makeSet('Charizard', 'Charizard', ['Flamethrower']), item: 'Charizardite X' }]) },
      p2: { name: 'Beta', team: Teams.pack([makeSet('Snorlax', 'Snorlax', ['Protect'])]) },
    });
    if (battle.sides.some(side => side.requestState === 'teampreview')) {
      battle.choose('p1', 'team 1');
      battle.choose('p2', 'team 1');
    }
    const p1 = legalChoices(createRootPosition(serialize(battle)), 'p1');
    const mega = p1.find(option => option.choice === 'move flamethrower mega');
    expect(mega?.label).toBe('Mega + Flamethrower');
  });

  test('doubles: only one slot may Mega Evolve in the same turn', () => {
    const battle = new Battle({
      formatid: toID('gen7doublescustomgame'),
      seed: '1,2,3,4',
      p1: {
        name: 'Alpha',
        team: Teams.pack([
          { ...makeSet('Charizard', 'Charizard', ['Flamethrower']), item: 'Charizardite X' },
          { ...makeSet('Gyarados', 'Gyarados', ['Waterfall']), item: 'Gyaradosite' },
        ]),
      },
      p2: {
        name: 'Beta',
        team: Teams.pack([makeSet('Snorlax', 'Snorlax', ['Protect']), makeSet('Chansey', 'Chansey', ['Protect'])]),
      },
    });
    if (battle.sides.some(side => side.requestState === 'teampreview')) {
      battle.choose('p1', 'team 12');
      battle.choose('p2', 'team 12');
    }
    const choices = legalChoices(createRootPosition(serialize(battle)), 'p1').map(option => option.choice);
    expect(choices.some(choice => /move flamethrower(?: \d)? mega/.test(choice))).toBe(true);
    expect(choices.some(choice => /move waterfall(?: \d)? mega/.test(choice))).toBe(true);
    expect(choices.some(choice => (choice.match(/ mega\b/g) ?? []).length > 1)).toBe(false);
  });

  test('doubles: advance accepts combined choices and resolves the turn', () => {
    const root = createRootPosition(serialize(makeDoublesBattle(
      [
        makeSet('Machamp', 'Machamp', ['Rock Slide', 'Karate Chop']),
        makeSet('Snorlax', 'Snorlax', ['Tackle']),
      ],
      [makeSet('Pikachu', 'Pikachu', ['Protect']), makeSet('Eevee', 'Eevee', ['Protect'])],
    )));
    const child = advancePosition(root, 'move rockslide, move tackle 1', 'move protect, move protect', '1,2,3,4');
    expect(positionBattle(child).turn).toBe(positionBattle(root).turn + 1);
  });

  test('doubles: a double KO resolves both forced switches with distinct replacements', () => {
    const root = createRootPosition(serialize(makeDoublesBattle(
      [
        makeSet('Electrode', 'Electrode', ['Explosion']),
        makeSet('Voltorb', 'Voltorb', ['Explosion']),
        makeSet('Chansey', 'Chansey', ['Protect']),
        makeSet('Blissey', 'Blissey', ['Protect']),
      ],
      [
        makeSet('Registeel', 'Registeel', ['Protect']),
        makeSet('Regirock', 'Regirock', ['Protect']),
      ],
    )));
    const child = advancePosition(root, 'move explosion, move explosion', 'move protect, move protect', '1,2,3,4');
    const childBattle = positionBattle(child);
    expect(childBattle.turn).toBe(2);
    const names = childBattle.sides[0].active.map(active => active?.name).sort();
    expect(names).toEqual(['Blissey', 'Chansey']);
  });

  test('doubles: a fainted slot under a stale move request is repaired', () => {
    const battle = makeDoublesBattle(
      [
        makeSet('Machamp', 'Machamp', ['Karate Chop']),
        makeSet('Snorlax', 'Snorlax', ['Tackle']),
        makeSet('Chansey', 'Chansey', ['Protect']),
      ],
      [makeSet('Registeel', 'Registeel', ['Protect']), makeSet('Regirock', 'Regirock', ['Protect'])],
    );
    const snorlax = battle.sides[0].active[1]!;
    snorlax.hp = 0;
    snorlax.fainted = true;
    const root = createRootPosition(serialize(battle));
    expect(positionBattle(root).sides[0].active[1]!.name).toBe('Chansey');
    const child = advancePosition(root, 'move karatechop 1, move protect', 'move protect, move protect', '1,2,3,4');
    expect(positionBattle(child).turn).toBe(positionBattle(root).turn + 1);
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
