import { describe, expect, test } from 'vitest';
import type { Battle } from '@pkmn/sim';
import { healProfile, raceClocks, raceSide, type RaceSide } from '../src/score/races';
import { boostedFraction, pairThreat } from '../src/score/threat';
import { matchupTerms } from '../src/eval-function';
import { set } from './move-oracle';
import { battleOf } from './power-oracle';

/**
 * 13.10.2026 (the Swords Dance report on gen9draft-2058494320, T220): who heals and who only drains, and the
 * healer the pressure pins. Drain moves carry the heal flag (Heal Block stops them) but they heal a share of the
 * damage they deal, inside an attack: they are no turn spent healing. A healer under crumbling pressure counts as
 * never attacking only when attacking would not win it the race.
 */

const SINGLES = 'gen9customgame';
const body = (moves: string[]) => set('Tapu Bulu', moves, { evs: { hp: 252, atk: 252, def: 0, spa: 0, spd: 4, spe: 0 } });
const duel = (moves: string[], foeMoves: string[] = ['splash']) => battleOf(SINGLES, [body(moves)], [set('Snorlax', foeMoves)]);

/** The moves of the Dex that carry the heal flag, split by what the Dex says they do. */
function healFlagged(battle: Battle) {
  return battle.dex.moves.all().filter(move => move.exists && move.gen <= 9 && !move.isNonstandard && move.flags['heal']);
}

describe('healProfile, T220: a drain move is an attack, not a heal', () => {
  test('the simulator: Horn Leech deals damage and heals half of it, Recover heals half of the max HP and deals none', () => {
    const leech = duel(['hornleech']);
    const user = leech.sides[0].active[0]!;
    const target = leech.sides[1].active[0]!;
    user.sethp(Math.floor(user.maxhp / 4));
    const [userBefore, targetBefore] = [user.hp, target.hp];
    leech.choose('p1', 'move 1');
    leech.choose('p2', 'move 1');
    const dealt = targetBefore - target.hp;
    expect(dealt).toBeGreaterThan(0);
    expect(user.hp - userBefore).toBe(Math.round(dealt / 2));

    const recover = duel(['recover']);
    const healer = recover.sides[0].active[0]!;
    const foe = recover.sides[1].active[0]!;
    healer.sethp(Math.floor(healer.maxhp / 4));
    const [healerBefore, foeBefore] = [healer.hp, foe.hp];
    recover.choose('p1', 'move 1');
    recover.choose('p2', 'move 1');
    expect(foe.hp).toBe(foeBefore);
    expect(healer.hp - healerBefore).toBe(Math.floor(healer.maxhp / 2));
  });

  test('Horn Leech is no healer: no rate, no fuel; Recover keeps its 1/2 and its PP', () => {
    const leech = duel(['hornleech', 'stoneedge']);
    expect(healProfile(leech.sides[0].active[0]!, leech)).toEqual({ rate: 0, absorb: 0 });
    const recover = duel(['hornleech', 'recover']);
    const mon = recover.sides[0].active[0]!;
    const slot = mon.moveSlots.find(entry => entry.id === 'recover')!;
    expect(healProfile(mon, recover)).toEqual({ rate: 0.5, absorb: slot.pp * 0.5 });
  });

  test('every move of the Dex that drains is skipped, every move that heals by a ratio is read at that ratio', () => {
    const battle = duel(['splash']);
    const flagged = healFlagged(battle);
    const drains = flagged.filter(move => move.drain);
    const ratios = flagged.filter(move => move.heal && !move.drain);
    expect(drains.map(move => move.id)).toEqual(expect.arrayContaining(['hornleech', 'gigadrain', 'drainpunch', 'drainingkiss']));
    expect(ratios.map(move => move.id)).toEqual(expect.arrayContaining(['recover', 'roost', 'slackoff', 'softboiled']));
    const read = (id: string): { rate: number; absorb: number } => {
      const test = duel([id]);
      return healProfile(test.sides[0].active[0]!, test);
    };
    for (const move of drains) expect(read(move.id), move.id).toEqual({ rate: 0, absorb: 0 });
    for (const move of ratios) expect(read(move.id).rate, move.id).toBeCloseTo(move.heal![0] / move.heal![1], 12);
  });

  test('the simulator: every drain move of the Dex heals a share of the damage it deals, and no ratio move does', () => {
    const battle = duel(['splash']);
    const dealing = (id: string) => {
      const test = battleOf(SINGLES, [body([id])], [set('Snorlax', ['splash'])]);
      const user = test.sides[0].active[0]!;
      const target = test.sides[1].active[0]!;
      if (id === 'dreameater') target.setStatus('slp');
      // +6 accuracy: a 90% drain move must not miss on the fixed dice.
      user.boosts.accuracy = 6;
      user.sethp(Math.floor(user.maxhp / 4));
      const [userBefore, targetBefore] = [user.hp, target.hp];
      test.choose('p1', 'move 1');
      test.choose('p2', 'move 1');
      return { dealt: targetBefore - target.hp, healed: user.hp - userBefore };
    };
    // matchagotcha and paraboliccharge hit every adjacent body: in singles that is the one foe.
    for (const move of healFlagged(battle).filter(entry => entry.drain)) {
      const { dealt, healed } = dealing(move.id);
      expect(dealt, move.id).toBeGreaterThan(0);
      expect(Math.abs(healed - (dealt * move.drain![0]) / move.drain![1]), move.id).toBeLessThanOrEqual(1);
    }
  });
});

