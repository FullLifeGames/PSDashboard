import './champions-mod';
import { describe, expect, test } from 'vitest';
import { parseReplayLogWithObservations } from '../src/protocol-parser';
import {
  buildSolveContext,
  keyOf,
  observationError,
  rollRange,
  spreadFor,
  type SolveContext,
  speedStat,
} from '../src/spreads/fit';
import type { ReadObservation } from '../src/spreads/observation-read';
import type { DamageObservation, PokemonEvs, SpeedOrderObservation } from '../src/types';
import {
  FORMAT,
  damagingTurns,
  isDoubles,
  scaled,
  scenesOf,
  set,
  type FieldScene,
  type Kind,
  type Scene,
  alone,
  hit,
  splash,
  team,
  playScene,
} from './fit-field-scenes';
import { Generations, Move, Pokemon, calculate } from '@smogon/calc';
import type { PokemonSet } from '@pkmn/sim';
import { buildTeamsFromReplay } from '../src/team-builder';
import { inferSpreads } from '../src/spread-inference';
import { evBudget } from '../src/spreads/ev-budget';
import { hpEvsForMaxHp } from '../src/spreads/max-hp';
import { readableOrders } from '../src/spreads/order-limit';
import { decideScarfs, type SpeedKnowledge } from '../src/spreads/scarf';
import type { SmogonSetAssumptions } from '../src/smogon/sets-lookup';
import { toId } from '../src/ids';
import { rulesDex } from '../src/rules-dex';

// The Dex gives the calculator Last Respects and Rage Fist at the plain 50; the Champions roster has neither's users.

const GARCHOMP = () => set('Garchomp', '', 'Rough Skin', ['Crunch', 'Dragon Claw', 'Splash'], 'Hardy', { hp: 252, def: 252, spd: 4 });
const DRAGONITE = () => set('Dragonite', '', 'Inner Focus', ['Crunch', 'Dragon Claw', 'Splash'], 'Hardy', { hp: 252 });
const FODDER = (nickname: string) => ({ ...set('Shedinja', '', 'Wonder Guard', ['Splash'], 'Hardy', {}), name: nickname });
const BASCULEGION = () => set('Basculegion', '', 'Swift Swim', ['Last Respects', 'Splash'], 'Adamant', { hp: 252, atk: 252 });
const ANNIHILAPE = () => set('Annihilape', '', 'Defiant', ['Rage Fist', 'Splash'], 'Adamant', { hp: 252, atk: 252 });
const BLISSEY = () => set('Blissey', '', 'Natural Cure', ['Splash'], 'Calm', { hp: 252, spd: 252 });

const LAST_RESPECTS: FieldScene = {
  title: 'Last Respects after two fallen',
  p1: doubles => (doubles ? [FODDER('Shed1'), FODDER('Shed2'), BASCULEGION(), BLISSEY()] : [FODDER('Shed1'), FODDER('Shed2'), BASCULEGION()]),
  p2: doubles => (doubles ? [GARCHOMP(), DRAGONITE()] : [GARCHOMP()]),
  attacker: 'Basculegion', defender: 'Garchomp',
  steps: doubles => (doubles
    ? [
      { p1: 'move splash, move splash', p2: 'move crunch 1, move crunch 2' },
      { p1: 'switch 3, switch 4' },
      { p1: 'move lastrespects 1, move splash', p2: 'move splash, move splash' },
    ]
    : [
      { p1: 'move splash', p2: 'move crunch' },
      { p1: 'switch 2' },
      { p1: 'move splash', p2: 'move crunch' },
      { p1: 'switch 3' },
      { p1: 'move lastrespects', p2: 'move splash' },
    ]),
  kinds: ['singles', 'doubles'],
};

const RAGE_FIST: FieldScene = {
  title: 'Rage Fist after two hits taken',
  p1: doubles => (doubles ? [ANNIHILAPE(), BLISSEY()] : [ANNIHILAPE()]),
  p2: doubles => (doubles ? [GARCHOMP(), DRAGONITE()] : [GARCHOMP()]),
  attacker: 'Annihilape', defender: 'Garchomp',
  steps: doubles => (doubles
    ? [
      { p1: 'move splash, move splash', p2: 'move dragonclaw 1, move splash' },
      { p1: 'move splash, move splash', p2: 'move dragonclaw 1, move splash' },
      { p1: 'move ragefist 1, move splash', p2: 'move splash, move splash' },
    ]
    : [
      { p1: 'move splash', p2: 'move dragonclaw' },
      { p1: 'move splash', p2: 'move dragonclaw' },
      { p1: 'move ragefist', p2: 'move splash' },
    ]),
  kinds: ['singles', 'doubles'],
};

