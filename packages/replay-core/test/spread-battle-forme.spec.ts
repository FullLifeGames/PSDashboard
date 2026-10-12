import { describe, expect, test } from 'vitest';
import { Battle, Dex, Teams, toID, type PokemonSet } from '@pkmn/sim';
import * as championsMod from '@pkmn/mods/champions';
import { parseReplayLogWithObservations } from '../src/protocol-parser';
import { buildSolveContext, keyOf, observationError, rollRange } from '../src/spreads/fit';
import { formeOrigin } from '../src/spreads/battle-forme';
import { readableOrders } from '../src/spreads/order-limit';
import type { DamageObservation, PokemonEvs, SpeedOrderObservation } from '../src/types';

/**
 * Round 69 (T190, spec decision 8): a hit by or on a battle forme (a Mega, Aegislash-Blade, Ogerpon's Tera mask) belongs to the
 * set of the species it came from and prices on the forme's own stats. The log names the forme the mon wears at the line, the
 * team the base species; before this the solver found no set for 'Golisopod-Mega' and dropped the hit (840 of 2 851 hits on the
 * Champions OU holdout, 19 of 2 373 in the Gen 9 bank). The Dex names the origin (battleOnly, changesFrom, a Mega Stone's
 * megaStone); the oracle is the simulator: every scene is a real battle where the forme changes and the hit lands.
 */
Dex.mod('champions', championsMod as unknown as NonNullable<Parameters<typeof Dex.mod>[1]>);
Dex.formats.extend(championsMod.Formats);

interface Cfg { name: string; id: string; level: number; points: boolean; doubles: boolean }
const CFGS: Cfg[] = [
  { name: 'gen 9 singles', id: 'gen9ou', level: 100, points: false, doubles: false },
  { name: 'gen 9 doubles', id: 'gen9doublesou', level: 100, points: false, doubles: true },
  { name: 'champions singles', id: 'gen9championsou', level: 50, points: true, doubles: false },
  { name: 'champions doubles', id: 'gen9championsdoublescustomgame', level: 50, points: true, doubles: true },
];
const MEGA_CFGS = CFGS.filter(cfg => cfg.points);

const sp = (spread: Partial<PokemonEvs>): PokemonEvs => ({ hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0, ...spread });
const ALL_31 = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };
const top = (cfg: Cfg) => (cfg.points ? 32 : 252);
const body = (cfg: Cfg, species: string, item: string, ability: string, moves: string[], nature: string, evs: Partial<PokemonEvs>): PokemonSet => ({
  name: species, species, item, ability, moves, nature, evs: sp(evs), ivs: { ...ALL_31 }, level: cfg.level, gender: '',
});
const blissey = (cfg: Cfg) => body(cfg, 'Blissey', '', 'Natural Cure', ['Splash'], 'Calm', { hp: top(cfg), spd: top(cfg) });
const chansey = (cfg: Cfg) => body(cfg, 'Chansey', '', 'Natural Cure', ['Splash'], 'Calm', { hp: top(cfg) });

interface Played {
  log: string;
  /** What the simulator took off the defender, and its maximum HP. */
  damage: number;
  maxHp: number;
  sets: { p1: PokemonSet[]; p2: PokemonSet[] };
}

/**
 * One turn on the simulator: p1's first mon uses `move` on p2's first mon, one of them evolving (`mega`) or changing forme by the
 * move itself. A scene is clean when nothing crit and the defender kept some HP; null otherwise.
 */
function play(cfg: Cfg, sets: { p1: PokemonSet[]; p2: PokemonSet[] }, move: string, mega: 'p1' | 'p2' | null, seed: number): Played | null {
  const battle = new Battle({
    formatid: toID(cfg.id), seed: [1, 2, 3, seed],
    p1: { name: 'Alpha', team: Teams.pack(sets.p1) }, p2: { name: 'Beta', team: Teams.pack(sets.p2) },
  });
  if (battle.requestState === 'teampreview') {
    battle.choose('p1', 'default');
    battle.choose('p2', 'default');
  }
  const choice = (side: 'p1' | 'p2') => {
    const first = side === 'p1' ? `move ${move}${cfg.doubles ? ' 1' : ''}` : 'move splash';
    return `${first}${mega === side ? ' mega' : ''}${cfg.doubles ? ', move splash' : ''}`;
  };
  const defender = battle.sides[1].pokemon[0];
  const before = defender.hp;
  battle.choose('p1', choice('p1'));
  battle.choose('p2', choice('p2'));
  const lines = battle.log;
  const log = lines.filter((line, index) => !line.startsWith('|split|') && !lines[index - 1]?.startsWith('|split|')).join('\n');
  if (/\|-crit\|/.test(log) || defender.hp <= 0 || defender.hp === before) return null;
  return { log, damage: before - defender.hp, maxHp: defender.maxhp, sets };
}

