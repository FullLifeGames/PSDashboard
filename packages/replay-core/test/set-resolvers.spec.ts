import './champions-mod';
import { test, expect, describe } from 'vitest';
import { inferOpponentTeam } from '../src/opponent-inferrer';
import { enrichTeamInfo } from '../src/team-info';
import { buildTeamsFromReplay } from '../src/team-builder';
import { editedFields, resolveSpread, buildSheetSet } from '../src/team/set-resolvers';
import type { PokemonSetAssumption, SmogonSetAssumptions } from '../src/smogon/sets-lookup';
import type { PokemonUsageStats, SmogonUsageStats } from '../src/smogon/stats-types';
import type { OpponentTeamInfo, RevealedPokemonInfo } from '../src/types';
import type { SpreadCandidate } from '../src/spread-inference';
import { toId } from '../src/ids';
import { rulesDex } from '../src/rules-dex';
import { readFileSync } from 'node:fs';
import type { PokemonSet } from '@pkmn/sim';
import { parseReplayLogWithObservations } from '../src/protocol-parser';

/**
 * Published IVs in the build (round 64, T122 point 4, spec decision 21):
 * the chosen Smogon set's IVs reach the built set, a set without them keeps
 * 31, user-edited IVs and the speed solver's IVs (lane H) come first, and a
 * typeless Hidden Power still takes its type from the evidence or usage.
 */

const all31 = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };
const usage = (species: string, moves: [string, number][]): PokemonUsageStats => ({
  species, rawCount: 1000, abilities: [], spreads: [], items: [],
  moves: moves.map(([value, probability]) => ({ value, probability, sourceDetail: 'u' })),
});
const stats = (...entries: PokemonUsageStats[]): SmogonUsageStats => ({
  format: 'test', month: 'm', source: 's', pokemon: Object.fromEntries(entries.map(entry => [toId(entry.species), entry])),
});
const curated = (species: string, moves: string[], ivs?: PokemonSetAssumption['ivs']): PokemonSetAssumption => ({
  species, sourceDetail: 's', item: { value: 'Sitrus Berry', sourceDetail: 's' },
  moves: moves.map(value => ({ value, sourceDetail: 's' })),
  spread: { value: 'Quiet:252/0/76/8/172/0', nature: 'Quiet', evs: { hp: 252, atk: 0, def: 76, spa: 8, spd: 172, spe: 0 }, sourceDetail: 's' },
  ...(ivs ? { ivs } : {}),
});
const sets = (entry: PokemonSetAssumption): SmogonSetAssumptions => ({ format: 'test', source: 's', pokemon: { [toId(entry.species)]: entry } });

const singles = (gen: number, species: string, moves: string[]) => [
  '|player|p1|Alice|', '|player|p2|Bob|', `|gen|${gen}`, '|tier|test',
  '|poke|p1|Skarmory|item', `|poke|p2|${species}|item`, '|start',
  '|switch|p1a: Skarmory|Skarmory|100/100', `|switch|p2a: Mon|${species}|100/100`,
  ...moves.flatMap((move, index) => [`|turn|${index + 1}`, `|move|p2a: Mon|${move}|p1a: Skarmory`]),
].join('\n');
const doubles = (species: string, moves: string[]) => [
  '|player|p1|Alice|', '|player|p2|Bob|', '|gametype|doubles', '|gen|9', '|tier|test',
  '|poke|p1|Skarmory|item', '|poke|p1|Blissey|item', `|poke|p2|${species}|item`, '|poke|p2|Incineroar|item', '|start',
  '|switch|p1a: Skarmory|Skarmory|100/100', '|switch|p1b: Blissey|Blissey|100/100',
  `|switch|p2a: Mon|${species}|100/100`, '|switch|p2b: Cat|Incineroar|100/100',
  ...moves.flatMap((move, index) => [`|turn|${index + 1}`, `|move|p2a: Mon|${move}|p1a: Skarmory`]),
].join('\n');