describe('raceClocks: a pinned healer attacks when attacking wins it the race', () => {
  const side = (partial: Partial<RaceSide>): RaceSide =>
    ({ hp: 1, frac: 0, residual: 0, healRate: 0, healAbsorb: 0, ppBudget: 64, ...partial });
  // Shore Up class: rate 1/2, 8 bars of PP fuel.
  const healer = (partial: Partial<RaceSide> = {}) => side({ frac: 0.45, healRate: 0.5, healAbsorb: 4, ...partial });

  test('a 5% body in front of a 100% healer under 60% pressure: the healer KOs it at once (before: it never attacked)', () => {
    const body = side({ hp: 0.05, frac: 0.6 });
    const clocks = raceClocks(body, healer());
    expect(clocks.turnsB).toBe(1);
    expect(clocks.effFracB).toBe(0.45);
    // The body needs two hits, and the healer spent no turn healing: no held PP absorbs.
    expect(clocks.turnsA).toBe(2);
  });

  test('the mirror: the clocks follow the sides, not their order', () => {
    const body = side({ hp: 0.05, frac: 0.6 });
    const swapped = raceClocks(healer(), body);
    expect(swapped.turnsA).toBe(1);
    expect(swapped.turnsB).toBe(2);
    expect(swapped.effFracA).toBe(0.45);
  });

  test('a tie in turns is not a loss: the healer attacks and the caller breaks the tie by speed', () => {
    const body = side({ hp: 0.45, frac: 0.6 });
    const clocks = raceClocks(body, healer({ hp: 0.6 }));
    expect(clocks.turnsB).toBe(1);
    expect(clocks.turnsA).toBe(1);
  });

  test('a healer the attack race would lose stays pinned: it never attacks and its held PP realize at the pin efficiency', () => {
    const body = side({ hp: 1, frac: 0.6 });
    // Round 76 (T258): one bar of PP (two heals) cannot bridge the four heals the sequence of the simulator needs, so the held-PP clock stays.
    const clocks = raceClocks(body, healer({ healAbsorb: 1 }));
    expect(clocks.effFracB).toBe(0);
    expect(clocks.turnsB).toBe(Infinity);
    // Unchanged by the rule: 1 + 1 x (1/2 / 0.6) bars under 0.6 per turn.
    expect(clocks.turnsA).toBe(Math.ceil((1 + 1 * (0.5 / 0.6)) / 0.6 - 1e-9));
    // With four bars of PP the sequence of the simulator is shorter: five hits, four heals (before: 8 turns).
    expect(raceClocks(body, healer({ healAbsorb: 4 })).turnsA).toBe(5);
  });

  test('a healer whose attack cannot land stays pinned (no damaging move)', () => {
    const clocks = raceClocks(side({ hp: 0.05, frac: 0.6 }), healer({ frac: 0 }));
    expect(clocks.turnsB).toBe(Infinity);
    expect(clocks.effFracB).toBe(0);
  });

  test('two pinned healers both attack when attacking is not a loss: the faster clock wins', () => {
    const a = healer({ hp: 0.3, frac: 0.6 });
    const b = healer({ hp: 1, frac: 0.55 });
    const clocks = raceClocks(a, b);
    expect(clocks.turnsA).toBeLessThan(Infinity);
    expect(clocks.turnsB).toBeLessThan(Infinity);
    expect(clocks.effFracA).toBe(0.6);
    expect(clocks.effFracB).toBe(0.55);
  });

  test('T258: a pinned healer falls to the sequence of the simulator, a hit then a heal: n hits take 1 + (n - 1) heals (before: the held PP counted at rate/incoming, 8 turns)', () => {
    const attacker = (frac: number) => side({ hp: 0.05, frac });
    const shoreUp = (partial: Partial<RaceSide> = {}) => side({ hp: 1, frac: 0, healRate: 0.5, healAbsorb: 4, ppBudget: 16, ...partial });
    // 80% hits: the second hit lands on 20% + 50%, so two turns (before: 5).
    expect(raceClocks(attacker(0.795), shoreUp()).turnsA).toBe(2);
    // 60% hits: net 10% a turn after the first heal, five hits in all, four heals of the eight PP.
    expect(raceClocks(attacker(0.6), shoreUp()).turnsA).toBe(5);
    // A hit that takes the healer in one: no heal comes in time.
    expect(raceClocks(attacker(1.2), shoreUp()).turnsA).toBe(1);
  });

  test('T258: a pinned healer with too few heal PP for the sequence keeps the held-PP clock', () => {
    // Two heals (one bar of PP) cannot bridge the four heals the 60% sequence needs: the PP-bound clock of round 12 stays.
    expect(raceClocks(side({ hp: 0.05, frac: 0.6 }), side({ hp: 1, frac: 0, healRate: 0.5, healAbsorb: 1, ppBudget: 16 })).turnsA).toBe(4);
  });

  test('nobody pinned: the clocks are the old ones', () => {
    const attacker = side({ frac: 0.3, ppBudget: 16 });
    expect(raceClocks(attacker, side({ healRate: 0.5, healAbsorb: 1 })).turnsA).toBe(7);
    const calm = raceClocks(side({ frac: 0.45 }), healer({ frac: 0.2, ppBudget: 60 }));
    expect(calm.turnsB).toBe(50);
  });
});