const SCENES = [LAST_RESPECTS, RAGE_FIST];

const bodyOf = (scene: FieldScene, kind: Kind, side: 'p1' | 'p2', species: string) =>
  scaled((side === 'p1' ? scene.p1 : scene.p2)(isDoubles(kind)).find(body => body.species === species)!, kind);

function contextOf(scene: FieldScene, kind: Kind, observations: DamageObservation[]): SolveContext {
  return buildSolveContext(observations, { p1: [bodyOf(scene, kind, 'p1', scene.attacker)], p2: [bodyOf(scene, kind, 'p2', scene.defender)] }, FORMAT[kind], []);
}

function hitsOf(scene: FieldScene, played: Scene): DamageObservation[] {
  const found = parseReplayLogWithObservations(played.log).observations.filter(obs => obs.defenderSpecies === scene.defender && obs.attackerSpecies === scene.attacker);
  expect(found.length).toBeGreaterThan(0);
  return found;
}

function containsDamage(ctx: SolveContext, scene: FieldScene, obs: ReadObservation, damage: number, maxHp: number): boolean {
  const range = rollRange(ctx, obs, spreadFor(ctx, 'p1', scene.attacker), spreadFor(ctx, 'p2', scene.defender));
  expect(range).not.toBeNull();
  return Math.round(range!.min * maxHp) <= damage && damage <= Math.round(range!.max * maxHp);
}

const stale = (obs: ReadObservation): ReadObservation => {
  const rest: Record<string, unknown> = { ...obs };
  delete rest.attackerFainted;
  delete rest.attackerTimesAttacked;
  return rest as unknown as ReadObservation;
};

describe('a history power reaches the calculator through the Dex callback', () => {
  for (const scene of SCENES) {
    for (const kind of scene.kinds) {
      test(`${kind}: ${scene.title}`, () => {
        const scenes = scenesOf(kind, scene, 3);
        expect(scenes.length).toBeGreaterThanOrEqual(2);
        for (const played of scenes) {
          const observations = hitsOf(scene, played);
          const ctx = contextOf(scene, kind, observations);
          const reads = ctx.byMon.get(keyOf('p2', scene.defender)) ?? [];
          expect(reads).toHaveLength(observations.length);
          const damage = damagingTurns(played).at(-1)!;
          const obs = reads.at(-1)!;
          expect(containsDamage(ctx, scene, obs, damage, played.maxHp), `the history hit sim ${damage}`).toBe(true);
          expect(observationError(ctx, obs, keyOf('p2', scene.defender), spreadFor(ctx, 'p2', scene.defender))).toBe(0);
          expect(containsDamage(ctx, scene, stale(obs), damage, played.maxHp), 'the stale reading prices the plain 50').toBe(false);
        }
      });
    }
  }

  test('the observation carries the two counts, and only when they are above zero', () => {
    const [lastRespects] = scenesOf('singles', LAST_RESPECTS, 1);
    expect(hitsOf(LAST_RESPECTS, lastRespects).at(-1)).toMatchObject({ attackerFainted: 2 });
    const [rageFist] = scenesOf('singles', RAGE_FIST, 1);
    expect(hitsOf(RAGE_FIST, rageFist).at(-1)).toMatchObject({ attackerTimesAttacked: 2 });
    const [plain] = scenesOf('singles', RAGE_FIST, 1);
    expect(hitsOf(RAGE_FIST, plain)[0].attackerFainted).toBeUndefined();
  });
});

const gen = Generations.get(9);
type Side = 'p1' | 'p2';
const sp = (hp: number, atk: number, def: number, spa: number, spd: number, spe: number): PokemonEvs => ({ hp, atk, def, spa, spd, spe });
const ALL_31 = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };
const mon = (species: string, nature: string, spread: PokemonEvs, extra: Partial<PokemonSet> = {}): PokemonSet => ({
  name: species, species, item: '', ability: '', moves: ['Protect'], nature, evs: spread, ivs: { ...ALL_31 }, level: 50, gender: '', ...extra,
});
const race = (first: Side, firstSpecies: string, second: Side, secondSpecies: string, turn = 1): SpeedOrderObservation =>
  ({ firstSide: first, firstSpecies, secondSide: second, secondSpecies, turn });
