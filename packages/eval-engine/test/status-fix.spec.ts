import { afterEach, describe, expect, test } from 'vitest';
import { PRNG, type Battle, type PokemonSet } from '@pkmn/sim';
import { evalFeatures, evaluatePosition, featureWeights, createMatchupCache, EVAL_WEIGHTS, type EvalFeatures } from '../src/eval-function';
import { removalFormat } from '../src/score/boost-bite';
import { setStaticForm } from '../src/score/phase-form';
import { statusByChance, statusRight } from '../src/score/status-factor';
import { loadSimMods } from '../src/forward/sim-mods';
import { set } from './move-oracle';
import { battleOf } from './power-oracle';

await loadSimMods('gen9championscustomgame');

const SINGLES = 'gen9customgame';
const DOUBLES = 'gen9doublescustomgame';
const CHAMPIONS = 'gen9championscustomgame';
const CHAMPIONS_DOUBLES = 'gen9championsdoublescustomgame';
const STATUSES = ['brn', 'par', 'psn', 'tox'] as const;
const SEEDS: [number, number, number, number][] = [[1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, 16], [17, 18, 19, 20], [21, 22, 23, 24]];
const PHYSICAL = 'aerialace';
const SPECIAL = 'aurasphere';
const CHANNELS = ['residual', 'physOut', 'specOut', 'physIn', 'specIn', 'speed'] as const;
type Channel = (typeof CHANNELS)[number];
type Reading = Record<Channel, number>;

const SP = { hp: 32, atk: 32, def: 0, spa: 32, spd: 0, spe: 0 };
const body = (species: string, ability: string, moves: string[], champions: boolean): PokemonSet =>
  set(species, moves, champions ? { ability, evs: SP, level: 50 } : { ability, level: 100 });

const isDoubles = (format: string) => format === DOUBLES || format === CHAMPIONS_DOUBLES;
const isChampions = (format: string) => format === CHAMPIONS || format === CHAMPIONS_DOUBLES;

function turnOn(format: string, ability: string, status: string | null, choice: { mine: string; foe: string }, seed: number[]): { mine: number; foe: number; speed: number } | null {
  const doubles = isDoubles(format);
  const champions = isChampions(format);
  const moves = ['splash', PHYSICAL, SPECIAL];
  const mineTeam = [body('Snorlax', ability, moves, champions), ...(doubles ? [body('Snorlax', 'No Ability', moves, champions)] : [])];
  const foeTeam = [body('Registeel', 'No Ability', moves, champions), ...(doubles ? [body('Registeel', 'No Ability', moves, champions)] : [])];
  const battle = battleOf(format, mineTeam, foeTeam);
  const mine = battle.sides[0].active[0]!;
  const foe = battle.sides[1].active[0]!;
  if (status && (!mine.setStatus(status, null, null, true) || mine.status !== status)) return null;
  // 70 % HP: a terrain's heal shows, and Berserk and Defeatist stay on one side of half.
  for (const mon of [mine, foe]) mon.hp = Math.ceil(0.7 * mon.maxhp);
  const speed = mine.getActionSpeed();
  battle.prng = new PRNG(seed);
  const [mineHp, foeHp] = [mine.hp, foe.hp];
  const pick = (move: string) => (doubles ? `${move}, move 1` : move);
  battle.choose('p1', pick(choice.mine));
  battle.choose('p2', pick(choice.foe));
  return { mine: mine.hp - mineHp, foe: foe.hp - foeHp, speed };
}

const seeds = new Map<string, number[][]>();
function seedsOf(format: string, status: string | null): number[][] {
  const key = `${format}|${status}`;
  let usable = seeds.get(key);
  if (!usable) {
    const aimed = isDoubles(format) ? 'move 2 1' : 'move 2';
    usable = SEEDS.filter(candidate => {
      const turn = turnOn(format, 'noability', status, { mine: aimed, foe: 'move 1' }, candidate);
      const special = turnOn(format, 'noability', status, { mine: isDoubles(format) ? 'move 3 1' : 'move 3', foe: 'move 1' }, candidate);
      return !!turn && !!special && turn.foe < 0 && special.foe < 0;
    }).slice(0, 3);
    seeds.set(key, usable);
  }
  return usable.length > 0 ? usable : [SEEDS[0]];
}

function playedReading(format: string, ability: string, status: string | null, seedStatus: string | null): Reading | null {
  const readings = seedsOf(format, seedStatus).map(seed => readingOn(format, ability, status, seed));
  if (readings.some(reading => !reading)) return null;
  const median = (channel: Channel) => [...readings.map(reading => reading![channel])].sort((a, b) => a - b)[Math.floor(readings.length / 2)];
  return Object.fromEntries(CHANNELS.map(channel => [channel, median(channel)])) as Reading;
}

