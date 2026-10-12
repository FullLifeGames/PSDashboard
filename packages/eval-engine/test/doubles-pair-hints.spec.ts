import { test, expect, describe } from 'vitest';
import { State } from '@pkmn/sim';
import type { Battle, PokemonSet } from '@pkmn/sim';
import { createRootPosition } from '../src/forward-model';
import { combinedOptionHints, redirectsFoes, shieldsFromHits, singlesOptionHints } from '../src/search/hints';
import { boostedFraction, pairThreat, singleMoveFraction } from '../src/score/threat';
import { set } from './move-oracle';
import { battleOf } from './power-oracle';

/**
 * Round 69 (T42 part 1, decision 15): the doubles hints see the active pair.
 * Two attacks on one foe count more than the same attacks on two foes when
 * only the pair KOs; a redirection move is priced as the partner's damage it
 * covers; a Protect that denies the foes a KO only the pair can make carries a
 * tempo term. The orderings are held against the simulator: the same turns are
 * played there. Singles hints stay what they were (the terms live in the
 * combined path only).
 */

const FORMAT = 'gen9doublescustomgame';
const splash = (species: string, extra: Partial<PokemonSet> = {}) => set(species, ['splash'], extra);
const rootOf = (battle: Battle) => createRootPosition(JSON.stringify(State.serializeBattle(battle)));
const option = (choice: string) => ({ choice, label: choice });
const hintOf = (battle: Battle, side: 'p1' | 'p2', choice: string) => combinedOptionHints(rootOf(battle), side, [option(choice)])[0];
const SUPPORT_FLOOR = 0.25;
/** A move a battle can use: real, not a Max or Z move, not from a later game. */
const playable = (move: { exists: boolean; gen: number; isMax?: unknown; isZ?: unknown }) => move.exists && move.gen <= 9 && !move.isMax && !move.isZ;

/** Foe HP lost in one turn when p1 plays `p1Choice` against two Splashing foes. */
function damageOf(build: () => Battle, p1Choice: string, foe = 0): number {
  const battle = build();
  const mon = battle.sides[1].active[foe]!;
  const before = mon.hp;
  battle.choose('p1', p1Choice);
  battle.choose('p2', 'move 1, move 1');
  return before - mon.hp;
}

describe('pair focus: two slots on one foe (round 69, T42)', () => {
  const PIKACHU = () => set('Pikachu', ['splash', 'thunderbolt'], { ability: 'Static' });
  const foes = () => [splash('Snorlax'), splash('Snorlax')];
  const base = (foeHp?: number) => () => {
    const battle = battleOf(FORMAT, [PIKACHU(), PIKACHU()], foes());
    if (foeHp !== undefined) battle.sides[1].active[0]!.sethp(foeHp);
    return battle;
  };

  test('the premise, from the simulator: at the chosen HP only the pair KOs foe 1', () => {
    const hit = damageOf(base(), 'move 2 1, move 1');
    const hp = Math.floor(hit * 1.35);
    const faints = (choice: string) => {
      const battle = base(hp)();
      battle.choose('p1', choice);
      battle.choose('p2', 'move 1, move 1');
      return battle.sides[1].active[0]!.fainted;
    };
    expect(faints('move 2 1, move 1')).toBe(false);
    expect(faints('move 1, move 2 1')).toBe(false);
    expect(faints('move 2 1, move 2 1')).toBe(true);
    expect(faints('move 2 1, move 2 2')).toBe(false);
  });

  test('both aimed at foe 1 rank above the same two moves aimed at the two foes when only the pair KOs', () => {
    const hit = damageOf(base(), 'move 2 1, move 1');
    const hp = Math.floor(hit * 1.35);
    const battle = base(hp)();
    const same = hintOf(battle, 'p1', 'move thunderbolt 1, move thunderbolt 1');
    const split = hintOf(battle, 'p1', 'move thunderbolt 1, move thunderbolt 2');
    expect(same).toBeGreaterThan(split);
    // Each attack on its own is read as before: the split combo is the plain sum of its two fractions.
    const mon = battle.sides[0].active[0]!;
    const fraction = singleMoveFraction(mon, battle.sides[1].active[0]!, 'thunderbolt', battle);
    expect(split).toBeCloseTo(2 * fraction, 10);
  });

  test('no bonus at full HP (the pair does not KO) and none when one attack already KOs', () => {
    const full = base()();
    expect(hintOf(full, 'p1', 'move thunderbolt 1, move thunderbolt 1'))
      .toBeCloseTo(hintOf(full, 'p1', 'move thunderbolt 1, move thunderbolt 2'), 10);
    const low = base(1)();
    expect(hintOf(low, 'p1', 'move thunderbolt 1, move thunderbolt 1'))
      .toBeCloseTo(hintOf(low, 'p1', 'move thunderbolt 1, move thunderbolt 2'), 10);
  });

  test('the bonus is the same for either side (p2 aims two attacks at p1 slot 1)', () => {
    const hit = damageOf(base(), 'move 2 1, move 1');
    const battle = battleOf(FORMAT, [splash('Snorlax'), splash('Snorlax')], [PIKACHU(), PIKACHU()]);
    battle.sides[0].active[0]!.sethp(Math.floor(hit * 1.35));
    const same = hintOf(battle, 'p2', 'move thunderbolt 1, move thunderbolt 1');
    const split = hintOf(battle, 'p2', 'move thunderbolt 1, move thunderbolt 2');
    expect(same).toBeGreaterThan(split);
  });
});

