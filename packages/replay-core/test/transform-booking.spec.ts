import { describe, expect, test } from 'vitest';
import { Battle, Teams, toID, type PokemonSet } from '@pkmn/sim';
import { inferOpponentTeam } from '../src/opponent-inferrer';

/**
 * Round 89 (#139): a body under Transform uses the moves of its target, so a move line of the copy shows that the target knows the
 * move. It works like a student who copies a neighbor's answers: when the teacher sees an answer on the copy, it belongs in the
 * neighbor's file. The inference dropped such a line; the built target lacked the move and the rebuilt copy could not play it (the
 * simulator refused the choice). Every log comes from @pkmn/sim. The sweep over every Dex entry that transforms a body, in every
 * generation and mod, is `transform-booking-sweep.spec.ts`; the corpus rows are `test/regression/transform-booking-corpus.spec.ts`.
 */

function set(species: string, ability: string, moves: string[]): PokemonSet {
  return {
    name: species, species, item: '', ability, moves, nature: 'Hardy', level: 100, gender: '',
    evs: { hp: 252, atk: 0, def: 252, spa: 0, spd: 4, spe: 0 }, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
  };
}

function play(format: 'gen9ou' | 'gen9doublesou', p1: PokemonSet[], p2: PokemonSet[], turns: [string, string][]): string {
  const battle = new Battle({
    formatid: toID(format), seed: [1, 2, 3, 4], p1: { name: 'Alpha', team: Teams.pack(p1) }, p2: { name: 'Beta', team: Teams.pack(p2) },
  });
  if (battle.requestState === 'teampreview') { battle.choose('p1', 'default'); battle.choose('p2', 'default'); }
  for (const [first, second] of turns) {
    battle.choose('p1', first);
    battle.choose('p2', second);
  }
  return battle.log.filter((line, index) => !line.startsWith('|split|') && !battle.log[index - 1]?.startsWith('|split|')).join('\n');
}

const movesOf = (log: string, side: 'p1' | 'p2', species: string) => inferOpponentTeam(log, side).pokemon.find(entry => entry.species === species)?.moves.map(move => move.name).sort() ?? [];
const bench = () => set('Blissey', 'Natural Cure', ['Soft-Boiled', 'Protect']);

describe('a transformed body books its moves to the body it copied', () => {
  const garchomp = () => set('Garchomp', 'Rough Skin', ['Earthquake', 'Swords Dance', 'Protect', 'Dragon Claw']);

  test('singles: an Imposter Ditto uses Earthquake and Swords Dance; the inference of the target holds both, the copy none', () => {
    const ditto = set('Ditto', 'Imposter', ['Transform']);
    const log = play('gen9ou', [ditto, bench()], [garchomp(), bench()], [['move earthquake', 'move swordsdance'], ['move swordsdance', 'move swordsdance']]);
    expect(log).toMatch(/\|-transform\|p1a: Ditto\|p2a: Garchomp\|\[from\] ability: Imposter/);
    expect(log).toMatch(/\|move\|p1a: Ditto\|Earthquake/);
    expect(movesOf(log, 'p2', 'Garchomp')).toEqual(['Earthquake', 'Swords Dance']);
    // The copy's own side shows no copied move on the copy, and the inference of p1 never sees the foe's Garchomp as its own.
    expect(movesOf(log, 'p1', 'Ditto')).toEqual([]);
  });

  test('singles: the Transform move books Transform on the Ditto and the copy\'s moves on the target', () => {
    const ditto = set('Ditto', 'Limber', ['Transform']);
    const log = play('gen9ou', [ditto, bench()], [garchomp(), bench()], [['move transform', 'move protect'], ['move dragonclaw', 'move swordsdance']]);
    expect(log).toMatch(/\|move\|p1a: Ditto\|Transform\|p2a: Garchomp/);
    expect(movesOf(log, 'p1', 'Ditto')).toEqual(['Transform']);
    expect(movesOf(log, 'p2', 'Garchomp')).toEqual(['Dragon Claw', 'Protect', 'Swords Dance']);
  });

  test('doubles: a copy of the foe across Protects; the foe holds Protect, the other foe none of it', () => {
    const dragonite = set('Dragonite', 'Multiscale', ['Protect', 'Extreme Speed']);
    const ditto = set('Ditto', 'Imposter', ['Transform']);
    const log = play('gen9doublesou', [ditto, bench(), set('Chansey', 'Natural Cure', ['Soft-Boiled'])], [bench(), dragonite, set('Chansey', 'Natural Cure', ['Soft-Boiled'])],
      [['move protect, move softboiled', 'move softboiled, move extremespeed 1']]);
    expect(log).toMatch(/\|-transform\|p1a: Ditto\|p2b: Dragonite\|\[from\] ability: Imposter/);
    expect(log).toMatch(/\|move\|p1a: Ditto\|Protect\|p1a: Ditto/);
    expect(movesOf(log, 'p2', 'Dragonite')).toEqual(['Extreme Speed', 'Protect']);
    expect(movesOf(log, 'p2', 'Blissey')).toEqual(['Soft-Boiled']);
    expect(movesOf(log, 'p1', 'Ditto')).toEqual([]);
  });

  test('doubles: a copy of the partner books on the partner (a same-side Transform)', () => {
    const ditto = set('Ditto', 'Limber', ['Transform']);
    const log = play('gen9doublesou', [ditto, garchomp(), bench()], [bench(), set('Chansey', 'Natural Cure', ['Soft-Boiled']), bench()],
      [['move transform -2, move protect', 'move softboiled, move softboiled'], ['move earthquake, move protect', 'move softboiled, move softboiled']]);
    expect(log).toMatch(/\|-transform\|p1a: Ditto\|p1b: Garchomp/);
    expect(log).toMatch(/\|move\|p1a: Ditto\|Earthquake/);
    expect(movesOf(log, 'p1', 'Garchomp')).toEqual(['Earthquake', 'Protect']);
    expect(movesOf(log, 'p1', 'Ditto')).toEqual(['Transform']);
  });

  test('Struggle by a copy is no move of the target', () => {
    const lowPp = set('Ditto', 'Imposter', ['Transform']);
    const target = set('Garchomp', 'Rough Skin', ['Splash']);
    const turns: [string, string][] = Array.from({ length: 12 }, () => ['move 1', 'move 1']);
    const log = play('gen9ou', [lowPp, bench()], [target, bench()], turns);
    expect(log).toMatch(/\|move\|p1a: Ditto\|Struggle/);
    expect(movesOf(log, 'p2', 'Garchomp')).toEqual(['Splash']);
  });
});