const knowledge = (entries: Record<string, Partial<SpeedKnowledge>>): Map<string, SpeedKnowledge> =>
  new Map(Object.entries(entries).map(([key, value]) => [key, { itemKnown: false, scarfRuledOut: false, spreadKnown: false, spreads: [], ...value }]));
const calcEvs = (spread: PokemonEvs) => Object.fromEntries(Object.entries(spread).map(([stat, value]) => [stat, value >= 1 ? 8 * value - 4 : 0]));

const CHAMPIONS = { singles: 'gen9championsou', doubles: 'gen9championsvgc2026regmcbo3' } as const;

describe('the spread solver reads Champions Stat Points', () => {
  for (const [kind, format] of Object.entries(CHAMPIONS)) {
    test(`each Stat Point is one stat point, and the set's IVs do not count (${kind})`, () => {
      // A published Speed IV of 0 means nothing in Champions (statModify reads no IV).
      const sets = { p1: [mon('Garchomp', 'Hardy', sp(0, 0, 0, 0, 0, 0), { ivs: { ...ALL_31, spe: 0 } })], p2: [] };
      const ctx = buildSolveContext([], sets, format, []);
      const at = (points: number) => speedStat(ctx, 'p1', 'Garchomp', { evs: sp(0, 0, 0, 0, 0, points), nature: 'Hardy' });
      expect(at(0)).toBe(122);
      for (let points = 0; points <= 32; points++) expect(at(points)).toBe(122 + points);
    });

    test(`damage lines read both bodies on the Stat Point scale (${kind})`, () => {
      const attacker = mon('Garchomp', 'Adamant', sp(0, 32, 0, 0, 2, 32), { moves: ['Rock Slide'] });
      const defender = mon('Corviknight', 'Impish', sp(32, 0, 32, 0, 2, 0), { moves: ['Roost'] });
      const a = new Pokemon(gen, 'Garchomp', { level: 50, nature: 'Adamant', evs: calcEvs(attacker.evs), ivs: ALL_31 });
      const d = new Pokemon(gen, 'Corviknight', { level: 50, nature: 'Impish', evs: calcEvs(defender.evs), ivs: ALL_31 });
      const rolls = (calculate(gen, a, d, new Move(gen, 'Rock Slide')).damage as number[]).flat().map(Number);
      const observation: DamageObservation = {
        attackerSpecies: 'Garchomp', defenderSpecies: 'Corviknight', attackerSide: 'p1', moveId: 'rockslide',
        observedFraction: rolls[0] / d.maxHP(), lethal: false, attackerBoosts: {}, defenderBoosts: {}, attackerStatus: '', screens: [], weather: '',
      };
      const ctx = buildSolveContext([observation], { p1: [attacker], p2: [defender] }, format, []);
      expect(observationError(ctx, observation, 'p1:garchomp', { evs: attacker.evs, nature: 'Adamant' })).toBe(0);
    });

    test(`a settled order steps one Stat Point (${kind})`, () => {
      // Charizard at 14 SP is 134; Garchomp is 122 at 0 SP and +1 per SP: 13 SP (135) is the smallest Speed that wins.
      const sets = { p1: [mon('Garchomp', 'Hardy', sp(32, 32, 0, 0, 2, 0))], p2: [mon('Charizard', 'Hardy', sp(0, 0, 0, 32, 2, 14))] };
      const solved = inferSpreads([], sets, format, [race('p1', 'Garchomp', 'p2', 'Charizard')], knowledge({ 'p2:charizard': { spreadKnown: true } }));
      expect(solved.get('p1:garchomp')?.evs.spe).toBe(13);
    });

    test(`a Champions solve never lowers a Speed IV (${kind})`, () => {
      // Heracross (known, 105) moved before Garchomp, whose slowest legal Speed is Brave 0 SP (109). Scarlet/Violet
      // would lower Garchomp's Speed IV; Champions has no IVs to lower, so the order stays unexplained.
      const sets = { p1: [mon('Heracross', 'Hardy', sp(32, 32, 0, 0, 2, 0))], p2: [mon('Garchomp', 'Jolly', sp(2, 32, 0, 0, 0, 32))] };
      const solved = inferSpreads([], sets, format, [race('p1', 'Heracross', 'p2', 'Garchomp')], knowledge({ 'p1:heracross': { spreadKnown: true } }));
      expect(solved.get('p2:garchomp')?.ivs).toBeUndefined();
    });

    test(`a Champions usage spread counts as tempo-invested on its own scale (${kind})`, () => {
      const sets = { p1: [mon('Garchomp', 'Jolly', sp(2, 32, 0, 0, 0, 32))], p2: [mon('Dragapult', 'Timid', sp(2, 0, 0, 32, 0, 32))] };
      const orders = readableOrders([race('p1', 'Garchomp', 'p2', 'Dragapult')], sets, rulesDex(9, 'champions'));
      const ctx = buildSolveContext([], sets, format, orders);
      const decisions = decideScarfs(ctx, knowledge({
        'p1:garchomp': { spreads: [{ nature: 'Jolly', evs: sp(2, 32, 0, 0, 0, 32), probability: 1 }] },
        'p2:dragapult': { spreadKnown: true },
      }));
      expect(decisions.get('p1:garchomp')).toBe('holds');
    });
  }

  test('max HP inverts on the Stat Point scale', () => {
    // Garchomp, base HP 108: 215 HP is 32 SP (108 + 32 + 75), 183 HP is 0 SP.
    expect(hpEvsForMaxHp(108, 50, 215, 0, 31, evBudget('gen9championsou'))).toBe(32);
    expect(hpEvsForMaxHp(108, 50, 183, 32, 31, evBudget('gen9championsou'))).toBe(0);
    expect(hpEvsForMaxHp(108, 50, 200, 0, 31, evBudget('gen9championsou'))).toBe(17);
    // Level 100: 2 x 108 + 31 + 110 + EVs / 4 = 409 gives 208 EVs.
    expect(hpEvsForMaxHp(108, 100, 409, 0)).toBe(208);
  });
});

