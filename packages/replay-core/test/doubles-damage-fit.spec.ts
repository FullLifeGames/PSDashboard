import { describe, expect, test } from 'vitest';
import { Battle, Dex, Teams, toID, type PokemonSet } from '@pkmn/sim';
import * as championsMod from '@pkmn/mods/champions';
import { Field } from '@smogon/calc';
import { parseReplayLogWithObservations } from '../src/protocol-parser';
import { buildSolveContext, keyOf, observationError, rollRange } from '../src/spreads/fit';
import { defenderSideOf, fieldOf } from '../src/spreads/observation-read';
import type { DamageObservation, PokemonEvs } from '../src/types';

/**
 * Round 69 (T31, spec decision 6): the spread solver prices the doubles hits the parser now records. The oracle is the simulator:
 * real doubles battles on the doubles format, a VGC format and the Champions doubles format, each scene one turn (Reflect two) with
 * the damage the simulator took off every target. The calculator's rolls under the played spreads must contain it, so the Field
 * must say Doubles, cut a spread hit and leave a lone target alone, and a hit on the attacker's partner must reach the partner's set.
 *   A  Rock Slide on two foes                       the 0.75 cut
 *   B  Rock Slide while one foe protects            the simulator keeps spreadHit (two targets at the start): the cut stays
 *   C  Earthquake on a foe and the partner          the other foe is immune (Flying); the partner is a defender of its own side
 *   D  Stomping Tantrum through Reflect             the screen is x2732/4096 in doubles, x0.5 in singles
 *   E  Rock Slide with one foe left on the field    no spreadHit: no cut, whatever the move's target says (the other foe set off
 *                                                   Explosion the turn before and has no replacement; VGC picks four, so its bench would come in: not run there)
 * Singles has no spread targets and no partner: the Field of a singles hit is the one of before (last test), and the singles solver
 * scenes are logged-entry-stage.spec.ts and the rest of the suite.
 */
Dex.mod('champions', championsMod as unknown as NonNullable<Parameters<typeof Dex.mod>[1]>);
Dex.formats.extend(championsMod.Formats);

interface Cfg { name: string; id: string; level: number; points: boolean }
const CFGS: Cfg[] = [
  { name: 'doubles ou', id: 'gen9doublesou', level: 100, points: false },
  { name: 'vgc', id: 'gen9vgc2025regi', level: 50, points: false },
  { name: 'champions doubles', id: 'gen9championsdoublescustomgame', level: 50, points: true },
];
const sp = (spread: Partial<PokemonEvs>): PokemonEvs => ({ hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0, ...spread });
const ALL_31 = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };
const body = (cfg: Cfg, species: string, ability: string, moves: string[], nature: string, evs: Partial<PokemonEvs>): PokemonSet => ({
  name: species, species, item: '', ability, moves, nature, evs: sp(evs), ivs: { ...ALL_31 }, level: cfg.level, gender: '',
});
// The most a stat takes: 252 EVs, 32 Stat Points.
const top = (cfg: Cfg) => (cfg.points ? 32 : 252);
const garchomp = (cfg: Cfg) => body(cfg, 'Garchomp', 'Rough Skin', ['Rock Slide', 'Earthquake', 'Stomping Tantrum', 'Protect'], 'Jolly', { atk: top(cfg), spe: top(cfg) });
const blissey = (cfg: Cfg) => body(cfg, 'Blissey', 'Natural Cure', ['Splash', 'Protect'], 'Calm', { hp: top(cfg) });
const primarina = (cfg: Cfg) => body(cfg, 'Primarina', 'Torrent', ['Splash', 'Protect'], 'Calm', { hp: top(cfg) });
const slowking = (cfg: Cfg) => body(cfg, 'Slowking', 'Regenerator', ['Splash', 'Protect', 'Reflect'], 'Calm', { hp: top(cfg) });
const bomber = (cfg: Cfg) => body(cfg, 'Corviknight', 'Pressure', ['Splash', 'Protect', 'Explosion'], 'Impish', { hp: top(cfg) });
const corviknight = (cfg: Cfg) => body(cfg, 'Corviknight', 'Pressure', ['Splash', 'Protect'], 'Impish', { hp: top(cfg) });
// Four-mon teams: the VGC format picks four at team preview. Bench bodies never move.
const bench = (cfg: Cfg) => [blissey(cfg), blissey(cfg)].map((mon, index) => ({ ...mon, species: ['Chansey', 'Audino'][index], name: ['Chansey', 'Audino'][index] }));

