import { describe, expect, test } from 'vitest';
import type { Battle, PokemonSet } from '@pkmn/sim';
import { loadSimMods } from '../src/forward/sim-mods';
import { pairThreat, unansweredMons } from '../src/eval-function';
import { set } from './move-oracle';
import { battleOf } from './power-oracle';

/**
 * Round 79 (T283): the first mover takes a finite race tie only when its own hit finishes the foe. 573756 turn 71: the
 * profile let Magnezone "win" Landorus-Therian, because both sides needed one turn and Magnezone is faster, but its
 * Flash Cannon left Lando-T on 5 % and only the Toxic tick would finish it: the tick comes after the moves, so Lando-T
 * still plays its Earthquake first. Held against the simulator for every residual status (burn, poison, Toxic) in the rule
 * sets the corpus plays: the slower foe moves before the tick takes it, and the profile reads the same board both ways.
 */

await loadSimMods('gen9championsou');

// Round 79 (T283 sweep): every generation the profile reads (boundaryEvent returns nothing for generations 1 and 2) and the Champions mod.
const RULES = [
  { name: 'Generation 3', format: 'gen3customgame' },
  { name: 'Generation 4', format: 'gen4customgame' },
  { name: 'Generation 5', format: 'gen5customgame' },
  { name: 'Generation 6', format: 'gen6customgame' },
  { name: 'Generation 7', format: 'gen7customgame' },
  { name: 'Generation 8', format: 'gen8customgame' },
  { name: 'Scarlet/Violet', format: 'gen9customgame' },
  { name: 'Pokémon Champions', format: 'gen9championscustomgame' },
];
const STATUSES = ['brn', 'psn', 'tox'] as const;

describe.each(RULES)('$name: a finite tie by a status tick (T283)', rules => {
  // Seismic Toss deals the attacker's level (100) whatever the foe's stats: the hit is exact.
  const board = (status: (typeof STATUSES)[number], foeHp: number, bench: PokemonSet[] = []): Battle => {
    const battle = battleOf(rules.format,
      [set('Jolteon', ['seismictoss'], { level: 100 }), ...bench],
      [set('Swampert', ['earthquake'], { level: 100 })]);
    const attacker = battle.sides[0].active[0]!;
    const foe = battle.sides[1].active[0]!;
    attacker.sethp(1);
    foe.setStatus(status);
    foe.sethp(foeHp);
    return battle;
  };

  test.each(STATUSES)('%s: the simulator lets the slower foe act before its tick takes it', status => {
    // A bench keeps the game going when the Earthquake takes the attacker: the end of turn then still runs.
    const battle = board(status, 110, [set('Blissey', ['splash'], { level: 100 })]);
    battle.choose('p1', 'move 1');
    battle.choose('p2', 'move 1');
    // Generation 3 asks for the replacement before the end of the turn: answer it, the tick comes after.
    if (!battle.log.some(line => line.startsWith('|faint|p2a'))) battle.choose('p1', 'switch 2');
    const log = battle.log;
    const foeMoved = log.findIndex(line => line.startsWith('|move|p2a'));
    const foeFell = log.findIndex(line => line.startsWith('|faint|p2a'));
    expect(foeMoved).toBeGreaterThan(-1);
    expect(foeFell).toBeGreaterThan(foeMoved);
  });

  test.each(STATUSES)('%s: a hit that leaves the foe on the tick is no won pair, a hit that finishes it is', status => {
    const left = unansweredMons(board(status, 110));
    expect(left.decided?.side).not.toBe('p1');
    expect(left.p1).toEqual([]);
    const finished = unansweredMons(board(status, 90));
    expect(finished.p1).toEqual(['Jolteon']);
    expect(finished.decided?.side).toBe('p1');
  });
});

describe('573756 turn 71: Magnezone against the poisoned Landorus-Therian (T283)', () => {
  const board = (tickGap: number): Battle => {
    const battle = battleOf('gen8customgame',
      [set('Magnezone', ['flashcannon', 'thunderbolt'], { level: 100, item: 'choicescarf' })],
      [set('Landorus-Therian', ['earthquake'], { level: 100 })]);
    const foe = battle.sides[1].active[0]!;
    const hit = Math.round(pairThreat(battle.sides[0].active[0]!, foe, battle).special * foe.maxhp);
    foe.setStatus('tox');
    foe.sethp(hit + tickGap);
    return battle;
  };

  test('a Flash Cannon that leaves the foe a few HP is no clean-up; one that finishes it is', () => {
    const left = unansweredMons(board(3));
    expect(left.p1).toEqual([]);
    expect(left.decided?.side).not.toBe('p1');
    expect(unansweredMons(board(-3)).p1).toEqual(['Magnezone']);
  });
});