/** The simulator's own answer to "does this move turn a foe's single-target hit away from the partner". */
function redirectedInSim(moveId: string): boolean {
  const build = () => battleOf(FORMAT,
    [set('Blissey', [moveId, 'splash'], { ability: 'No Ability' }), set('Blissey', ['splash'])],
    [set('Pikachu', ['tackle', 'splash']), set('Pikachu', ['splash'])]);
  const run = (foeChoice: string) => {
    const battle = build();
    battle.choose('p1', 'move 1, move 1');
    battle.choose('p2', `${foeChoice}, move 1`);
    const [user, partner] = battle.sides[0].active as [import('@pkmn/sim').Pokemon, import('@pkmn/sim').Pokemon];
    return { user: user.hp, partner: partner.hp, partnerMax: partner.maxhp };
  };
  const control = run('move 2');
  const aimed = run('move 1 2');
  return aimed.partner === aimed.partnerMax && aimed.user < control.user;
}

describe('redirection (round 69, T42)', () => {
  const CLEFAIRY = (move: string) => set('Clefairy', [move, 'splash'], { ability: 'Magic Guard' });
  const GARCHOMP = () => set('Garchomp', ['splash', 'dragonclaw'], { ability: 'Sand Veil' });
  const board = (move: string) => battleOf(FORMAT, [CLEFAIRY(move), GARCHOMP()], [splash('Pikachu'), splash('Pikachu')]);

  test.each(['followme', 'ragepowder'])('%s: the hint is the damage of the partner it covers, above the support floor', move => {
    const battle = board(move);
    const partner = hintOf(battle, 'p1', 'move splash, move dragonclaw 1') - SUPPORT_FLOOR;
    expect(partner).toBeGreaterThan(SUPPORT_FLOOR);
    const covered = hintOf(battle, 'p1', `move ${move}, move dragonclaw 1`) - partner;
    expect(covered).toBeCloseTo(partner, 10);
    expect(covered).toBeGreaterThan(SUPPORT_FLOOR);
    // Next to a partner with no damaging move it stays what any support move is.
    expect(hintOf(battle, 'p1', `move ${move}, move splash`)).toBeCloseTo(2 * SUPPORT_FLOOR, 10);
  });

  test('the simulator redirects exactly where the move says so (Dex sweep of the self-targeted moves)', () => {
    const dex = battleOf(FORMAT, [splash('Pikachu'), splash('Pikachu')], [splash('Pikachu'), splash('Pikachu')]).dex;
    const moves = dex.moves.all().filter(move => playable(move) && move.target === 'self' && !!move.volatileStatus);
    expect(moves.length).toBeGreaterThan(20);
    const claimed = moves.filter(move => redirectsFoes(dex, move));
    expect(claimed.map(move => move.id).sort()).toEqual(['followme', 'ragepowder']);
    for (const move of moves) {
      const seen = redirectedInSim(move.id);
      // Ally Switch lands the user in the partner's slot, a swap of places that the same probe sees as a hit on the user.
      if (move.id === 'allyswitch') continue;
      expect(`${move.id} ${seen}`).toBe(`${move.id} ${redirectsFoes(dex, move)}`);
    }
  });
});

/** Whether the simulator's Tackle from the foe is stopped by `moveId` on the user (the log's own "move: <name>" activation). */
function stopsHitInSim(moveId: string): boolean {
  const battle = battleOf(FORMAT,
    [set('Blissey', [moveId, 'splash']), set('Blissey', ['splash'])],
    [set('Pikachu', ['tackle', 'splash']), set('Pikachu', ['splash'])]);
  battle.choose('p1', 'move 1, move 1');
  battle.choose('p2', 'move 1 1, move 1');
  return battle.log.some(line => /^\|-activate\|p1a: .*\|move: /.test(line));
}