describe('a Champions build stays on the Stat Point scale', () => {
  const logOf = (kind: 'singles' | 'doubles') => [
    '|player|p1|Alice|1|', '|player|p2|Bob|2|', `|gametype|${kind}`, '|gen|9',
    kind === 'singles' ? '|tier|[Gen 9 Champions] OU' : '|tier|[Gen 9 Champions] VGC 2026 Reg M-B (Bo3)',
    '|poke|p1|Corviknight, L50, M|', '|poke|p1|Garchomp, L50, M|', '|poke|p2|Kingambit, L50, M|', '|start',
    '|switch|p1a: Corviknight|Corviknight, L50, M|100/100', '|switch|p2a: Kingambit|Kingambit, L50, M|100/100', '|turn|1',
  ].join('\n');
  const assumptions = (spread: PokemonEvs, ivs?: Partial<PokemonEvs>): SmogonSetAssumptions => ({
    format: 'test', source: 'test', pokemon: {
      corviknight: {
        species: 'Corviknight', sourceDetail: 'test', moves: [{ value: 'Body Press', sourceDetail: 'test' }],
        spread: { value: 'Impish', sourceDetail: 'test', nature: 'Impish', evs: spread }, ...(ivs ? { ivs } : {}),
      },
    },
  });
  const built = (kind: 'singles' | 'doubles', setAssumptions: SmogonSetAssumptions, species: string) =>
    buildTeamsFromReplay(logOf(kind), { setAssumptions }).p1Team.find(set => toId(set.species) === toId(species))!;

  for (const kind of ['singles', 'doubles'] as const) {
    test(`a Scarlet/Violet spread reaches the Stat Point scale by the inverse, IVs stay 31 (${kind})`, () => {
      const corviknight = built(kind, assumptions(sp(252, 0, 160, 0, 96, 0), { spe: 0 }), 'Corviknight');
      expect(corviknight.evs).toEqual(sp(32, 0, 20, 0, 12, 0));
      expect(corviknight.ivs).toEqual(ALL_31);
    });

    test(`a Stat Point spread stays as published (${kind})`, () => {
      expect(built(kind, assumptions(sp(32, 0, 32, 0, 2, 0)), 'Corviknight').evs).toEqual(sp(32, 0, 32, 0, 2, 0));
    });

    test(`the no-data default reaches the Stat Point scale too (${kind})`, () => {
      expect(built(kind, assumptions(sp(32, 0, 32, 0, 2, 0)), 'Garchomp').evs).toEqual(sp(0, 32, 0, 0, 1, 32));
    });
  }
});

