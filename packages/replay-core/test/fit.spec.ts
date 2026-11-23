import { describe, expect, test } from 'vitest';
import { Battle, Teams, toID, type PokemonSet } from '@pkmn/sim';
import { Field } from '@smogon/calc';
import { parseReplayLogWithObservations } from '../src/protocol-parser';
import { buildSolveContext, keyOf, observationError, rollRange, spreadFor, type SolveContext } from '../src/spreads/fit';
import { defenderSideOf, fieldOf } from '../src/spreads/observation-read';
import type { DamageObservation, PokemonEvs } from '../src/types';
import { inferSpreads } from '../src/spread-inference';
import type { ReadObservation } from '../src/spreads/observation-read';
import {
  FORMAT,
  alone,
  damagingTurns,
  hit,
  isDoubles,
  scenesOf,
  set,
  splash,
  type FieldScene,
  type Kind,
  type Scene,
} from './fit-field-scenes';

// The spread solver prices the doubles hits the parser records. The oracle is the simulator: real battles on the doubles format, a VGC format and the
// Champions doubles format, each scene one turn (Reflect two) with the damage taken off every target. The calculator's rolls under the played spreads
// must contain it, so the Field must say Doubles, cut a spread hit and leave a lone target alone, and a hit on the attacker's partner must reach the
// partner's set.
//   A  Rock Slide on two foes                       the 0.75 cut
//   B  Rock Slide while one foe protects            the simulator keeps spreadHit (two targets at the start): the cut stays
//   C  Earthquake on a foe and the partner          the other foe is immune (Flying); the partner is a defender of its own side
//   D  Stomping Tantrum through Reflect             the screen is x2732/4096 in doubles, x0.5 in singles
//   E  Rock Slide with one foe left on the field    no spreadHit: no cut, whatever the move's target says (the other foe set off
//                                                   Explosion the turn before and has no replacement; VGC picks four, so its bench would come in: not run there)
// Singles has no spread targets and no partner: the Field of a singles hit is the one of before (last test).
describe('doubles-damage-fit', () => {
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
    turns: [string, string][];
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
    damage: Map<string, { damage: number; maxHp: number }>;
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
});

const DRAGONITE = () => set('Dragonite', '', 'Multiscale', ['Extreme Speed', 'Splash'], 'Adamant', { atk: 252, spe: 252 }, 'Normal');
/** A weak Wood Hammer: Bold and no Attack IV, so that a Grassy Terrain hit does not take Calyrex-Ice down. */
const RILLABOOM = () => ({ ...set('Rillaboom', '', 'Grassy Surge', ['Wood Hammer', 'Splash'], 'Bold', {}), ivs: { hp: 31, atk: 0, def: 31, spa: 31, spd: 31, spe: 31 } });
/** The body the pin's usage prior gave Calyrex-Ice: Brave, 252 HP, 252 Attack, 4 Special Defense. */
const CALYREX_ICE = () => set('Calyrex-Ice', '', 'As One (Glastrier)', ['Splash'], 'Brave', { hp: 252, atk: 252, spd: 4 });
const CHIEN_PAO = (moves: string[], nature: string, spread: Partial<PokemonEvs>) => set('Chien-Pao', '', 'Sword of Ruin', moves, nature, spread);

/** The Chien-Pao beside the defender holds the Sword of Ruin (the pin's turn 3). Doubles only. */
const RUIN_ON_THE_PARTNER: FieldScene = {
  title: "the defender's partner holds the Sword of Ruin, the attacker Terastallizes to Normal",
  p1: () => [DRAGONITE(), RILLABOOM()],
  p2: () => [CALYREX_ICE(), CHIEN_PAO(['Splash'], 'Impish', { hp: 252, def: 252 })],
  attacker: 'Dragonite', defender: 'Calyrex-Ice',
  // Two hits, since the solver wants two lines before it moves a body; the Grassy Terrain heals between them.
  steps: () => [
    { p1: `${hit(true, 'Extreme Speed', true)}, ${splash()}`, p2: `${splash()}, ${splash()}` },
    { p1: `${hit(true, 'Extreme Speed')}, ${splash()}`, p2: `${splash()}, ${splash()}` },
  ],
  kinds: ['doubles'],
  hitLine: true,
};

