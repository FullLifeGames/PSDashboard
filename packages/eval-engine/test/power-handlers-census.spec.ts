import { test, expect, describe } from 'vitest';
import { Dex } from '@pkmn/sim';
import type { Battle, Pokemon } from '@pkmn/sim';
import { landedMove, POWER_MOVES } from '../src/score/move-facts';
import { set } from './move-oracle';
import { battleOf, fingerprint } from './power-oracle';

/**
 * Round 63 (T81): the static asks the simulator for a move's power at use,
 * but only the handlers listed in POWER_MOVES. This census keeps the list
 * honest: every power handler of the Dex (basePowerCallback, onBasePower,
 * damageCallback) in every generation the bank and the corpus play is
 * either asked or named below with the reason it stays out; every asked
 * handler leaves the battle as it was; and each asked move's memo class
 * covers what its answer reads.
 */

const EXCLUDED: Record<string, string> = {
  // The turn in progress: the queue, this turn's hits, the move that called it, the hit number.
  assurance: 'turn', avalanche: 'turn', revenge: 'turn', payback: 'turn', boltbeak: 'turn', fishiousrend: 'turn',
  pursuit: 'turn', round: 'turn', firepledge: 'turn', grasspledge: 'turn', waterpledge: 'turn',
  stompingtantrum: 'turn', temperflare: 'turn', lashout: 'turn', fusionbolt: 'turn', fusionflare: 'turn',
  beatup: 'turn', trumpcard: 'turn',
  // The hit number: asked once per hit by the multi-hit step (move-facts.ts hitsFactor, test/multi-hit.spec.ts).
  tripleaxel: 'per hit', triplekick: 'per hit',
  // Writes the battle, draws from the PRNG or writes the log.
  furycutter: 'writes', rollout: 'writes', iceball: 'writes', ficklebeam: 'writes', risingvoltage: 'writes',
  // Counters the rebuilt battle does not pin (volatile layers, a field counter, hits taken, faints so far).
  spitup: 'unpinned', echoedvoice: 'unpinned', ragefist: 'unpinned', lastrespects: 'unpinned', retaliate: 'unpinned',
  // Priced by a rule of the static: the halving moves and the level moves (fixedDamage), Tera Blast and
  // Hidden Power (move-use.ts); the reactive moves and Final Gambit read 0 by design; Psywave rolls.
  superfang: 'own', naturesmadness: 'own', ruination: 'own', terablast: 'own', hiddenpower: 'own',
  counter: 'own', mirrorcoat: 'own', metalburst: 'own', comeuppance: 'own', finalgambit: 'own', psywave: 'own',
  guardianofalola: 'own',
};

const GENS = [3, 4, 5, 6, 7, 8, 9];

function handlerIds(gen: number): string[] {
  return Dex.forGen(gen).moves.all()
    .filter(move => move.basePowerCallback || move.onBasePower || move.damageCallback)
    .map(move => move.id);
}

describe('power handlers of the Dex (round 63, T81)', () => {
  test.each(GENS)('gen %d: every move with a power handler is asked or excluded with a reason', gen => {
    const unknown = handlerIds(gen).filter(id => !POWER_MOVES.has(id) && !(id in EXCLUDED));
    expect(unknown).toEqual([]);
    const both = [...POWER_MOVES.keys()].filter(id => id in EXCLUDED);
    expect(both).toEqual([]);
  });

  test.each(GENS)('gen %d: asking every listed move leaves a debug-mode battle untouched, active and benched', gen => {
    const battle = battleOf(`gen${gen}customgame`,
      [set('Machamp', ['splash']), set('Snorlax', ['splash'])], [set('Snorlax', ['splash']), set('Machamp', ['splash'])]);
    const pairs: [Pokemon, Pokemon][] = [
      [battle.sides[0].active[0], battle.sides[1].active[0]],
      [battle.sides[0].pokemon[1], battle.sides[1].pokemon[1]],
    ];
    for (const [attacker, defender] of pairs) {
      for (const id of POWER_MOVES.keys()) {
        if (!battle.dex.moves.get(id).exists) continue;
        const before = fingerprint(battle, [attacker, defender], id);
        for (let i = 0; i < 50; i++) landedMove(attacker, defender, battle.dex.moves.get(id), battle);
        expect(fingerprint(battle, [attacker, defender], id), `gen ${gen} ${id}`).toBe(before);
      }
    }
  });

  test("each asked move's memo class covers what its answer reads", () => {
    // Facts a fork changes without touching pairKey; the memo class must cover every one that moves an answer.
    const live: [string, (battle: Battle, user: Pokemon, target: Pokemon) => void][] = [
      ['user HP', (_, user) => { user.hp = Math.floor(user.maxhp / 5); }],
      ['target HP', (_, __, target) => { target.hp = Math.floor(target.maxhp / 5); }],
      ['user burn', (_, user) => { user.setStatus('brn'); }],
      ['target poison', (_, __, target) => { target.setStatus('psn'); }],
      ['target paralysis', (_, __, target) => { target.setStatus('par'); }],
      ['target sleep', (_, __, target) => { target.setStatus('slp'); }],
      ['rain', battle => { battle.field.setWeather('raindance', 'debug'); }],
      ['sun', battle => { battle.field.setWeather('sunnyday', 'debug'); }],
      ['strong winds', battle => { battle.field.setWeather('deltastream', 'debug'); }],
      ['Psychic Terrain', battle => { battle.field.setTerrain('psychicterrain', 'debug'); }],
      ['Electric Terrain', battle => { battle.field.setTerrain('electricterrain', 'debug'); }],
      ['Misty Terrain', battle => { battle.field.setTerrain('mistyterrain', 'debug'); }],
      ['Gravity', battle => { battle.field.addPseudoWeather('gravity', 'debug'); }],
      ['target speed stage', (_, __, target) => { target.boosts.spe = 2; }],
      ['user speed stage', (_, user) => { user.boosts.spe = -2; }],
      ['Tailwind', (_, __, target) => { target.side.addSideCondition('tailwind', 'debug'); }],
      ['target weight', (_, __, target) => { target.weighthg = 1; }],
    ];
    const stages: [string, (battle: Battle, user: Pokemon, target: Pokemon) => void][] = [
      ['user stages', (_, user) => { Object.assign(user.boosts, { atk: 2, def: 2, spa: 2, spd: 2 }); }],
      ['target stages', (_, __, target) => { Object.assign(target.boosts, { atk: 2, def: 2, spa: 2, spd: 2 }); }],
    ];
    const misses: string[] = [];
    for (const [id, kind] of POWER_MOVES) {
      for (const targetSpecies of ['Garchomp', 'Dragonite']) {
        const answer = (change?: (battle: Battle, user: Pokemon, target: Pokemon) => void) => {
          const battle = battleOf('gen9customgame', [set('Kingambit', ['splash'])],
            [set(targetSpecies, ['splash'], { item: 'Leftovers', teraType: 'Fairy' })]);
          const [user, target] = [battle.sides[0].active[0], battle.sides[1].active[0]];
          change?.(battle, user, target);
          return JSON.stringify(landedMove(user, target, battle.dex.moves.get(id), battle));
        };
        const plain = answer();
        for (const [fact, change] of [...live, ...stages]) {
          const moved = answer(change) !== plain;
          const covered = (kind === 'live' && live.some(([name]) => name === fact)) ||
            (kind === 'stages' && (stages.some(([name]) => name === fact) || fact.endsWith('speed stage')));
          if (moved && !covered) misses.push(`${id} (${kind}) moves with ${fact} into ${targetSpecies}`);
        }
      }
    }
    expect(misses).toEqual([]);
  });
});