function scenesOf(cfg: Cfg, sets: () => { p1: PokemonSet[]; p2: PokemonSet[] }, move: string, mega: 'p1' | 'p2' | null, count = 3): Played[] {
  const found: Played[] = [];
  for (let seed = 1; found.length < count && seed <= 150; seed++) {
    const played = play(cfg, sets(), move, mega, seed);
    if (played && !found.some(known => known.damage === played.damage)) found.push(played);
  }
  return found;
}

const spreadOf = (set: PokemonSet) => ({ evs: set.evs as PokemonEvs, nature: set.nature });
const outside = (range: { min: number; max: number }, fraction: number) => fraction < range.min - 1e-9 || fraction > range.max + 1e-9;
const partnered = (cfg: Cfg, sets: PokemonSet[], partner: PokemonSet) => (cfg.doubles ? [...sets, partner] : sets);

/** The observation of the first hit p1's mon landed, as the parser reads it from the log. */
function firstHit(played: Played): DamageObservation {
  const observations = parseReplayLogWithObservations(played.log).observations.filter(obs => obs.attackerSide === 'p1' && obs.defenderSide !== 'p1');
  expect(observations).toHaveLength(1);
  return observations[0];
}

describe('formeOrigin reads the origin of a battle forme from the Dex (T190)', () => {
  const dexes: [string, ReturnType<typeof Dex.forGen>][] = [['gen 9', Dex.forGen(9)], ['champions', Dex.dexes.champions as ReturnType<typeof Dex.forGen>]];
  for (const [label, dex] of dexes) {
    test(`${label}: every battle forme the Dex holds maps to a base the set can carry, every other species to none`, () => {
      let formes = 0;
      for (const species of dex.species.all()) {
        const megaStones = [species.requiredItem, ...(species.requiredItems ?? [])].filter(Boolean)
          .filter(name => Object.values(dex.items.get(name!).megaStone ?? {}).includes(species.name));
        const isForme = !!species.battleOnly || !!species.changesFrom || species.isMega || megaStones.length > 0;
        const origins = formeOrigin(dex, species.name);
        if (!isForme) {
          expect(origins, species.name).toEqual([]);
          continue;
        }
        formes++;
        expect(origins.length, `${species.name} has an origin`).toBeGreaterThan(0);
        for (const origin of origins) {
          const base = dex.species.get(origin);
          expect(base.exists, `${species.name} <- ${origin}`).toBe(true);
          expect(base.name).not.toBe(species.name);
          // The base is a species a team carries: it is not itself a forme made in battle.
          expect(base.battleOnly, `${origin} carried by a set`).toBeFalsy();
          expect(base.isMega, `${origin} is no Mega`).toBeFalsy();
        }
        for (const name of ([] as string[]).concat(species.battleOnly ?? [])) expect(origins, species.name).toContain(name);
      }
      expect(formes).toBeGreaterThan(100);
    });
  }

  test('a Mega without the isMega flag (the Mega-Z formes) still reads its origin from the stone it requires', () => {
    for (const dex of [Dex.forGen(9), Dex.dexes.champions as ReturnType<typeof Dex.forGen>]) {
      const species = dex.species.get('Garchomp-Mega-Z');
      expect(species.isMega).toBeFalsy();
      expect(dex.items.get(species.requiredItem!).megaStone).toBeTruthy();
      expect(formeOrigin(dex, 'Garchomp-Mega-Z')).toEqual(['Garchomp']);
    }
  });

  test('a species the Dex does not know has no origin', () => {
    expect(formeOrigin(Dex.forGen(9), 'Missingno')).toEqual([]);
  });
});