/** The defender holds the Sword of Ruin itself: the ability does not lower its own Defense, whatever the other holders do. Doubles only. */
const RUIN_ON_THE_DEFENDER: FieldScene = {
  title: 'the defender holds the Sword of Ruin',
  p1: () => [DRAGONITE(), RILLABOOM()],
  p2: () => [CHIEN_PAO(['Splash'], 'Impish', { hp: 252, def: 252 }), CALYREX_ICE()],
  attacker: 'Dragonite', defender: 'Chien-Pao',
  steps: () => [{ p1: `${hit(true, 'Extreme Speed', true)}, ${splash()}`, p2: `${splash()}, ${splash()}` }],
  kinds: ['doubles'],
  hitLine: true,
};

/** The attacker holds the Sword of Ruin: the target's Defense falls by a quarter. Singles and doubles. */
const RUIN_ON_THE_ATTACKER: FieldScene = {
  title: 'the attacker holds the Sword of Ruin',
  p1: doubles => [CHIEN_PAO(['Crunch', 'Splash'], 'Hardy', {}), ...(doubles ? [RILLABOOM()] : [])],
  p2: doubles => [CALYREX_ICE(), ...(doubles ? [set('Blissey', '', 'Natural Cure', ['Splash'], 'Calm', { hp: 252 })] : [])],
  attacker: 'Chien-Pao', defender: 'Calyrex-Ice',
  steps: doubles => [{ p1: alone(doubles, hit(doubles, 'Crunch')), p2: alone(doubles, splash()) }],
  kinds: ['singles', 'doubles'],
  hitLine: true,
};

/** A Grassy Surge lead hits with Wood Hammer, which the terrain lifts by a third, and the terrain heals the defender at the end of the turn. */
const GRASSY_HIT: FieldScene = {
  title: 'Wood Hammer in Grassy Terrain',
  p1: doubles => [RILLABOOM(), ...(doubles ? [set('Blissey', '', 'Natural Cure', ['Splash'], 'Calm', { hp: 252 })] : [])],
  p2: doubles => [CALYREX_ICE(), ...(doubles ? [CHIEN_PAO(['Splash'], 'Impish', { hp: 252, def: 252 })] : [])],
  attacker: 'Rillaboom', defender: 'Calyrex-Ice',
  steps: doubles => [{ p1: alone(doubles, hit(doubles, 'Wood Hammer')), p2: alone(doubles, splash()) }],
  kinds: ['singles', 'doubles'],
  hitLine: true,
};

/** The observation without the fields the field-fact rows added. */
const T86_FIELDS = [
  'moveName', 'terrain', 'attackerTera', 'defenderTera', 'attackerHp', 'defenderHp', 'attackerFallen', 'attackerAbility', 'defenderAbility',
  'attackerAbilityOn', 'attackerSuppressed', 'defenderSuppressed', 'fieldFacts',
] as const;
const stale = <T extends DamageObservation>(obs: T): T => {
  const rest: Record<string, unknown> = { ...obs };
  for (const field of T86_FIELDS) delete rest[field];
  return rest as unknown as T;
};

const bodyOf = (scene: FieldScene, doubles: boolean, side: 'p1' | 'p2', species: string) =>
  (side === 'p1' ? scene.p1 : scene.p2)(doubles).find(body => body.species === species)!;

function contextOf(scene: FieldScene, kind: Kind, observations: DamageObservation[]): SolveContext {
  const doubles = isDoubles(kind);
  return buildSolveContext(
    observations, { p1: [bodyOf(scene, doubles, 'p1', scene.attacker)], p2: [bodyOf(scene, doubles, 'p2', scene.defender)] }, FORMAT[kind], [],
  );
}

function hitsOf(scene: FieldScene, played: Scene): DamageObservation[] {
  const found = parseReplayLogWithObservations(played.log).observations.filter(obs => obs.defenderSpecies === scene.defender);
  expect(found).toHaveLength(damagingTurns(played).length);
  return found;
}

const readsOf = (ctx: SolveContext, scene: FieldScene): ReadObservation[] => ctx.byMon.get(keyOf('p2', scene.defender)) ?? [];

