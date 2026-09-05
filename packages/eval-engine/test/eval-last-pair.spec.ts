import { test, expect, describe } from 'vitest';
import { Battle, Teams, toID } from '@pkmn/sim';
import type { PokemonSet } from '@pkmn/sim';
import { createMatchupCache, evaluatePosition, singleMoveFraction } from '../src/eval-function';
import {
  LAST_PAIR_BASE, LAST_PAIR_CAP, LAST_PAIR_PER_TURN, lastPairRace, lastPairValue, setLastPairSweep,
} from '../src/score/last-pair';
import { battleFaintedFraction, leafValue } from '../src/search/leaf';
import { wpUnits } from '../src/winprob';

function makeSet(
  name: string,
  species: string,
  moves: string[],
  level = 100,
  extras: { item?: string; ability?: string } = {},
): PokemonSet {
  return {
    name, species, item: extras.item ?? '', ability: extras.ability ?? 'No Ability', moves,
    nature: 'Hardy',
    evs: { hp: 252, atk: 252, def: 0, spa: 0, spd: 4, spe: 0 },
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
    level, gender: '',
  };
}

function makeBattle(p1Sets: PokemonSet[], p2Sets: PokemonSet[], formatid = 'gen9customgame'): Battle {
  const battle = new Battle({
    formatid: toID(formatid),
    seed: '1,2,3,4',
    p1: { name: 'Alpha', team: Teams.pack(p1Sets) },
    p2: { name: 'Beta', team: Teams.pack(p2Sets) },
  });
  if (battle.sides.some(side => side.requestState === 'teampreview')) {
    battle.choose('p1', 'team 1');
    battle.choose('p2', 'team 1');
  }
  return battle;
}

/** The material static in win-prob units, as the leaf read it before round 33. */
const staticLeaf = (battle: Battle) =>
  wpUnits(evaluatePosition(battle, createMatchupCache()), battle.gameType === 'doubles', battleFaintedFraction(battle));