describe('hit-history-ally', () => {
  const BLISSEY = () => set('Blissey', '', 'Natural Cure', ['Splash'], 'Calm', { hp: 252, spd: 252 });
  const CHANSEY = () => set('Chansey', '', 'Natural Cure', ['Splash'], 'Calm', { hp: 252 });
  const user = (species: string, ability: string) => set(species, '', ability, ['Thunderbolt', 'Splash'], 'Modest', { hp: 252, spa: 252 });
  const partner = (species: string, ability: string) => set(species, '', ability, ['Splash'], 'Hardy', { hp: 252 });

  interface AllyScene extends FieldScene {
    solverSets: () => { p1: PokemonSet[]; p2: PokemonSet[] };
    boosted: boolean;
  }

  const sceneOf = (title: string, kinds: Kind[], lead: PokemonSet, ally: (() => PokemonSet) | null, boosted: boolean): AllyScene => ({
    title, kinds, boosted,
    p1: doubles => [lead, ...(doubles ? [ally ? ally() : CHANSEY()] : [])],
    p2: doubles => [BLISSEY(), ...(doubles ? [CHANSEY()] : [])],
    attacker: lead.species, defender: 'Blissey',
    steps: doubles => [{ p1: doubles ? 'move thunderbolt 1, move splash' : 'move thunderbolt', p2: doubles ? 'move splash, move splash' : 'move splash' }],
    solverSets: () => ({ p1: ally && ally().species ? [lead, ally()] : [lead], p2: [BLISSEY()] }),
  });

  const SCENES: AllyScene[] = [
    sceneOf('Plus beside Minus (Minun has two abilities: its set decides)', ['doubles'], user('Plusle', 'Plus'), () => partner('Minun', 'Minus'), true),
    sceneOf('Plus beside Plus (Plusle has the one ability slot)', ['doubles'], user('Plusle', 'Plus'), () => partner('Plusle', 'Plus'), true),
    sceneOf('Minus beside Plus', ['doubles'], user('Minun', 'Minus'), () => partner('Plusle', 'Plus'), true),
    sceneOf('Plus beside a partner without Plus or Minus', ['doubles'], user('Plusle', 'Plus'), null, false),
    sceneOf('Plus alone in singles', ['singles'], user('Plusle', 'Plus'), null, false),
    sceneOf('Plus beside Minus in the Champions roster (Ampharos and Manectric)', ['champions doubles'], user('Ampharos', 'Plus'), () => partner('Manectric', 'Minus'), true),
  ];

  const bodyOf = (sets: PokemonSet[], kind: Kind) => sets.map(body => scaled(body, kind));

  function contextOf(scene: AllyScene, kind: Kind, observations: DamageObservation[]): SolveContext {
    const sets = scene.solverSets();
    return buildSolveContext(observations, { p1: bodyOf(sets.p1, kind), p2: bodyOf(sets.p2, kind) }, FORMAT[kind], []);
  }

  function hitsOf(scene: AllyScene, played: Scene): DamageObservation[] {
    const found = parseReplayLogWithObservations(played.log).observations.filter(obs => obs.defenderSpecies === scene.defender && obs.attackerSpecies === scene.attacker);
    expect(found.length).toBeGreaterThan(0);
    return found;
  }

  function containsDamage(ctx: SolveContext, scene: AllyScene, obs: ReadObservation, damage: number, maxHp: number): boolean {
    const range = rollRange(ctx, obs, spreadFor(ctx, 'p1', scene.attacker), spreadFor(ctx, 'p2', scene.defender));
    expect(range).not.toBeNull();
    return Math.round(range!.min * maxHp) <= damage && damage <= Math.round(range!.max * maxHp);
  }

  const withoutAlly = (obs: ReadObservation): ReadObservation => {
    const rest: Record<string, unknown> = { ...obs };
    delete rest.attackerAlly;
    delete rest.attackerAllyAbility;
    return rest as unknown as ReadObservation;
  };

  describe('an ally with Plus or Minus switches the user\'s ability on', () => {
    for (const scene of SCENES) {
      for (const kind of scene.kinds) {
        test(`${kind}: ${scene.title}`, () => {
          const scenes = scenesOf(kind, scene, 3);
          expect(scenes.length).toBeGreaterThanOrEqual(2);
          for (const played of scenes) {
            const ctx = contextOf(scene, kind, hitsOf(scene, played));
            const reads = ctx.byMon.get(keyOf('p2', scene.defender)) ?? [];
            const damages = damagingTurns(played);
            expect(reads).toHaveLength(damages.length);
            reads.forEach((obs, index) => {
              expect(containsDamage(ctx, scene, obs, damages[index], played.maxHp), `hit ${index + 1}: sim ${damages[index]}`).toBe(true);
              expect(observationError(ctx, obs, keyOf('p2', scene.defender), spreadFor(ctx, 'p2', scene.defender))).toBe(0);
            });
            const misses = reads.some((obs, index) => !containsDamage(ctx, scene, withoutAlly(obs), damages[index], played.maxHp));
            expect(misses, 'the reading without the ally').toBe(scene.boosted);
          }
        });
      }
    }
  });
});