interface Scene {
  name: string;
  move: string;
  p1: (cfg: Cfg) => PokemonSet[];
  p2: (cfg: Cfg) => PokemonSet[];
  /** [p1 choice, p2 choice] per turn; the last turn is the hit. */
  turns: [string, string][];
  /** The mons of the opposing/own side that take damage in the last turn, as `side:Species`. */
  hit: string[];
  spread: boolean;
}
const SCENES: Scene[] = [
  {
    name: 'A rock slide on two foes', move: 'Rock Slide', spread: true,
    p1: cfg => [garchomp(cfg), blissey(cfg), ...bench(cfg)], p2: cfg => [primarina(cfg), slowking(cfg), ...bench(cfg)],
    turns: [['move rockslide, move splash', 'move splash, move splash']], hit: ['p2:Primarina', 'p2:Slowking'],
  },
  {
    name: 'B rock slide while one foe protects', move: 'Rock Slide', spread: true,
    p1: cfg => [garchomp(cfg), blissey(cfg), ...bench(cfg)], p2: cfg => [primarina(cfg), slowking(cfg), ...bench(cfg)],
    turns: [['move rockslide, move splash', 'move splash, move protect']], hit: ['p2:Primarina'],
  },
  {
    name: 'C earthquake on a foe and the partner', move: 'Earthquake', spread: true,
    p1: cfg => [garchomp(cfg), blissey(cfg), ...bench(cfg)], p2: cfg => [primarina(cfg), corviknight(cfg), ...bench(cfg)],
    turns: [['move earthquake, move splash', 'move splash, move splash']], hit: ['p2:Primarina', 'p1:Blissey'],
  },
  {
    name: 'D stomping tantrum through reflect', move: 'Stomping Tantrum', spread: false,
    p1: cfg => [garchomp(cfg), blissey(cfg), ...bench(cfg)], p2: cfg => [primarina(cfg), slowking(cfg), ...bench(cfg)],
    turns: [['move protect, move splash', 'move splash, move reflect'], ['move stompingtantrum 1, move splash', 'move splash, move splash']],
    hit: ['p2:Primarina'],
  },
  {
    name: 'E rock slide with one foe on the field', move: 'Rock Slide', spread: false,
    p1: cfg => [garchomp(cfg), blissey(cfg), ...bench(cfg)], p2: cfg => [primarina(cfg), bomber(cfg)],
    turns: [['move protect, move protect', 'move protect, move explosion'], ['move rockslide, move splash', 'move splash, pass']],
    hit: ['p2:Primarina'],
  },
];

interface Played {
  log: string;
  /** The simulator's damage per target, `side:Species`. */
  damage: Map<string, { damage: number; maxHp: number }>;
  /** `move.spreadHit` of the simulator at the end of the scene's move. */
  spreadHit: boolean;
  sets: { p1: PokemonSet[]; p2: PokemonSet[] };
}