describe('last-pair race static (round 33)', () => {
  test('the race winner reads the base plus the clock margin, capped', () => {
    // A burned Toxapex with no damaging move (Recover, Haze) against a
    // Choice Band Zapdos-Galar: the wall never lands, the Band breaks the
    // heal economy — the loser clock is infinite, so the full margin applies.
    const battle = makeBattle(
      [makeSet('Pex', 'Toxapex', ['Recover', 'Haze'])],
      [makeSet('Zap', 'Zapdos-Galar', ['Stomping Tantrum', 'Close Combat'], 100, { item: 'Choice Band' })],
    );
    battle.sides[0].active[0]!.setStatus('brn');
    const race = lastPairRace(battle, createMatchupCache());
    expect(race).toEqual({ winner: 1, margin: 3 });
    expect(leafValue(battle, createMatchupCache())).toBeCloseTo(-LAST_PAIR_CAP, 10);
    // 573756 t135–t137: the material static had this Toxapex ahead on HP.
    expect(staticLeaf(battle)).toBeGreaterThan(-LAST_PAIR_CAP);
  });

  test('a one-turn lead reads 0.7 in win-prob units; the cap holds at three turns', () => {
    expect(lastPairValue({ winner: 0, margin: 1 })).toBeCloseTo(LAST_PAIR_BASE + LAST_PAIR_PER_TURN, 10);
    expect(lastPairValue({ winner: 1, margin: 1 })).toBeCloseTo(-(LAST_PAIR_BASE + LAST_PAIR_PER_TURN), 10);
    expect(lastPairValue({ winner: 0, margin: 0 })).toBeCloseTo(LAST_PAIR_BASE, 10);
    expect(lastPairValue({ winner: 0, margin: 3 })).toBeCloseTo(LAST_PAIR_CAP, 10);
    expect(lastPairValue({ winner: 0, margin: 9 })).toBeCloseTo(LAST_PAIR_CAP, 10);
  });

  test('a healthy attacker against a chipped mirror wins the race with a margin', () => {
    const battle = makeBattle(
      [makeSet('A', 'Machamp', ['Close Combat', 'Protect'])],
      [makeSet('B', 'Machamp', ['Close Combat', 'Protect'])],
    );
    const b = battle.sides[1].active[0]!;
    b.hp = Math.floor(b.maxhp * 0.3);
    const race = lastPairRace(battle, createMatchupCache());
    expect(race?.winner).toBe(0);
    expect(race!.margin).toBeGreaterThanOrEqual(1);
    expect(leafValue(battle, createMatchupCache())).toBeGreaterThanOrEqual(LAST_PAIR_BASE + LAST_PAIR_PER_TURN);
  });

  test('fixed-damage attackers race too: a Seismic Toss user is not a wall', () => {
    // The threat proxy had priced Seismic Toss at 0 (no base power), so the
    // race read a level-100 Machamp as never landing against a level-30
    // Eevee — and the last-pair static declared the Eevee the winner.
    const battle = makeBattle(
      [makeSet('Champ', 'Machamp', ['Seismic Toss', 'Protect'])],
      [makeSet('Eevee', 'Eevee', ['Tackle', 'Growl'], 30)],
    );
    const machamp = battle.sides[0].active[0]!;
    const eevee = battle.sides[1].active[0]!;
    expect(singleMoveFraction(machamp, eevee, 'seismictoss', battle)).toBeCloseTo(100 / eevee.maxhp, 10);
    // Fighting-type fixed damage still respects the Ghost immunity.
    const ghost = makeBattle(
      [makeSet('Champ', 'Machamp', ['Seismic Toss', 'Protect'])],
      [makeSet('Gengar', 'Gengar', ['Shadow Ball'], 30)],
    );
    expect(singleMoveFraction(ghost.sides[0].active[0]!, ghost.sides[1].active[0]!, 'seismictoss', ghost)).toBe(0);
    const race = lastPairRace(battle, createMatchupCache());
    expect(race?.winner).toBe(0);
    expect(leafValue(battle, createMatchupCache())).toBeGreaterThanOrEqual(LAST_PAIR_BASE);
  });

  test('mutual walls fall back to the material static', () => {
    const battle = makeBattle(
      [makeSet('Pex', 'Toxapex', ['Recover', 'Haze'])],
      [makeSet('Chan', 'Chansey', ['Soft-Boiled', 'Protect'])],
    );
    expect(lastPairRace(battle, createMatchupCache())).toBeNull();
    expect(leafValue(battle, createMatchupCache())).toBeCloseTo(staticLeaf(battle), 10);
  });

  test('more than one living body on either side leaves the static alone', () => {
    const battle = makeBattle(
      [makeSet('Pex', 'Toxapex', ['Recover', 'Haze'])],
      [makeSet('Zap', 'Zapdos-Galar', ['Stomping Tantrum', 'Close Combat'], 100, { item: 'Choice Band' }), makeSet('Pika', 'Pikachu', ['Tackle'], 5)],
    );
    expect(lastPairRace(battle, createMatchupCache())).toBeNull();
    expect(leafValue(battle, createMatchupCache())).toBeCloseTo(staticLeaf(battle), 10);
  });

  test('doubles: one living body per side, both on the field, races too', () => {
    // Two bodies per side (the sim refuses a one-mon doubles preview); the
    // partners faint, leaving one body per side on the field.
    const battle = makeBattle(
      [makeSet('Pex', 'Toxapex', ['Recover', 'Haze']), makeSet('Pika', 'Pikachu', ['Tackle'], 5)],
      [makeSet('Zap', 'Zapdos-Galar', ['Stomping Tantrum', 'Close Combat'], 100, { item: 'Choice Band' }), makeSet('Chu', 'Pikachu', ['Tackle'], 5)],
      'gen9doublescustomgame',
    );
    expect(battle.gameType).toBe('doubles');
    for (const side of battle.sides) side.active[1]!.faint();
    battle.faintMessages();
    battle.sides[0].active[0]!.setStatus('brn');
    expect(lastPairRace(battle, createMatchupCache())).toEqual({ winner: 1, margin: 3 });
    expect(leafValue(battle, createMatchupCache())).toBeCloseTo(-LAST_PAIR_CAP, 10);
  });

  test('the sweep variant fires only behind the flag when a decided sweeper stands', () => {
    // A level-100 Machamp against two level-5 Pikachu: the decided-sweep
    // profile sees it clearing both; with two bodies alive on p2 the
    // strict last-pair rule stays out.
    const battle = makeBattle(
      [makeSet('Champ', 'Machamp', ['Close Combat', 'Protect'])],
      [makeSet('Pika', 'Pikachu', ['Tackle', 'Growl'], 5), makeSet('Chu', 'Pikachu', ['Tackle', 'Growl'], 5)],
    );
    expect(lastPairRace(battle, createMatchupCache())).toBeNull();
    setLastPairSweep(true);
    try {
      const race = lastPairRace(battle, createMatchupCache());
      expect(race?.winner).toBe(0);
      expect(leafValue(battle, createMatchupCache())).toBeGreaterThanOrEqual(LAST_PAIR_BASE);
    } finally {
      setLastPairSweep(false);
    }
    expect(lastPairRace(battle, createMatchupCache())).toBeNull();
  });
});