describe('the matchup term reads the same races', () => {
  test('a 5% Cobalion at +4 loses the pair to a full-HP Shore Up Palossand (before it won: the Palossand never swung back)', () => {
    const battle = battleOf(SINGLES, [set('Cobalion', ['smartstrike', 'splash'])], [set('Palossand', ['shoreup', 'earthpower'])]);
    const cobalion = battle.sides[0].active[0]!;
    cobalion.boosts.atk = 4;
    cobalion.sethp(Math.floor(cobalion.maxhp * 0.05));
    // The simulator: Cobalion moves first and hurts the Palossand, then Earth Power takes it.
    const played = battleOf(SINGLES, [set('Cobalion', ['smartstrike', 'splash'])], [set('Palossand', ['shoreup', 'earthpower'])]);
    played.sides[0].active[0]!.boosts.atk = 4;
    played.sides[0].active[0]!.sethp(cobalion.hp);
    played.choose('p1', 'move 1');
    played.choose('p2', 'move 2');
    expect(played.sides[0].active[0]!.fainted).toBe(true);
    expect(played.sides[1].active[0]!.fainted).toBe(false);
    expect(matchupTerms(battle).matchup).toBeLessThan(0);
  });

  test('Sinistcha with Matcha Gotcha is no wall: a drain move buys no heal PP, so the +0 Garchomp KOs it as fast as a body with no heal at all (before: 20 turns)', () => {
    const clocksOf = (moves: string[]) => {
      const battle = battleOf(SINGLES, [set('Sinistcha', moves)], [set('Garchomp', ['crunch', 'splash'])]);
      const [sinistcha, garchomp] = [battle.sides[0].active[0]!, battle.sides[1].active[0]!];
      const mine = pairThreat(sinistcha, garchomp, battle);
      const theirs = pairThreat(garchomp, sinistcha, battle);
      return raceClocks(
        raceSide(sinistcha, 1, boostedFraction(mine, sinistcha, garchomp), battle),
        raceSide(garchomp, 1, boostedFraction(theirs, garchomp, sinistcha), battle),
      );
    };
    const drain = clocksOf(['matchagotcha', 'splash']);
    expect(drain.turnsB).toBe(clocksOf(['splash']).turnsB);
    expect(drain.turnsB).toBeLessThan(clocksOf(['recover', 'splash']).turnsB);
    // And its own clock lands: the pressure on a drain user does not pin it.
    expect(drain.turnsA).toBeLessThan(Infinity);
  });
});