describe('hit-history-turn', () => {
  const DRAGONITE = () => set('Dragonite', '', 'Inner Focus', ['Splash'], 'Jolly', { hp: 252, spe: 252 });
  const FAST = () => set('Regieleki', '', 'Transistor', ['Splash'], 'Timid', { spe: 252 });
  const SKARMORY = () => set('Skarmory', '', 'Sturdy', ['Splash'], 'Impish', { hp: 252, def: 252 });

  interface Kit { species: string; ability: string; hits: string[]; priority: string }
  const STAKEOUT: Kit = { species: 'Gumshoos', ability: 'Stakeout', hits: ['Body Slam', 'Splash'], priority: 'Quick Attack' };
  const ANALYTIC_GEN9: Kit = { species: 'Magnezone', ability: 'Analytic', hits: ['Iron Head', 'Splash'], priority: 'Bullet Punch' };
  const ANALYTIC_CHAMPIONS: Kit = { species: 'Watchog', ability: 'Analytic', hits: ['Body Slam', 'Splash'], priority: 'Quick Attack' };

  const attackerOf = (kit: Kit, ...extra: string[]) => set(kit.species, '', kit.ability, [...kit.hits, kit.priority, ...extra], 'Adamant', { hp: 252, atk: 252 });

  const stakeout = (kinds: Kind[]): FieldScene => ({
    title: 'Stakeout on the turn the target came in, and the turn after',
    p1: team(attackerOf(STAKEOUT)),
    p2: doubles => (doubles ? [DRAGONITE(), set('Chansey', '', 'Natural Cure', ['Splash'], 'Calm', { hp: 252 }), SKARMORY()] : [DRAGONITE(), SKARMORY()]),
    attacker: 'Gumshoos', defender: 'Skarmory',
    steps: doubles => [
      { p1: alone(doubles, hit(doubles, 'Splash')), p2: alone(doubles, splash()) },
      { p1: alone(doubles, hit(doubles, 'Body Slam')), p2: doubles ? 'switch 3, move splash' : 'switch 2' },
      { p1: alone(doubles, hit(doubles, 'Body Slam')), p2: alone(doubles, splash()) },
    ],
    kinds, hitLine: true,
  });

  const analytic = (kit: Kit, kinds: Kind[], priority: boolean): FieldScene => ({
    title: `Analytic ${priority ? 'moving first on priority' : 'moving last'} (${kit.species})`,
    p1: doubles => [attackerOf(kit), ...(doubles ? [FAST()] : [])],
    p2: doubles => [DRAGONITE(), ...(doubles ? [FAST()] : [])],
    attacker: kit.species, defender: 'Dragonite',
    steps: doubles => [{ p1: alone(doubles, hit(doubles, priority ? kit.priority : kit.hits[0])), p2: alone(doubles, splash()) }],
    kinds, hitLine: true,
  });

  const bodyOf = (scene: FieldScene, kind: Kind, side: 'p1' | 'p2', species: string) =>
    scaled((side === 'p1' ? scene.p1 : scene.p2)(isDoubles(kind)).find(body => body.species === species)!, kind);

  function contextOf(scene: FieldScene, kind: Kind, observations: DamageObservation[]): SolveContext {
    return buildSolveContext(observations, { p1: [bodyOf(scene, kind, 'p1', scene.attacker)], p2: [bodyOf(scene, kind, 'p2', scene.defender)] }, FORMAT[kind], []);
  }

  function hitsOf(scene: FieldScene, played: Scene): DamageObservation[] {
    const found = parseReplayLogWithObservations(played.log).observations.filter(obs => obs.defenderSpecies === scene.defender && obs.attackerSpecies === scene.attacker);
    expect(found.length).toBeGreaterThan(0);
    return found;
  }

  function containsDamage(ctx: SolveContext, scene: FieldScene, obs: ReadObservation, damage: number, maxHp: number): boolean {
    const range = rollRange(ctx, obs, spreadFor(ctx, 'p1', scene.attacker), spreadFor(ctx, 'p2', scene.defender));
    expect(range).not.toBeNull();
    return Math.round(range!.min * maxHp) <= damage && damage <= Math.round(range!.max * maxHp);
  }

  const flipped = (obs: ReadObservation): ReadObservation => {
    const rest: Record<string, unknown> = { ...obs };
    delete rest.defenderNewlyIn;
    delete rest.lastToMove;
    return { ...(rest as unknown as ReadObservation), ...(obs.defenderNewlyIn ? {} : { defenderNewlyIn: true }), ...(obs.lastToMove ? {} : { lastToMove: true }) };
  };

  const GEN9: Kind[] = ['singles', 'doubles'];
  const CHAMPIONS: Kind[] = ['champions singles', 'champions doubles'];

  const CASES: FieldScene[] = [
    stakeout(GEN9),
    analytic(ANALYTIC_GEN9, GEN9, false),
    analytic(ANALYTIC_CHAMPIONS, CHAMPIONS, false),
    analytic(ANALYTIC_GEN9, GEN9, true),
    analytic(ANALYTIC_CHAMPIONS, CHAMPIONS, true),
  ];

  describe('the turn facts of the hit set the ability\'s state', () => {
    for (const scene of CASES) {
      for (const kind of scene.kinds) {
        test(`${kind}: ${scene.title}`, () => {
          const scenes = scenesOf(kind, scene, 3);
          expect(scenes.length).toBeGreaterThanOrEqual(2);
          for (const played of scenes) {
            const ctx = contextOf(scene, kind, hitsOf(scene, played));
            const reads = ctx.byMon.get(keyOf('p2', scene.defender)) ?? [];
            const damages = damagingTurns(played);
            expect(reads).toHaveLength(damages.length);
            reads.forEach((obs, index) => {
              expect(containsDamage(ctx, scene, obs, damages[index], played.maxHp), `hit ${index + 1}: sim ${damages[index]}`).toBe(true);
              expect(observationError(ctx, obs, keyOf('p2', scene.defender), spreadFor(ctx, 'p2', scene.defender))).toBe(0);
            });
            const misses = reads.some((obs, index) => !containsDamage(ctx, scene, flipped(obs), damages[index], played.maxHp));
            expect(misses, 'the opposite facts miss a hit').toBe(true);
          }
        });
      }
    }

    test('the facts are booked only when true', () => {
      const [played] = scenesOf('singles', stakeout(GEN9), 1);
      const [boosted, later] = hitsOf(stakeout(GEN9), played);
      expect(boosted.defenderNewlyIn).toBe(true);
      expect(later.defenderNewlyIn).toBeUndefined();
      const [first] = scenesOf('singles', analytic(ANALYTIC_GEN9, GEN9, true), 1);
      expect(hitsOf(analytic(ANALYTIC_GEN9, GEN9, true), first)[0].lastToMove).toBeUndefined();
      const [last] = scenesOf('singles', analytic(ANALYTIC_GEN9, GEN9, false), 1);
      expect(hitsOf(analytic(ANALYTIC_GEN9, GEN9, false), last)[0].lastToMove).toBe(true);
    });
  });
});