function containsDamage(ctx: SolveContext, scene: FieldScene, obs: ReadObservation, damage: number, maxHp: number): boolean {
  const range = rollRange(ctx, obs, spreadFor(ctx, 'p1', scene.attacker), spreadFor(ctx, 'p2', scene.defender));
  expect(range).not.toBeNull();
  return Math.round(range!.min * maxHp) <= damage && damage <= Math.round(range!.max * maxHp);
}

describe('the Ruin abilities and the Grassy Terrain are in the rolls of a hit (T86 check)', () => {
  for (const scene of [RUIN_ON_THE_PARTNER, RUIN_ON_THE_DEFENDER, RUIN_ON_THE_ATTACKER, GRASSY_HIT]) {
    for (const kind of scene.kinds) {
      test(`${kind}: ${scene.title}`, () => {
        const scenes = scenesOf(kind, scene, 3);
        expect(scenes.length).toBeGreaterThanOrEqual(2);
        for (const played of scenes) {
          const observations = hitsOf(scene, played);
          const ctx = contextOf(scene, kind, observations);
          const reads = readsOf(ctx, scene);
          expect(reads).toHaveLength(observations.length);
          const damages = damagingTurns(played);
          reads.forEach((obs, index) => {
            expect(containsDamage(ctx, scene, obs, damages[index], played.maxHp), `hit ${index + 1}`).toBe(true);
            expect(observationError(ctx, obs, keyOf('p2', scene.defender), spreadFor(ctx, 'p2', scene.defender)), `error of hit ${index + 1}`).toBe(0);
          });
          // Without the field fact the reading misses the hit, except where the calculator reads the Ruin off the two bodies: the defender's own
          // Sword of Ruin lowers nothing, and the attacker's comes with the ability of its set.
          if (scene !== RUIN_ON_THE_DEFENDER && scene !== RUIN_ON_THE_ATTACKER) {
            expect(reads.some((obs, index) => !containsDamage(ctx, scene, stale(obs), damages[index], played.maxHp)), 'a hit the stale reading misses').toBe(true);
          }
        }
      });
    }
  }

  test('doubles: the Sword of Ruin is a field fact that the log shows, and the Grassy Terrain a terrain', () => {
    const [partner] = scenesOf('doubles', RUIN_ON_THE_PARTNER, 1);
    expect(hitsOf(RUIN_ON_THE_PARTNER, partner)[0]).toMatchObject({ fieldFacts: ['swordofruin'], terrain: 'Grassy', attackerTera: 'Normal' });
    const [grassy] = scenesOf('singles', GRASSY_HIT, 1);
    expect(hitsOf(GRASSY_HIT, grassy)[0]).toMatchObject({ terrain: 'Grassy' });
  });

  test('doubles: a Sword of Ruin held by the defender itself lowers nothing of its own Defense', () => {
    for (const played of scenesOf('doubles', RUIN_ON_THE_DEFENDER, 3)) {
      const observations = hitsOf(RUIN_ON_THE_DEFENDER, played);
      const ctx = contextOf(RUIN_ON_THE_DEFENDER, 'doubles', observations);
      const attacker = spreadFor(ctx, 'p1', 'Dragonite');
      const defender = spreadFor(ctx, 'p2', 'Chien-Pao');
      for (const obs of readsOf(ctx, RUIN_ON_THE_DEFENDER)) {
        expect(obs.fieldFacts).toContain('swordofruin');
        expect(obs.defenderAbility).toBe('swordofruin');
        expect(rollRange(ctx, obs, attacker, defender)).toEqual(rollRange(ctx, { ...obs, fieldFacts: [] }, attacker, defender));
      }
    }
  });
});