function play(cfg: Cfg, scene: Scene, seed: number): Played | null {
  const sets = { p1: scene.p1(cfg), p2: scene.p2(cfg) };
  const battle = new Battle({
    formatid: toID(cfg.id), seed: [1, 2, 3, seed],
    p1: { name: 'Alpha', team: Teams.pack(sets.p1) }, p2: { name: 'Beta', team: Teams.pack(sets.p2) },
  });
  if (battle.requestState === 'teampreview') {
    battle.choose('p1', 'default');
    battle.choose('p2', 'default');
  }
  let spreadHit: boolean | null = null;
  const original = battle.actions.trySpreadMoveHit.bind(battle.actions);
  battle.actions.trySpreadMoveHit = (targets, pokemon, move, notActive) => {
    const result = original(targets, pokemon, move, notActive);
    if (move.id === toID(scene.move)) spreadHit = !!move.spreadHit;
    return result;
  };
  const before = new Map<string, number>();
  scene.turns.forEach(([p1Choice, p2Choice], index) => {
    if (index === scene.turns.length - 1) {
      for (const side of battle.sides) for (const mon of side.pokemon) before.set(`${side.id}:${mon.species.name}`, mon.hp);
    }
    battle.choose('p1', p1Choice);
    battle.choose('p2', p2Choice);
  });
  const lines = battle.log;
  const log = lines.filter((line, index) => !line.startsWith('|split|') && !lines[index - 1]?.startsWith('|split|')).join('\n');
  if (/\|-crit\|/.test(log) || spreadHit === null) return null;
  const damage = new Map<string, { damage: number; maxHp: number }>();
  for (const side of battle.sides) {
    for (const mon of side.pokemon) {
      const key = `${side.id}:${mon.species.name}`;
      if (before.get(key) !== mon.hp) damage.set(key, { damage: before.get(key)! - mon.hp, maxHp: mon.maxhp });
    }
  }
  // A clean scene: exactly the expected targets lost HP, nobody fainted.
  const clean = [...damage.keys()].sort().join() === [...scene.hit].sort().join() && [...damage.values()].every(entry => entry.damage > 0);
  return clean ? { log, damage, spreadHit, sets } : null;
}

function scenesOf(cfg: Cfg, scene: Scene, count: number): Played[] {
  const found: Played[] = [];
  for (let seed = 1; found.length < count && seed <= 150; seed++) {
    const played = play(cfg, scene, seed);
    if (played && ![...found].some(known => [...known.damage.values()][0].damage === [...played.damage.values()][0].damage)) found.push(played);
  }
  return found;
}

const spreadOf = (set: PokemonSet) => ({ evs: set.evs as PokemonEvs, nature: set.nature });
const keyOfSet = (side: 'p1' | 'p2', set: PokemonSet) => keyOf(side, set.species);

