import { describe, expect, test } from 'vitest';
import { rollsStall } from '../src/dex-facts/protect';
import { loadSimMods } from '../src/forward/sim-mods';
import type { Battle } from '@pkmn/sim';
import { mon, playClicks, seedOf, type Mode, type Rules } from './dice-fixtures';
import { dexOfRules, SWEEP_CASES, sweepMoves } from './dice-sweep-support';
import { battleOf } from './power-oracle';
import { delayBoard, foeClick, ownClick, proofOf, strikeOf } from './forced-win-delay-support';

// `DICE_SWEEPS=full` plays every stalling move of a rule set; a plain run plays the sample of `sweepSelection`.
await loadSimMods('gen9championsou');

const WITH_STALL = SWEEP_CASES.filter(({ rules }) => rules.generation >= 2);
const SEEDS = 300;
const TURNS = 12;

const has = (rules: Rules, ids: string[]): boolean => ids.every(id => dexOfRules(rules).moves.get(id).exists || dexOfRules(rules).items.get(id).exists);

function winRate(build: (seed: string) => Battle, own: string, foe: string): number {
  let wins = 0;
  for (let index = 0; index < SEEDS; index++) {
    const battle = build(seedOf(index));
    for (let turn = 0; turn < TURNS && !battle.ended; turn++) {
      try {
        playClicks(battle, { p1: own, p2: foe });
      } catch {
        break;
      }
    }
    if (battle.ended && battle.winner === battle.sides[0].name) wins++;
  }
  return wins / SEEDS;
}

interface Kind {
  name: string;
  needs: string[];
  stall: string;
  attack: string;
  build(rules: Rules, mode: Mode, seed: string): Battle;
}

const KINDS: Kind[] = [
  { name: 'a heal at the end of the turn (Leftovers)', needs: ['protect', 'tackle', 'leftovers'], stall: 'protect', attack: 'tackle', build: (rules, mode, seed) => delayBoard(rules, mode, 'tackle', { stall: 'protect', foeItem: 'leftovers' }, seed) },
  {
    name: 'a poisoned attacker', needs: ['protect', 'tackle'], stall: 'protect', attack: 'tackle',
    build: (rules, mode, seed) => {
      const battle = delayBoard(rules, mode, 'tackle', { stall: 'protect' }, seed);
      battle.sides[0].active[0]!.setStatus('psn');
      return battle;
    },
  },
  {
    name: 'a weather that ticks', needs: ['protect', 'tackle', 'raindance'], stall: 'protect', attack: 'tackle',
    build: (rules, mode, seed) => {
      const battle = delayBoard(rules, mode, 'tackle', { stall: 'protect' }, seed);
      battle.field.setWeather('raindance', battle.sides[1].active[0]!);
      return battle;
    },
  },
  { name: 'a contact shield that hurts the attacker', needs: ['spikyshield', 'tackle'], stall: 'spikyshield', attack: 'tackle', build: (rules, mode, seed) => delayBoard(rules, mode, 'tackle', { stall: 'spikyshield' }, seed) },
  {
    name: 'an Endure that holds a body up from full HP', needs: ['endure', 'tackle'], stall: 'endure', attack: 'tackle',
    build: (rules, mode, seed) => {
      const battle = delayBoard(rules, mode, 'tackle', { stall: 'endure' }, seed);
      battle.sides[1].active[0]!.hp = battle.sides[1].active[0]!.maxhp;
      return battle;
    },
  },
];

describe.each(WITH_STALL)('a repeated stall is a delay, $name', ({ rules, mode }) => {
  const dex = dexOfRules(rules);
  const { moves } = sweepMoves(rules, move => rollsStall(dex, move), false);
  const strike = strikeOf(rules, mode);

  test('the rule set has a move that cannot miss and knocks a 1 HP body out, and a stalling move that rolls', () => {
    expect(strike, 'a move that cannot miss').not.toBeNull();
    expect(moves.length).toBeGreaterThan(0);
  });

  test.each(moves.map(move => move.id))('%s: a foe at 1 HP that stalls is knocked out with mass 1 in 2 turns, and the proof names the stall', stall => {
    const proof = proofOf(delayBoard(rules, mode, strike!.id, { stall }), rules);
    expect(proof.mass).toBeCloseTo(1, 9);
    expect(proof.delay).toBe(stall);
    expect(proof.turns).toBe(2);
  });

  test.each(moves.map(move => move.id))('%s: the proof names the stall as the Dex does', stall => {
    const proof = proofOf(delayBoard(rules, mode, strike!.id, { stall }), rules);
    expect(proof.delayName).toBe(dex.moves.get(stall).name);
  });

  describe.each(KINDS.filter(kind => has(rules, kind.needs)))('the stall that matters: $name', kind => {
    test('no delay, and no mass above what the simulator plays out', () => {
      const proof = proofOf(kind.build(rules, mode, '1,2,3,4'), rules);
      expect(proof.delay, 'the held turn changes the board').toBeUndefined();
      if (proof.mass === 0) return;
      const own = ownClick(mode, true, 1);
      const rates = [1, 2].map(slot => winRate(seed => kind.build(rules, mode, seed), own, foeClick(slot)));
      expect(proof.mass, `the rollouts win ${rates.join(' and ')}`).toBeLessThanOrEqual(Math.min(...rates) + 0.1);
    });
  });
});

describe('the foe\'s partner attacks while the repeat holds (doubles)', () => {
  test.each(WITH_STALL.filter(({ mode, rules }) => mode === 'doubles' && has(rules, ['protect', 'tackle'])))('$name: the held Protect lets the partner hit, so no delay', ({ rules }) => {
    const partner = battleOf(rules.doubles!, [mon(rules, { species: 'Snorlax', moves: ['tackle', 'splash'], gender: 'M' }), mon(rules, { species: 'Blissey', moves: ['splash'] })], [mon(rules, { species: 'Vaporeon', moves: ['protect', 'splash'] }), mon(rules, { species: 'Machamp', moves: ['tackle'] })]);
    partner.sides[1].active[0]!.hp = 1;
    expect(proofOf(partner, rules).delay).toBeUndefined();
  });
});