describe('the solver keeps the body the pin hit measures (T86 check)', () => {
  test('doubles: Calyrex-Ice keeps its HP under the logged field, and the prior misses the hit under the blind one', () => {
    const doubles = true;
    const kind: Kind = 'doubles';
    const scene = RUIN_ON_THE_PARTNER;
    const teams = { p1: scene.p1(doubles), p2: scene.p2(doubles) };
    const key = keyOf('p2', 'Calyrex-Ice');
    for (const played of scenesOf(kind, scene, 3)) {
      const observations = hitsOf(scene, played);
      const solved = inferSpreads(observations, teams, FORMAT[kind], []).get(key);
      const ctx = buildSolveContext(observations, teams, FORMAT[kind], []);
      // The prior explains the hit exactly; the solver has nothing to move.
      const body = solved ?? spreadFor(ctx, 'p2', 'Calyrex-Ice');
      expect(body.evs.hp).toBeGreaterThanOrEqual(156);
      expect(observationError(ctx, readsOf(ctx, scene)[0], key, body)).toBe(0);

      // Without Tera, Sword of Ruin and terrain the prior misses the hit (the pin's solver then took the least bad body, HP 0).
      const blind = observations.map(stale);
      const blindCtx = buildSolveContext(blind, teams, FORMAT[kind], []);
      expect(observationError(blindCtx, readsOf(blindCtx, scene)[0], key, spreadFor(blindCtx, 'p2', 'Calyrex-Ice'))).toBeGreaterThan(0);
    }
  });
});