describe('the solver prices doubles hits like the simulator (T31)', () => {
  for (const cfg of CFGS) {
    for (const scene of SCENES) {
      const skipVgc = cfg.id.includes('vgc') && scene === SCENES[4];
      (skipVgc ? test.skip : test)(`${cfg.name} / ${scene.name}: the rolls contain the simulator's damage and the played spread has no error`, () => {
        const scenes = scenesOf(cfg, scene, 4);
        expect(scenes.length).toBeGreaterThanOrEqual(3);
        for (const played of scenes) {
          const all = parseReplayLogWithObservations(played.log).observations;
          const observations = all.filter(obs => obs.attackerSide === 'p1' && obs.attackerSpecies === 'Garchomp');
          expect(observations.map(obs => `${obs.defenderSide}:${obs.defenderSpecies}`).sort()).toEqual([...scene.hit].sort());
          const ctx = buildSolveContext(observations, played.sets, cfg.id, []);
          for (const obs of observations) {
            const { damage, maxHp } = played.damage.get(`${obs.defenderSide}:${obs.defenderSpecies}`)!;
            const key = keyOf(obs.defenderSide!, obs.defenderSpecies);
            expect(obs).toMatchObject({ doubles: true, spread: played.spreadHit });
            expect(Math.abs(obs.observedFraction - damage / maxHp)).toBeLessThan(0.01);
            // The oracle: the calculator's rolls under the played spreads, on the field the observation names.
            const attackerSet = played.sets.p1[0];
            const defenderSet = (obs.defenderSide === 'p1' ? played.sets.p1 : played.sets.p2).find(set => set.species === obs.defenderSpecies)!;
            const range = rollRange(ctx, obs, spreadOf(attackerSet), spreadOf(defenderSet))!;
            expect(damage / maxHp).toBeGreaterThanOrEqual(range.min - 1e-9);
            expect(damage / maxHp).toBeLessThanOrEqual(range.max + 1e-9);
            // The solver keeps the hit (partner included) and scores the played spread 0.
            expect(ctx.byMon.get(keyOfSet('p1', attackerSet))).toContain(obs);
            expect(ctx.byMon.get(key)).toContain(obs);
            expect(observationError(ctx, obs, keyOfSet('p1', attackerSet), spreadOf(attackerSet))).toBe(0);
          }
          // Read on a singles field, the same spread hit lies a third below what the played spread rolls: the solver would refute it.
          if (scene.spread) {
            for (const obs of observations.filter(entry => entry.defenderSide === 'p2')) {
              const asSingles = { ...obs, doubles: false, spread: false };
              expect(observationError(ctx, asSingles, keyOfSet('p1', played.sets.p1[0]), spreadOf(played.sets.p1[0]))).toBeGreaterThan(0);
            }
          }
        }
      });
    }
  }

  test('the cut is the simulator\'s: [spread] stands exactly when the simulator applied spreadHit', () => {
    let seen = 0;
    for (const cfg of CFGS) {
      for (const scene of SCENES) {
        if (cfg.id.includes('vgc') && scene === SCENES[4]) continue;
        for (const played of scenesOf(cfg, scene, 2)) {
          const marked = /\|move\|p1a: Garchomp\|[^|]+\|[^|]*\|\[spread\]/.test(played.log);
          expect(marked).toBe(played.spreadHit);
          expect([scene.name, played.spreadHit]).toEqual([scene.name, scene.spread]);
          for (const obs of parseReplayLogWithObservations(played.log).observations) expect(obs.spread).toBe(played.spreadHit);
          seen += 1;
        }
      }
    }
    expect(seen).toBeGreaterThan(20);
  });

  test('one target means no cut: a lone target read as a spread hit is refuted', () => {
    const cfg = CFGS[0];
    const scene = SCENES[4];
    for (const played of scenesOf(cfg, scene, 3)) {
      const obs = parseReplayLogWithObservations(played.log).observations.find(entry => entry.attackerSpecies === 'Garchomp')!;
      expect(obs.spread).toBe(false);
      const ctx = buildSolveContext([obs], played.sets, cfg.id, []);
      const key = keyOfSet('p1', played.sets.p1[0]);
      expect(observationError(ctx, obs, key, spreadOf(played.sets.p1[0]))).toBe(0);
      expect(observationError(ctx, { ...obs, spread: true }, key, spreadOf(played.sets.p1[0]))).toBeGreaterThan(0);
    }
  });

  test('Reflect weighs two thirds in doubles: the singles field refutes the played spread', () => {
    const cfg = CFGS[0];
    for (const played of scenesOf(cfg, SCENES[3], 3)) {
      const obs = parseReplayLogWithObservations(played.log).observations.find(entry => entry.attackerSpecies === 'Garchomp')!;
      expect(obs.screens).toEqual(['reflect']);
      const ctx = buildSolveContext([obs], played.sets, cfg.id, []);
      const key = keyOfSet('p1', played.sets.p1[0]);
      expect(observationError(ctx, obs, key, spreadOf(played.sets.p1[0]))).toBe(0);
      expect(observationError(ctx, { ...obs, doubles: false }, key, spreadOf(played.sets.p1[0]))).toBeGreaterThan(0);
    }
  });
});

describe('the field and the defender of an observation (T31)', () => {
  const base: DamageObservation = {
    attackerSpecies: 'Garchomp', defenderSpecies: 'Blissey', attackerSide: 'p1', moveId: 'earthquake', observedFraction: 0.2, lethal: false,
    attackerBoosts: {}, defenderBoosts: {}, attackerStatus: '', screens: ['reflect'], weather: 'raindance',
  };

  test('a singles observation (no new fields, an old cache) gets the field of before and the other side as defender', () => {
    const today = new Field({ weather: 'Rain', defenderSide: { isReflect: true, isLightScreen: false, isAuroraVeil: false } });
    expect(fieldOf(base)).toEqual(today);
    expect(fieldOf({ ...base, doubles: false, spread: false, defenderSide: 'p2' })).toEqual(today);
    expect(defenderSideOf(base)).toBe('p2');
    expect(defenderSideOf({ ...base, attackerSide: 'p2' })).toBe('p1');
  });

  test('a doubles observation gets a Doubles field and its own defender side', () => {
    expect(fieldOf({ ...base, doubles: true }).gameType).toBe('Doubles');
    expect(defenderSideOf({ ...base, doubles: true, defenderSide: 'p1' })).toBe('p1');
  });
});