function readingOn(format: string, ability: string, status: string | null, seed: number[]): Reading | null {
  const aimed = (slot: number) => (isDoubles(format) ? `move ${slot} 1` : `move ${slot}`);
  const idle = turnOn(format, ability, status, { mine: 'move 1', foe: 'move 1' }, seed);
  const physOut = turnOn(format, ability, status, { mine: aimed(2), foe: 'move 1' }, seed);
  const specOut = turnOn(format, ability, status, { mine: aimed(3), foe: 'move 1' }, seed);
  const physIn = turnOn(format, ability, status, { mine: 'move 1', foe: aimed(2) }, seed);
  const specIn = turnOn(format, ability, status, { mine: 'move 1', foe: aimed(3) }, seed);
  if (!idle || !physOut || !specOut || !physIn || !specIn) return null;
  return {
    residual: idle.mine,
    physOut: -(physOut.foe - idle.foe),
    specOut: -(specOut.foe - idle.foe),
    physIn: physIn.mine - idle.mine,
    specIn: specIn.mine - idle.mine,
    speed: idle.speed,
  };
}

// Damage rolls move a whole turn by up to 15 % of a hit; an ability moves a channel by a third or more.
const tolerance = (value: number) => Math.max(0.18 * Math.abs(value), 3);

function playedRight(format: string, ability: string, status: string, applied: number): number {
  const baseHealthy = playedReading(format, 'noability', null, status)!;
  const baseStatused = playedReading(format, 'noability', status, status)!;
  const healthy = playedReading(format, ability, null, status);
  const statused = playedReading(format, ability, status, status);
  if (!healthy || !statused) return applied;
  if (CHANNELS.some(channel => statused[channel] > healthy[channel] + tolerance(healthy[channel]))) return 1;
  const costs = CHANNELS.filter(channel => baseStatused[channel] < baseHealthy[channel] - tolerance(baseHealthy[channel]));
  if (costs.length === 0) return applied;
  const lost = (channel: Channel, from: number, to: number) => (channel === 'residual' || from === 0 ? from - to : 1 - to / from);
  const recovered = costs.map(channel => Math.min(1, Math.max(0, 1 - lost(channel, healthy[channel], statused[channel]) / lost(channel, baseHealthy[channel], baseStatused[channel]))));
  return applied + (1 - applied) * (recovered.reduce((a, b) => a + b, 0) / costs.length);
}

const appliedOf = (status: string) => EVAL_WEIGHTS.status[status] ?? 1;

// EVAL_CHECK_FULL=1 plays every Gen 9 ability under four statuses on four formats; the default plays a selection:
// status-changing abilities, dice abilities, every Champions change, every 16th of the rest.
const FULL = !!process.env.EVAL_CHECK_FULL;
const NAMED = [
  'poisonheal', 'guts', 'quickfeet', 'marvelscale', 'magicguard', 'toxicboost', 'flareboost', 'comatose', 'purifyingsalt',
  'limber', 'waterveil', 'waterbubble', 'immunity', 'pastelveil', 'magmaarmor', 'leafguard', 'heatproof', 'thickfat',
  'naturalcure', 'hydration', 'earlybird', 'synchronize', 'analytic', 'stall', 'tangledfeet', 'klutz', 'hustle', 'truant',
  'slowstart', 'defeatist', 'hugepower', 'purepower', 'regenerator', 'merciless', 'poisontouch', 'toxicchain',
  'shedskin', 'prankster', 'serenegrace', 'noguard', 'compoundeyes', 'unaware', 'intimidate', 'levitate',
];
const SAMPLE_STRIDE = 16;
const serialised = (ability: object) => JSON.stringify(ability, (_key, value) => (typeof value === 'function' ? value.toString() : value));
type AbilityDex = { abilities: { get(id: string): object } };
type AbilityEntry = { id: string };

function sweptAbilities(all: AbilityEntry[], dex: AbilityDex, baseDex: AbilityDex): AbilityEntry[] {
  if (FULL) return all;
  const ids = new Set(all.map(ability => ability.id));
  expect(NAMED.filter(id => !ids.has(id))).toEqual([]);
  const changedByMod = (id: string) => serialised(dex.abilities.get(id)) !== serialised(baseDex.abilities.get(id));
  return all.filter((ability, index) => NAMED.includes(ability.id) || index % SAMPLE_STRIDE === 0 || changedByMod(ability.id));
}