describe('Protect tempo and Fake Out (round 69, T42)', () => {
  test('the Dex sweep: the moves the code calls shields stop a Tackle in the simulator', () => {
    const dex = battleOf(FORMAT, [splash('Pikachu'), splash('Pikachu')], [splash('Pikachu'), splash('Pikachu')]).dex;
    const moves = dex.moves.all().filter(move => playable(move) && move.stallingMove && move.target === 'self');
    expect(moves.length).toBeGreaterThan(5);
    for (const move of moves) {
      // Endure only keeps the user at 1 HP when a hit would KO: a Tackle at full HP shows no activation.
      expect(`${move.id} ${stopsHitInSim(move.id)}`).toBe(`${move.id} ${shieldsFromHits(dex, move)}`);
    }
  });

  const GARCHOMP = () => set('Garchomp', ['splash', 'dragonclaw'], { ability: 'Sand Veil' });
  const build = (hp?: number) => () => {
    const battle = battleOf(FORMAT, [splash('Snorlax'), splash('Blissey')], [GARCHOMP(), GARCHOMP()]);
    if (hp !== undefined) battle.sides[0].active[0]!.sethp(hp);
    return battle;
  };

  test('a Protect that denies a KO only the pair can make outranks an idle slot; with no such threat it stays the floor', () => {
    const hit = (() => {
      const battle = build()();
      const mon = battle.sides[0].active[0]!;
      const before = mon.hp;
      battle.choose('p1', 'move 1, move 1');
      battle.choose('p2', 'move 2 1, move 1');
      return before - mon.hp;
    })();
    const hp = Math.floor(hit * 1.35);
    // From the simulator: both foes hit slot 1 and it faints; one alone does not.
    const turn = (p2: string) => {
      const battle = build(hp)();
      battle.choose('p1', 'move 1, move 1');
      battle.choose('p2', p2);
      return battle.sides[0].active[0]!.fainted;
    };
    expect(turn('move 2 1, move 2 1')).toBe(true);
    expect(turn('move 2 1, move 1')).toBe(false);
    expect(turn('move 1, move 2 1')).toBe(false);
    const protector = () => battleOf(FORMAT, [set('Snorlax', ['splash', 'protect']), splash('Blissey')], [GARCHOMP(), GARCHOMP()]);
    const threatened = protector();
    threatened.sides[0].active[0]!.sethp(hp);
    expect(hintOf(threatened, 'p1', 'move protect, move splash')).toBeGreaterThan(hintOf(threatened, 'p1', 'move splash, move splash'));
    const healthy = protector();
    expect(hintOf(healthy, 'p1', 'move protect, move splash')).toBeCloseTo(hintOf(healthy, 'p1', 'move splash, move splash'), 10);
  });

  test('Fake Out keeps its flinch bonus on the turn it works', () => {
    const battle = battleOf(FORMAT, [set('Incineroar', ['splash', 'fakeout']), splash('Blissey')], [splash('Pikachu'), splash('Pikachu')]);
    const mon = battle.sides[0].active[0]!;
    const fraction = singleMoveFraction(mon, battle.sides[1].active[0]!, 'fakeout', battle);
    const part = hintOf(battle, 'p1', 'move fakeout 1, move splash') - SUPPORT_FLOOR;
    expect(part).toBeCloseTo(fraction + 0.3, 10);
  });
});

describe('singles hints stay what they were (round 69, T42)', () => {
  test('moves are the damage fraction (status moves 0), switches the threat differential', () => {
    const battle = battleOf('gen9customgame',
      [set('Clefairy', ['followme', 'protect', 'moonblast', 'thunderbolt']), set('Garchomp', ['dragonclaw']), splash('Blissey')],
      [set('Pikachu', ['thunderbolt'])]);
    const position = rootOf(battle);
    const moves = ['followme', 'protect', 'moonblast', 'thunderbolt'].map(id => option(`move ${id}`));
    const switches = [option('switch 2'), option('switch 3')];
    const hints = singlesOptionHints(position, 'p1', [...moves, ...switches]);
    const [mon, foe] = [battle.sides[0].active[0]!, battle.sides[1].active[0]!];
    expect(hints.slice(0, 4)).toEqual(['followme', 'protect', 'moonblast', 'thunderbolt'].map(id => singleMoveFraction(mon, foe, id, battle)));
    expect(hints[0]).toBe(0);
    expect(hints[1]).toBe(0);
    [1, 2].forEach((index, at) => {
      const candidate = battle.sides[0].pokemon[index];
      expect(hints[4 + at]).toBeCloseTo(
        boostedFraction(pairThreat(candidate, foe, battle), candidate, foe) -
        boostedFraction(pairThreat(foe, candidate, battle), foe, candidate), 12);
    });
  });
});