describe('spread-item-at-hit', () => {
  type Kind = 'singles' | 'doubles' | 'champions singles' | 'champions doubles';
  const KINDS: Kind[] = ['singles', 'doubles', 'champions singles', 'champions doubles'];
  const FORMAT: Record<Kind, string> = {
    singles: 'gen9ou', doubles: 'gen9doublesou', 'champions singles': 'gen9championsou', 'champions doubles': 'gen9championsdoublescustomgame',
  };
  const isDoubles = (kind: Kind) => kind.endsWith('doubles');
  const ALL_31 = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };
  const sp = (spread: Partial<PokemonEvs>): PokemonEvs => ({ hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0, ...spread });
  const set = (species: string, item: string, ability: string, nature: string, spread: Partial<PokemonEvs>): PokemonSet => ({
    name: species, species, item, ability, moves: ['Splash'], nature, evs: sp(spread), ivs: { ...ALL_31 }, level: 100, gender: '',
  });
  const partner = () => set('Blissey', '', 'Natural Cure', 'Calm', { hp: 252 });

  function scaled(body: PokemonSet, kind: Kind): PokemonSet {
    if (!kind.startsWith('champions')) return body;
    return { ...body, level: 50, evs: Object.fromEntries(Object.entries(body.evs).map(([stat, value]) => [stat, value > 0 ? 32 : 0])) as unknown as PokemonEvs };
  }
  const movesOf = (setup: Setup, kind: Kind) => setup.moves[isDoubles(kind) ? 'doubles' : 'singles'];

  interface Setup {
    title: string;
    attacker: PokemonSet;
    defender: PokemonSet;
    /** The attacker's move of each turn (the defender splashes); a doubles move may differ where the singles one is a spread move. */
    moves: Record<'singles' | 'doubles', string[]>;
  }

  /** Garchomp pops Aegislash's Air Balloon with a Dragon Claw, then a Ground hit lands (2691843318). */
  const BALLOON: Setup = {
    title: 'a popped Air Balloon',
    attacker: set('Garchomp', '', 'Rough Skin', 'Jolly', { atk: 252, spe: 252 }),
    defender: set('Aegislash', 'Air Balloon', 'Stance Change', 'Impish', { hp: 252, def: 252 }),
    moves: { singles: ['Dragon Claw', 'Earthquake'], doubles: ['Dragon Claw', 'Stomping Tantrum'] },
  };
  const KNOCK_OFF: Setup = {
    title: 'a Knock Off',
    attacker: set('Gengar', '', 'Cursed Body', 'Timid', { spa: 252, spe: 252 }),
    defender: set('Dusclops', 'Eviolite', 'Pressure', 'Calm', { hp: 252, spd: 252 }),
    moves: { singles: ['Knock Off', 'Shadow Ball'], doubles: ['Knock Off', 'Shadow Ball'] },
  };
  const BERRY: Setup = {
    title: 'a consumed Chilan Berry',
    attacker: set('Garchomp', '', 'Rough Skin', 'Jolly', { atk: 252, spe: 252 }),
    defender: set('Blissey', 'Chilan Berry', 'Natural Cure', 'Calm', { hp: 252, spd: 252 }),
    moves: { singles: ['Tackle', 'Tackle'], doubles: ['Tackle', 'Tackle'] },
  };
  const TRICK: Setup = {
    title: 'a Trick',
    attacker: set('Gengar', 'Choice Specs', 'Cursed Body', 'Timid', { spa: 252, spe: 252 }),
    defender: set('Garchomp', 'Wise Glasses', 'Rough Skin', 'Jolly', { hp: 252, atk: 252 }),
    moves: { singles: ['Trick', 'Shadow Ball'], doubles: ['Trick', 'Shadow Ball'] },
  };

  interface Scene {
    log: string;
    damage: number[];
    maxHp: number;
  }

  function sceneOf(kind: Kind, setup: Setup, seed: number): Scene | null {
    const doubles = isDoubles(kind);
    const attacker = { ...scaled(setup.attacker, kind), moves: movesOf(setup, kind) };
    const defender = scaled(setup.defender, kind);
    const battle = new Battle({
      formatid: toID(FORMAT[kind]), seed: [1, 2, 3, seed],
      p1: { name: 'Alpha', team: Teams.pack(doubles ? [attacker, scaled(partner(), kind)] : [attacker]) },
      p2: { name: 'Beta', team: Teams.pack(doubles ? [defender, scaled(partner(), kind)] : [defender]) },
    });
    if (battle.requestState === 'teampreview') {
      battle.choose('p1', 'default');
      battle.choose('p2', 'default');
    }
    const target = battle.p2.active[0];
    const { maxhp: maxHp } = target;
    const damage: number[] = [];
    for (const move of movesOf(setup, kind)) {
      const before = target.hp;
      battle.choose('p1', doubles ? `move ${toID(move)} 1, move splash` : `move ${toID(move)}`);
      battle.choose('p2', doubles ? 'move splash, move splash' : 'move splash');
      damage.push(before - target.hp);
    }
    const lines = battle.log;
    const log = lines.filter((line, index) => !line.startsWith('|split|') && !lines[index - 1]?.startsWith('|split|')).join('\n');
    if (/\|-crit\|/.test(log) || /\|-miss\|/.test(log) || target.hp <= 0) return null;
    return { log, damage, maxHp };
  }

  function scenesOf(kind: Kind, setup: Setup, count: number): Scene[] {
    const scenes: Scene[] = [];
    for (let seed = 1; scenes.length < count && seed <= 200; seed++) {
      const scene = sceneOf(kind, setup, seed);
      if (scene && !scenes.some(known => known.damage.at(-1) === scene.damage.at(-1))) scenes.push(scene);
    }
    return scenes;
  }

  function hitsOf(scene: Scene, setup: Setup): DamageObservation[] {
    const found = parseReplayLogWithObservations(scene.log).observations.filter(obs => obs.defenderSpecies === setup.defender.species);
    expect(found).toHaveLength(scene.damage.filter(lost => lost > 0).length);
    return found;
  }

  const contextOf = (kind: Kind, setup: Setup, observations: DamageObservation[]): SolveContext =>
    buildSolveContext(observations, { p1: [scaled(setup.attacker, kind)], p2: [scaled(setup.defender, kind)] }, FORMAT[kind], []);

  const readOf = (ctx: SolveContext, setup: Setup, index: number): ReadObservation =>
    ctx.byMon.get(keyOf('p2', setup.defender.species))![index];

  function containsDamage(ctx: SolveContext, setup: Setup, obs: ReadObservation, damage: number, maxHp: number): boolean {
    const range = rollRange(ctx, obs, spreadFor(ctx, 'p1', setup.attacker.species), spreadFor(ctx, 'p2', setup.defender.species));
    expect(range).not.toBeNull();
    return Math.round(range!.min * maxHp) <= damage && damage <= Math.round(range!.max * maxHp);
  }

  /** The observation without the item fields: no item at the hit, the set's item. */
  const stale = (obs: ReadObservation): ReadObservation => ({
    ...obs, attackerItem: undefined, defenderItem: undefined, attackerItemChanged: undefined, defenderItemChanged: undefined,
  });

  const ITEM_FIELDS = ['attackerItem', 'defenderItem', 'attackerItemChanged', 'defenderItemChanged'] as const;
  const itemFields = (obs: DamageObservation) => Object.fromEntries(ITEM_FIELDS.map(field => [field, obs[field]]));

  describe('the item a hit is priced with is the item at the hit (T191)', () => {
    // Champions plays the popped Air Balloon of 2691843318 and 2694103115; the other scenes use moves and items its generation lacks.
    for (const kind of KINDS) {
      for (const setup of kind.startsWith('champions') ? [BALLOON] : [BALLOON, KNOCK_OFF, BERRY, TRICK]) {
        test(`${kind}: ${setup.title}: the rolls at the hit contain the simulator's damage, the set's item does not`, () => {
          const scenes = scenesOf(kind, setup, 4);
          expect(scenes.length).toBeGreaterThanOrEqual(3);
          for (const scene of scenes) {
            const observations = hitsOf(scene, setup);
            const ctx = contextOf(kind, setup, observations);
            const lastDamage = scene.damage.at(-1)!;
            const last = readOf(ctx, setup, observations.length - 1);
            expect(containsDamage(ctx, setup, last, lastDamage, scene.maxHp)).toBe(true);
            expect(containsDamage(ctx, setup, stale(last), lastDamage, scene.maxHp)).toBe(false);
            // The played spreads have no error at the hit; priced with the item that was gone they do.
            const defenderKey = keyOf('p2', setup.defender.species);
            expect(observationError(ctx, last, defenderKey, spreadFor(ctx, 'p2', setup.defender.species))).toBe(0);
            expect(observationError(ctx, stale(last), defenderKey, spreadFor(ctx, 'p2', setup.defender.species))).toBeGreaterThan(0);
          }
        });
      }

      if (!kind.startsWith('champions')) test(`${kind}: an item the log has not shown stays the set's (the Knock Off itself hits the Eviolite holder)`, () => {
        for (const scene of scenesOf(kind, KNOCK_OFF, 4)) {
          const observations = hitsOf(scene, KNOCK_OFF);
          expect(itemFields(observations[0])).toEqual({ attackerItem: '', defenderItem: '', attackerItemChanged: false, defenderItemChanged: false });
          const ctx = contextOf(kind, KNOCK_OFF, observations);
          // Knock Off hits 1.5 times harder while the target holds an item: the set's Eviolite is what the first line is priced with.
          expect(containsDamage(ctx, KNOCK_OFF, readOf(ctx, KNOCK_OFF, 0), scene.damage[0], scene.maxHp)).toBe(true);
        }
      });

      if (!kind.startsWith('champions')) test(`${kind}: a berry that weakens the hit counts for that hit and is gone for the next`, () => {
        for (const scene of scenesOf(kind, BERRY, 4)) {
          const observations = hitsOf(scene, BERRY);
          expect(scene.log.indexOf('|-enditem|p2a: Blissey|Chilan Berry')).toBeLessThan(scene.log.indexOf('|-damage|p2a: Blissey'));
          expect(itemFields(observations[0])).toMatchObject({ defenderItem: 'chilanberry', defenderItemChanged: false });
          expect(itemFields(observations[1])).toMatchObject({ defenderItem: '', defenderItemChanged: true });
          const ctx = contextOf(kind, BERRY, observations);
          expect(containsDamage(ctx, BERRY, readOf(ctx, BERRY, 0), scene.damage[0], scene.maxHp)).toBe(true);
        }
      });
    }
  });

  describe('the observation names the item at the hit (T191)', () => {
    const observationsOf = (setup: Setup, kind: Kind) => hitsOf(scenesOf(kind, setup, 1)[0], setup);

    for (const kind of KINDS) {
      test(`${kind}: a popped Air Balloon is shown, then gone`, () => {
        const [claw, quake] = observationsOf(BALLOON, kind);
        expect(itemFields(claw)).toEqual({ attackerItem: '', defenderItem: 'airballoon', attackerItemChanged: false, defenderItemChanged: false });
        expect(itemFields(quake)).toEqual({ attackerItem: '', defenderItem: '', attackerItemChanged: false, defenderItemChanged: true });
      });

      test(`${kind}: a Trick gives the attacker the item the log shows it took`, () => {
        const [shadowBall] = observationsOf(TRICK, kind);
        expect(itemFields(shadowBall)).toEqual({
          attackerItem: 'wiseglasses', defenderItem: 'choicespecs', attackerItemChanged: true, defenderItemChanged: true,
        });
      });
    }
  });
});