describe('the status checker: every ability under every status, whole turns of the simulator against statusRight', () => {
  const dexOf = (format: string) => battleOf(format, [set('Pikachu', ['splash']), set('Pikachu', ['splash'])], [set('Pikachu', ['splash']), set('Pikachu', ['splash'])]).dex;

  test('the two probe moves are the physical and the special never-miss move, aimed at one foe, they are taken for', () => {
    const dex = dexOf(SINGLES);
    expect([dex.moves.get(PHYSICAL).category, dex.moves.get(SPECIAL).category]).toEqual(['Physical', 'Special']);
    expect([dex.moves.get(PHYSICAL).accuracy, dex.moves.get(SPECIAL).accuracy]).toEqual([true, true]);
    expect([dex.moves.get(PHYSICAL).target, dex.moves.get(SPECIAL).target]).toEqual(['any', 'any']);
  });

  test.each([SINGLES, DOUBLES, CHAMPIONS, CHAMPIONS_DOUBLES])('statusRight equals the played right multiplier for every ability and status (%s)', format => {
    const dex = dexOf(format);
    const every = dex.abilities.all().filter(ability => ability.exists && ability.gen <= 9 && ability.id !== 'noability' && !ability.isNonstandard);
    expect(every.length).toBeGreaterThan(250);
    const abilities = sweptAbilities(every, dex, dexOf(SINGLES));
    if (!FULL) expect(abilities.length).toBeLessThan(100);
    const twin = removalFormat(battleOf(format, [set('Pikachu', ['splash']), set('Pikachu', ['splash'])], [set('Pikachu', ['splash']), set('Pikachu', ['splash'])]));
    const wrong: string[] = [];
    const chance: string[] = [];
    for (const ability of abilities) {
      for (const status of STATUSES) {
        const applied = appliedOf(status);
        const read = statusRight(twin, ability.id, status, applied);
        if (statusByChance(twin, ability.id, status)) {
          chance.push(`${ability.id}/${status}`);
          expect(read).toBeGreaterThan(applied);
          expect(read).toBeLessThan(1);
          continue;
        }
        const played = playedRight(format, ability.id, status, applied);
        if (Math.abs(read - played) > 0.02) wrong.push(`${ability.id}/${status} ${read.toFixed(3)} vs ${played.toFixed(3)}`);
      }
    }
    expect(wrong).toEqual([]);
    expect(chance.length).toBeLessThan(10);
    expect(chance.some(name => name.startsWith('shedskin/'))).toBe(true);
  }, 600_000);

  test('the abilities the plan names change the cost, a plain mon does not', () => {
    const cases: [string, string[]][] = [
      ['poisonheal', ['psn', 'tox']], ['guts', ['brn', 'par', 'psn', 'tox']], ['quickfeet', ['par']],
      ['marvelscale', ['brn', 'par', 'psn', 'tox']], ['magicguard', ['psn', 'tox', 'brn']], ['toxicboost', ['psn', 'tox']], ['flareboost', ['brn']],
    ];
    for (const [ability, statuses] of cases) {
      for (const status of statuses) {
        expect(`${ability}/${status} ${statusRight(SINGLES, ability, status, appliedOf(status)) > appliedOf(status)}`).toBe(`${ability}/${status} true`);
      }
    }
    for (const status of STATUSES) expect(statusRight(SINGLES, 'noability', status, appliedOf(status))).toBe(appliedOf(status));
  });

  test('sleep and freeze keep the applied multiplier for every ability (their cost is the turns lost, which the twin does not read)', () => {
    for (const ability of ['marvelscale', 'poisonheal', 'guts', 'earlybird', 'shedskin']) {
      for (const status of ['slp', 'frz']) expect(statusRight(SINGLES, ability, status, appliedOf(status))).toBe(appliedOf(status));
    }
  });
});

function board(format: string, ability: string, status: string | null, mineFirst = true): Battle {
  const doubles = isDoubles(format);
  const champions = isChampions(format);
  const statused = [body('Gliscor', ability, ['splash'], champions), ...(doubles ? [body('Snorlax', 'No Ability', ['splash'], champions)] : [])];
  const plain = [body('Garchomp', 'No Ability', ['splash'], champions), ...(doubles ? [body('Snorlax', 'No Ability', ['splash'], champions)] : [])];
  const battle = mineFirst ? battleOf(format, statused, plain) : battleOf(format, plain, statused);
  const statusedMon = battle.sides[mineFirst ? 0 : 1].active[0]!;
  if (status) expect(statusedMon.setStatus(status, null, null, true)).toBe(true);
  return battle;
}