describe('a hit by a Mega reaches the base set and prices at the Mega (T190)', () => {
  const ATTACKERS = [
    // Attack 84 to 130 and Tough Claws (the Mega's ability, not Blaze) on a contact move.
    { forme: 'Charizard-Mega-X', base: 'Charizard', item: 'Charizardite X', ability: 'Blaze', move: 'Dragon Claw', nature: 'Adamant', stat: 'atk' },
    // Special Attack 80 to 141; the Mega-Z forme carries no isMega flag.
    { forme: 'Garchomp-Mega-Z', base: 'Garchomp', item: 'Garchompite Z', ability: 'Rough Skin', move: 'Dragon Pulse', nature: 'Modest', stat: 'spa' },
  ];
  for (const cfg of MEGA_CFGS) {
    for (const attacker of ATTACKERS) {
      test(`${cfg.name} / ${attacker.forme}: the rolls contain the simulator's damage and the base species' do not`, () => {
        const sets = () => ({
          p1: partnered(cfg, [body(cfg, attacker.base, attacker.item, attacker.ability, [attacker.move], attacker.nature, { [attacker.stat]: top(cfg) })], blissey(cfg)),
          p2: partnered(cfg, [body(cfg, 'Corviknight', '', 'Pressure', ['Splash'], 'Impish', { hp: top(cfg), def: top(cfg) })], chansey(cfg)),
        });
        const scenes = scenesOf(cfg, sets, toID(attacker.move), 'p1');
        expect(scenes.length).toBeGreaterThanOrEqual(2);
        for (const played of scenes) {
          const obs = firstHit(played);
          // The log names the forme the mon wears when it strikes.
          expect(obs.attackerSpecies).toBe(attacker.forme);
          const ctx = buildSolveContext([obs], played.sets, cfg.id, []);
          const attackerKey = keyOf('p1', attacker.base);
          const defenderKey = keyOf('p2', 'Corviknight');
          // The hit keeps its place: one key per mon, the base species', and the solver kept it for both.
          expect([...ctx.byMon.keys()].sort()).toEqual([attackerKey, defenderKey].sort());
          const read = ctx.byMon.get(attackerKey)!;
          expect(read).toHaveLength(1);
          expect(ctx.byMon.get(defenderKey)).toEqual(read);
          const [seen] = read;
          const attackerSpread = spreadOf(played.sets.p1[0]);
          const defenderSpread = spreadOf(played.sets.p2[0]);
          const range = rollRange(ctx, seen, attackerSpread, defenderSpread)!;
          const fraction = played.damage / played.maxHp;
          expect(fraction).toBeGreaterThanOrEqual(range.min - 1e-9);
          expect(fraction).toBeLessThanOrEqual(range.max + 1e-9);
          expect(observationError(ctx, seen, attackerKey, attackerSpread)).toBe(0);
          // The scene is no scene if the base species rolled the same: the Mega's own stats put the hit outside the base's range.
          const asBase = rollRange(ctx, { ...seen, attackerForme: undefined } as typeof seen, attackerSpread, defenderSpread)!;
          expect(outside(asBase, fraction)).toBe(true);
        }
      });
    }

    test(`${cfg.name} / a hit on a Mega defender prices at the Mega's bulk and type`, () => {
      const sets = () => ({
        p1: partnered(cfg, [body(cfg, 'Weavile', '', 'Pressure', ['Icicle Crash'], 'Impish', {})], blissey(cfg)),
        p2: partnered(cfg, [body(cfg, 'Garchomp', 'Garchompite Z', 'Rough Skin', ['Splash'], 'Impish', { hp: top(cfg), def: top(cfg) })], chansey(cfg)),
      });
      const scenes = scenesOf(cfg, sets, 'iciclecrash', 'p2');
      expect(scenes.length).toBeGreaterThanOrEqual(2);
      for (const played of scenes) {
        const obs = firstHit(played);
        expect(obs.defenderSpecies).toBe('Garchomp-Mega-Z');
        const ctx = buildSolveContext([obs], played.sets, cfg.id, []);
        const attackerKey = keyOf('p1', 'Weavile');
        const defenderKey = keyOf('p2', 'Garchomp');
        expect([...ctx.byMon.keys()].sort()).toEqual([attackerKey, defenderKey].sort());
        const [seen] = ctx.byMon.get(defenderKey)!;
        const attackerSpread = spreadOf(played.sets.p1[0]);
        const defenderSpread = spreadOf(played.sets.p2[0]);
        const range = rollRange(ctx, seen, attackerSpread, defenderSpread)!;
        const fraction = played.damage / played.maxHp;
        expect(fraction).toBeGreaterThanOrEqual(range.min - 1e-9);
        expect(fraction).toBeLessThanOrEqual(range.max + 1e-9);
        expect(observationError(ctx, seen, defenderKey, defenderSpread)).toBe(0);
        const asBase = rollRange(ctx, { ...seen, defenderForme: undefined } as typeof seen, attackerSpread, defenderSpread)!;
        expect(outside(asBase, fraction)).toBe(true);
      }
    });
  }
});