function build(log: string, species: string, usageStats: SmogonUsageStats, setAssumptions: SmogonSetAssumptions, edit?: (info: OpponentTeamInfo) => void) {
  const raw = inferOpponentTeam(log, 'p2');
  edit?.(raw);
  const p2Info = enrichTeamInfo(raw, usageStats, setAssumptions);
  return buildTeamsFromReplay(log, { p2Info, usageStats, setAssumptions }).p2Team.find(set => set.species === species)!;
}

const sinistcha = stats(usage('Sinistcha', [['Matcha Gotcha', 0.9], ['Rage Powder', 0.9], ['Trick Room', 0.8], ['Shadow Ball', 0.5]]));
const trickRoom = (ivs?: PokemonSetAssumption['ivs']) => sets(curated('Sinistcha', ['Matcha Gotcha', 'Rage Powder', 'Trick Room', 'Shadow Ball'], ivs));

describe('the chosen set\'s published IVs reach the build', () => {
  test('doubles: a Trick Room set plays Speed 0 and Attack 0, the rest 31', () => {
    const set = build(doubles('Sinistcha', ['Trick Room']), 'Sinistcha', sinistcha, trickRoom({ atk: 0, spe: 0 }));
    expect(set.ivs).toEqual({ ...all31, atk: 0, spe: 0 });
  });

  test('singles: the same set in a singles log', () => {
    const set = build(singles(9, 'Sinistcha', ['Trick Room']), 'Sinistcha', sinistcha, trickRoom({ atk: 0, spe: 0 }));
    expect(set.ivs).toEqual({ ...all31, atk: 0, spe: 0 });
  });

  test('a set without published IVs keeps 31 in every stat', () => {
    expect(build(doubles('Sinistcha', ['Trick Room']), 'Sinistcha', sinistcha, trickRoom()).ivs).toEqual(all31);
  });

  test('IVs the user edited beat the published ones', () => {
    const set = build(singles(9, 'Sinistcha', ['Trick Room']), 'Sinistcha', sinistcha, trickRoom({ atk: 0, spe: 0 }), info => {
      info.pokemon[0].ivs = { value: { ...all31, spe: 20 }, source: 'manual' };
    });
    expect(set.ivs).toEqual({ ...all31, spe: 20 });
  });
});