describe.each([['singles', SINGLES], ['doubles', DOUBLES], ['Champions singles', CHAMPIONS], ['Champions doubles', CHAMPIONS_DOUBLES]])('statusFix, %s', (_name, format) => {
  const twin = removalFormat(board(format, 'No Ability', null));
  const right = (ability: string, status: string) => statusRight(twin, ability, status, appliedOf(status));
  const share = () => (EVAL_WEIGHTS.alive + EVAL_WEIGHTS.hp) / (EVAL_WEIGHTS.alive + EVAL_WEIGHTS.hp);

  test('a Gliscor with Poison Heal under toxic is not discounted: the fix is what the multiplier took off', () => {
    const battle = board(format, 'Poison Heal', 'tox');
    expect(right('poisonheal', 'tox')).toBe(1);
    expect(evalFeatures(battle).statusFix).toBeCloseTo((1 - appliedOf('tox')) * share(), 12);
  });

  test('a Gliscor with Guts under burn: the burn is no cost, the fix is the whole discount', () => {
    const battle = board(format, 'Guts', 'brn');
    expect(right('guts', 'brn')).toBe(1);
    expect(evalFeatures(battle).statusFix).toBeCloseTo((1 - appliedOf('brn')) * share(), 12);
  });

  test('bodies plus statusFix of the statused board equals the bodies of the healthy board', () => {
    const statused = evalFeatures(board(format, 'Poison Heal', 'tox'));
    const healthy = evalFeatures(board(format, 'Poison Heal', null));
    expect(statused.bodies).toBeLessThan(healthy.bodies);
    expect(statused.bodies + statused.statusFix).toBeCloseTo(healthy.bodies, 12);
  });

  test('a body without such an ability reads 0, statused or not', () => {
    expect(evalFeatures(board(format, 'No Ability', 'tox')).statusFix).toBe(0);
    expect(evalFeatures(board(format, 'No Ability', 'brn')).statusFix).toBe(0);
    expect(evalFeatures(board(format, 'Poison Heal', null)).statusFix).toBe(0);
  });

  test('the sides mirror: the same board with the sides swapped negates the feature', () => {
    const mine = evalFeatures(board(format, 'Poison Heal', 'tox', true)).statusFix;
    const theirs = evalFeatures(board(format, 'Poison Heal', 'tox', false)).statusFix;
    expect(mine).toBeGreaterThan(0);
    expect(theirs).toBeCloseTo(-mine, 12);
  });

  test('the multiplier a half-cancelling ability leaves: Magic Guard under burn lies between the applied multiplier and 1', () => {
    const value = right('magicguard', 'brn');
    expect(value).toBeGreaterThan(appliedOf('brn'));
    expect(value).toBeLessThan(1);
  });

  afterEach(() => setStaticForm(null));

  test('with a weight table the column is read only where its weight is not 0, and no other feature moves', () => {
    const battle = board(format, 'Poison Heal', 'tox');
    const all = evalFeatures(battle);
    const zero = { ...featureWeights(battle.gameType === 'doubles', 'standard'), statusFix: 0 };
    const skipped = evalFeatures(battle, undefined, zero);
    expect(all.statusFix).toBeGreaterThan(0);
    expect(skipped.statusFix).toBe(0);
    expect(evalFeatures(battle, undefined, { ...zero, statusFix: 1 })).toEqual(all);
    expect({ ...skipped, statusFix: all.statusFix }).toEqual(all);
  });

  test('the score is the sum over every key with a statused Poison Heal body, and only the singles table prices the fix', () => {
    const battle = board(format, 'Poison Heal', 'tox');
    const ruleset = isChampions(format) ? 'champions' : 'standard';
    const cache = createMatchupCache(ruleset);
    const features = evalFeatures(battle, cache);
    const weights = featureWeights(battle.gameType === 'doubles', ruleset);
    const priced = format === SINGLES;
    expect(weights.statusFix).toBe(priced ? weights.bodies : 0);
    const scoreOf = (without: boolean) => {
      let diff = 0;
      for (const key of Object.keys(weights) as (keyof EvalFeatures)[]) {
        if (!(without && key === 'statusFix')) diff += weights[key] * features[key];
      }
      const teamSize = Math.max(battle.sides[0].pokemon.length, battle.sides[1].pokemon.length, 1);
      return Math.tanh((diff / (teamSize * (EVAL_WEIGHTS.alive + EVAL_WEIGHTS.hp))) * EVAL_WEIGHTS.scale);
    };
    setStaticForm(false);
    expect(evaluatePosition(battle, cache)).toBe(scoreOf(false));
    if (priced) expect(evaluatePosition(battle, cache)).toBeGreaterThan(scoreOf(true));
    else expect(evaluatePosition(battle, cache)).toBe(scoreOf(true));
  });
});

test('only the singles table carries the key (VGC singles reads it too), at the weight of bodies', () => {
  for (const [doubles, ruleset] of [[false, 'standard'], [false, 'vgc']] as const) {
    expect(featureWeights(doubles, ruleset).statusFix).toBe(featureWeights(doubles, ruleset).bodies);
  }
  for (const [doubles, ruleset] of [[false, 'champions'], [true, 'standard'], [true, 'vgc'], [true, 'champions']] as const) {
    expect(featureWeights(doubles, ruleset).statusFix).toBe(0);
  }
});