describe('survival-marker-observation', () => {
  const KINDS: Kind[] = ['singles', 'doubles'];
  const GARCHOMP = () => set('Garchomp', '', 'Rough Skin', ['Drill Run', 'Splash'], 'Jolly', { atk: 252, spe: 252 });
  const BLISSEY = () => set('Blissey', '', 'Natural Cure', ['Splash'], 'Calm', { hp: 252 });
  const CHANSEY = () => set('Chansey', '', 'Natural Cure', ['Splash'], 'Calm', { hp: 252 });

  function drillRun(title: string, defender: ReturnType<typeof set>, answer = 'move splash'): FieldScene {
    return {
      title,
      p1: doubles => [GARCHOMP(), ...(doubles ? [BLISSEY()] : [])],
      p2: doubles => [defender, ...(doubles ? [CHANSEY()] : [])],
      attacker: 'Garchomp', defender: defender.species,
      steps: doubles => [{ p1: alone(doubles, hit(doubles, 'Drill Run')), p2: alone(doubles, answer) }],
      kinds: KINDS,
    };
  }

  const SASH = drillRun('a Focus Sash holder at full HP', set('Gengar', 'Focus Sash', 'Cursed Body', ['Splash'], 'Timid', {}));
  const STURDY = drillRun('Sturdy at full HP', set('Magnezone', '', 'Sturdy', ['Splash'], 'Timid', {}));
  const ENDURE = drillRun('Endure', set('Gengar', '', 'Cursed Body', ['Endure'], 'Timid', {}), 'move endure');
  const NO_MARKER = drillRun('the same hit without a marker', set('Gengar', '', 'Cursed Body', ['Splash'], 'Timid', {}));
  const BERRY = drillRun('a berry that weakens the hit', set('Gengar', 'Shuca Berry', 'Cursed Body', ['Splash'], 'Timid', {}));

  function observationOf(kind: Kind, scene: FieldScene): DamageObservation {
    for (let seed = 1; seed <= 200; seed++) {
      const played = playScene(kind, scene, seed);
      if (played.reject && played.reject !== 'fainted') continue;
      const found = parseReplayLogWithObservations(played.log).observations.filter(obs => obs.moveId === 'drillrun');
      if (found.length === 1) return found[0];
    }
    throw new Error(`no clean battle of ${scene.title} on ${kind}`);
  }

  describe('a hit the defender survives at 1 HP through a marker is a lower bound', () => {
    for (const kind of KINDS) {
      for (const scene of [SASH, STURDY, ENDURE]) {
        test(`${kind}: ${scene.title}`, () => {
          const obs = observationOf(kind, scene);
          expect(obs.observedFraction).toBeCloseTo(0.99, 5);
          expect(obs.lethal).toBe(true);
        });
      }

      test(`${kind}: a knock-out without a marker is a lower bound, as before`, () => {
        const obs = observationOf(kind, NO_MARKER);
        expect(obs.observedFraction).toBe(1);
        expect(obs.lethal).toBe(true);
      });

      test(`${kind}: a marker with most of the HP left stays a reading`, () => {
        const obs = observationOf(kind, BERRY);
        expect(obs.defenderItem).toBe('shucaberry');
        expect(obs.observedFraction).toBeGreaterThan(0.3);
        expect(obs.observedFraction).toBeLessThan(0.9);
        expect(obs.lethal).toBe(false);
      });
    }
  });

  describe('the solver reads the surviving hit as a lower bound', () => {
    for (const kind of KINDS) {
      test(`${kind}: the played spreads have error 0 and the attacker keeps its offense`, () => {
        const doubles = isDoubles(kind);
        const observations = [SASH, STURDY].map(scene => observationOf(kind, scene));
        const teams = { p1: [GARCHOMP(), ...(doubles ? [BLISSEY()] : [])], p2: [SASH.p2(doubles)[0], STURDY.p2(doubles)[0]] };
        const ctx = buildSolveContext(observations, teams, FORMAT[kind], []);
        for (const obs of observations) {
          const range = rollRange(ctx, ctx.byMon.get(keyOf('p2', obs.defenderSpecies))![0], spreadFor(ctx, 'p1', 'Garchomp'), spreadFor(ctx, 'p2', obs.defenderSpecies))!;
          expect(range.min, obs.defenderSpecies).toBeGreaterThan(obs.observedFraction);
          expect(observationError(ctx, ctx.byMon.get(keyOf('p2', obs.defenderSpecies))![0], keyOf('p2', obs.defenderSpecies), spreadFor(ctx, 'p2', obs.defenderSpecies)), obs.defenderSpecies).toBe(0);
        }
        const solved = inferSpreads(observations, teams, FORMAT[kind], []).get(keyOf('p1', 'Garchomp'));
        expect(solved?.evs.atk ?? 252, 'the offense the lines cannot measure').toBe(252);
      });
    }
  });
});