describe('resolveSpread takes the IVs edited, then solved, then published, then 31 (lane H interface)', () => {
  const info = inferOpponentTeam(singles(9, 'Sinistcha', ['Trick Room']), 'p2').pokemon[0];
  const chosen = curated('Sinistcha', ['Trick Room'], { atk: 0, spe: 0 });

  test('a Speed IV the solver decided beats the published one; the published Attack stays', () => {
    const solved = { evs: { hp: 252, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, nature: 'Quiet', ivs: { spe: 12 } } as SpreadCandidate;
    expect(resolveSpread(rulesDex(9), 'Sinistcha', editedFields(info), solved, chosen, null, undefined).ivs).toEqual({ ...all31, atk: 0, spe: 12 });
  });

  test('without a solver IV the published ones stand', () => {
    const solved = { evs: { hp: 252, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, nature: 'Quiet' } as SpreadCandidate;
    expect(resolveSpread(rulesDex(9), 'Sinistcha', editedFields(info), solved, chosen, null, undefined).ivs).toEqual({ ...all31, atk: 0, spe: 0 });
  });
});

test('singles gen 6: a typeless Hidden Power still takes its usage type under published IVs', () => {
  const volcarona = stats(usage('Volcarona', [['Quiver Dance', 0.9], ['Fiery Dance', 0.9], ['Bug Buzz', 0.8], ['Hidden Power Ground', 0.6]]));
  const published = sets({
    ...curated('Volcarona', ['Quiver Dance', 'Fiery Dance', 'Bug Buzz', 'Hidden Power Ground'], { atk: 0 }),
    item: { value: 'Life Orb', sourceDetail: 's' },
  });
  const set = build(singles(6, 'Volcarona', ['Quiver Dance', 'Hidden Power']), 'Volcarona', volcarona, published);
  expect(set.moves).toContain('Hidden Power Ground');
  expect(set.ivs?.atk).toBe(0);
});

const replay = JSON.parse(readFileSync(new URL('./fixtures/gen9championsvgc2026regmbbo3-2634204248.json', import.meta.url), 'utf-8')) as { log: string };
const sumOf = (evs: PokemonSet['evs']) => Object.values(evs).reduce((total, value) => total + (value ?? 0), 0);

describe('the scene: gen9championsvgc2026regmbbo3-2634204248 (doubles, Champions VGC)', () => {
  const parsed = parseReplayLogWithObservations(replay.log);
  const teams = buildTeamsFromReplay(replay.log, { observations: parsed.observations, speedOrders: parsed.speedOrders });
  const mawile = teams.p1Team.find(set => set.species === 'Mawile')!;

  test('the sheet shows no EVs, so Mawile takes the solver\'s: about 151 HP, with the sheet\'s nature', () => {
    expect(mawile.nature).toBe('Adamant');
    expect(sumOf(mawile.evs)).toBeGreaterThan(0);
    expect(mawile.evs.hp).toBeGreaterThanOrEqual(20);
  });

  test('every sheet set keeps the sheet\'s nature and item', () => {
    expect(teams.p2Team.find(set => set.species === 'Incineroar')).toMatchObject({ nature: 'Impish', item: 'Sitrus Berry' });
    expect(teams.p1Team.find(set => set.species === 'Incineroar')).toMatchObject({ nature: 'Careful', item: 'Chople Berry' });
  });
});

const info = (species: string) => ({
  species, moves: [{ name: 'Tackle', source: 'revealed' }], ability: { value: '', source: 'unknown' }, item: { value: '', source: 'unknown' },
  teraType: { value: '', source: 'unknown' }, evs: { value: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, source: 'unknown' }, level: 50, gender: 'M',
}) as unknown as RevealedPokemonInfo;
const sheet = (evs: PokemonSet['evs']): PokemonSet => ({
  name: 'Mawile', species: 'Mawile', item: 'Mawilite', ability: 'Intimidate', moves: ['Protect'], nature: 'Adamant', evs,
  ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }, level: 50, gender: 'M',
});
const ZERO = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
const SOLVED: SpreadCandidate = { evs: { hp: 26, atk: 32, def: 0, spa: 0, spd: 8, spe: 0 }, nature: 'Hardy', origin: 'damage' };

describe('buildSheetSet with a solved spread (the rule is format-free: singles and doubles read it alike)', () => {
  test('a sheet without EVs takes the solved EVs and keeps its nature', () => {
    const set = buildSheetSet(info('Mawile'), sheet(ZERO), { editedEvs: null, editedNature: null, editedIvs: null }, null, null, SOLVED);
    expect(set.evs).toEqual(SOLVED.evs);
    expect(set.nature).toBe('Adamant');
  });

  test('a sheet with real EVs keeps them', () => {
    const real = { hp: 32, atk: 32, def: 2, spa: 0, spd: 0, spe: 0 };
    expect(buildSheetSet(info('Mawile'), sheet(real), { editedEvs: null, editedNature: null, editedIvs: null }, null, null, SOLVED).evs).toEqual(real);
  });

  test('edited EVs win over the solver; a guess of the solver (origin prior) does not replace the usage fallback', () => {
    const edited = { hp: 4, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
    expect(buildSheetSet(info('Mawile'), sheet(ZERO), { editedEvs: edited, editedNature: null, editedIvs: null }, null, null, SOLVED).evs).toEqual(edited);
    const usage = { spread: { nature: 'Jolly', evs: { hp: 0, atk: 32, def: 0, spa: 0, spd: 2, spe: 32 } } } as never;
    expect(buildSheetSet(info('Mawile'), sheet(ZERO), { editedEvs: null, editedNature: null, editedIvs: null }, usage, null, { ...SOLVED, origin: 'prior' }).evs)
      .toEqual({ hp: 0, atk: 32, def: 0, spa: 0, spd: 2, spe: 32 });
  });
});