describe('Aegislash-Blade reaches the Aegislash set and prices at the Blade (T190)', () => {
  for (const cfg of CFGS) {
    test(`${cfg.name}: Flash Cannon after the stance change rolls at Blade's Special Attack, Shield's does not contain it`, () => {
      const sets = () => ({
        p1: partnered(cfg, [body(cfg, 'Aegislash', '', 'Stance Change', ['Flash Cannon', 'King\'s Shield'], 'Modest', { spa: top(cfg) })], blissey(cfg)),
        p2: partnered(cfg, [body(cfg, 'Blissey', '', 'Natural Cure', ['Splash'], 'Calm', { hp: top(cfg) })], chansey(cfg)),
      });
      const scenes = scenesOf(cfg, sets, 'flashcannon', null);
      expect(scenes.length).toBeGreaterThanOrEqual(2);
      for (const played of scenes) {
        const obs = firstHit(played);
        expect(obs.attackerSpecies).toBe('Aegislash-Blade');
        const ctx = buildSolveContext([obs], played.sets, cfg.id, []);
        const attackerKey = keyOf('p1', 'Aegislash');
        expect([...ctx.byMon.keys()].sort()).toEqual([attackerKey, keyOf('p2', 'Blissey')].sort());
        const [seen] = ctx.byMon.get(attackerKey)!;
        const attackerSpread = spreadOf(played.sets.p1[0]);
        const defenderSpread = spreadOf(played.sets.p2[0]);
        const range = rollRange(ctx, seen, attackerSpread, defenderSpread)!;
        const fraction = played.damage / played.maxHp;
        expect(fraction).toBeGreaterThanOrEqual(range.min - 1e-9);
        expect(fraction).toBeLessThanOrEqual(range.max + 1e-9);
        expect(observationError(ctx, seen, attackerKey, attackerSpread)).toBe(0);
        // The Shield forme (what the base set names) has 50 Special Attack: far below the hit.
        const asShield = rollRange(ctx, { ...seen, attackerForme: undefined } as typeof seen, attackerSpread, defenderSpread)!;
        expect(fraction).toBeGreaterThan(asShield.max * 1.5);
      }
    });
  }
});

describe('the observation key stays the base key (T190)', () => {
  test('a hit by a forme the team does not name is dropped as before; the sets name the base only', () => {
    const cfg = CFGS[0];
    const sets = { p1: [body(cfg, 'Skarmory', '', 'Sturdy', ['Brave Bird'], 'Impish', { hp: 252 })], p2: [blissey(cfg)] };
    const obs: DamageObservation = {
      attackerSpecies: 'Garchomp-Mega-Z', defenderSpecies: 'Blissey', attackerSide: 'p1', moveId: 'dragonclaw', observedFraction: 0.3,
      lethal: false, attackerBoosts: {}, defenderBoosts: {}, attackerStatus: '', screens: [], weather: '',
    };
    expect(buildSolveContext([obs], sets, cfg.id, []).byMon.size).toBe(0);
  });

  test('a battle-only forme of Gen 9 (Ogerpon-Wellspring-Tera) joins the Ogerpon-Wellspring set', () => {
    const cfg = CFGS[0];
    const sets = { p1: [body(cfg, 'Ogerpon-Wellspring', 'Wellspring Mask', 'Water Absorb', ['Ivy Cudgel'], 'Jolly', { atk: 252 })], p2: [blissey(cfg)] };
    const obs: DamageObservation = {
      attackerSpecies: 'Ogerpon-Wellspring-Tera', defenderSpecies: 'Blissey', attackerSide: 'p1', moveId: 'ivycudgel', observedFraction: 0.3,
      lethal: false, attackerBoosts: {}, defenderBoosts: {}, attackerStatus: '', screens: [], weather: '',
    };
    const ctx = buildSolveContext([obs], sets, cfg.id, []);
    expect([...ctx.byMon.keys()].sort()).toEqual(['p1:ogerponwellspring', 'p2:blissey']);
    // The calculator builds the Tera mask (the Dex's ability, Embody Aspect) and prices the move: no hit is skipped as unreadable.
    const [seen] = ctx.byMon.get('p1:ogerponwellspring')!;
    expect(seen).toMatchObject({ attackerSpecies: 'Ogerpon-Wellspring', attackerForme: 'Ogerpon-Wellspring-Tera' });
    expect(rollRange(ctx, seen, spreadOf(sets.p1[0]), spreadOf(sets.p2[0]))).not.toBeNull();
  });
});

describe('an order read for a Mega names the base set too (T190, the Mega-Z orders of order-limit)', () => {
  test('Garchomp-Mega-Z moving first is a race of the Garchomp set on the Mega\'s own Speed', () => {
    const cfg = CFGS[0];
    const sets = { p1: [body(cfg, 'Garchomp', 'Garchompite Z', 'Rough Skin', ['Dragon Claw'], 'Jolly', { spe: 252 })], p2: [blissey(cfg)] };
    const order: SpeedOrderObservation = { firstSide: 'p1', firstSpecies: 'Garchomp-Mega-Z', secondSide: 'p2', secondSpecies: 'Blissey', turn: 2 } as SpeedOrderObservation;
    const [read] = readableOrders([order], sets, 9);
    const dex = Dex.forGen(9);
    expect(dex.species.get('Garchomp-Mega-Z').baseStats.spe).not.toBe(dex.species.get('Garchomp').baseStats.spe);
    expect(read).toMatchObject({ firstSide: 'p1', firstSpecies: 'Garchomp', firstForme: 'Garchomp-Mega-Z' });
  });
});
