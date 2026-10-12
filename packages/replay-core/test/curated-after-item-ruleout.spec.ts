import { describe, expect, test } from 'vitest';
import { selectCuratedSet, type CuratedEvidence } from '../src/set-coherence';
import { inferOpponentTeam } from '../src/opponent-inferrer';
import { enrichTeamInfo } from '../src/team-info';
import { buildTeamsFromReplay } from '../src/team-builder';
import type { PokemonSetAssumption, SmogonSetAssumptions } from '../src/smogon/sets-lookup';
import type { PokemonUsageStats, SmogonUsageStats } from '../src/smogon/stats-types';
import { toId } from '../src/ids';

/**
 * Round 69 (T166): the log rules out the one item every published set of a species lists, and the whole species gave up its
 * curated sets. 752839's Iron Valiant shows Swords Dance, Spirit Break and Shadow Sneak and Booster Energy is ruled out (the sun
 * does not start Quark Drive, no Booster line at the switch-in), but each published Iron Valiant set carries Booster Energy.
 * `selectCuratedSet` returned null before the replacement rule of round 64 ran, the fallback took its nature from the usage
 * marginals (Timid, the special sets of the format), and the physical Iron Valiant played a special nature. The set that fits the
 * moves now stays the pick, with the replacement item of the round-64 rule.
 */

const curated = (moves: string[], nature: string, evs: Record<string, number>): PokemonSetAssumption => ({
  species: 'Iron Valiant', sourceDetail: 's', ability: { value: 'Quark Drive', sourceDetail: 's' },
  item: { value: 'Booster Energy', sourceDetail: 's' },
  moves: moves.map(value => ({ value, sourceDetail: 's' })),
  spread: { nature, evs, sourceDetail: 's' } as PokemonSetAssumption['spread'],
});
const physical = () => curated(['Swords Dance', 'Spirit Break', 'Close Combat', 'Shadow Sneak'], 'Jolly', { atk: 252, spe: 252, spd: 4 });
const special = () => curated(['Calm Mind', 'Moonblast', 'Focus Blast', 'Thunderbolt'], 'Timid', { spa: 252, spe: 252, spd: 4 });
const usageOf: Record<string, number> = { moonblast: 0.9, closecombat: 0.7, spiritbreak: 0.5, swordsdance: 0.4, shadowsneak: 0.2, calmmind: 0.3 };
const evidence = (over: Partial<CuratedEvidence>): CuratedEvidence => ({
  revealedMoves: ['swordsdance', 'spiritbreak', 'shadowsneak'], revealedItem: '', revealedAbility: '',
  ruledOutItems: ['boosterenergy'], ruledOutAbilities: [], usageProbability: moveId => usageOf[moveId] ?? 0, ...over,
});

describe('selectCuratedSet: every item of every published set is ruled out', () => {
  test('the set that fits the moves stays the pick, with the most used allowed item, marked as a guess', () => {
    const picked = selectCuratedSet([special(), physical()], evidence({ usageItem: 'Leftovers' }));
    expect(picked?.moves.map(move => move.value)).toEqual(['Swords Dance', 'Spirit Break', 'Close Combat', 'Shadow Sneak']);
    expect(picked?.spread?.nature).toBe('Jolly');
    expect(picked?.item).toMatchObject({ value: 'Leftovers', sourceDetail: 'Booster Energy ruled out, most used other item' });
    expect(picked?.itemReplaced).toBe(true);
  });

  test('a guess the log supports comes before the usage majority', () => {
    const picked = selectCuratedSet([physical()], evidence({ guessedItem: 'Covert Cloak', usageItem: 'Leftovers' }));
    expect(picked?.item).toMatchObject({ value: 'Covert Cloak', sourceDetail: 'Booster Energy ruled out, Covert Cloak guessed from the log' });
  });

  test('a set that contradicts the moves still gives way: no candidate fits, no pick', () => {
    expect(selectCuratedSet([special()], evidence({ usageItem: 'Leftovers' }))).toBeNull();
  });

  test('without any replacement item there is no pick (the marginal assembly decides, as before)', () => {
    expect(selectCuratedSet([physical()], evidence({}))).toBeNull();
  });

  test('a replacement the log rules out is none', () => {
    expect(selectCuratedSet([physical()], evidence({ ruledOutItems: ['boosterenergy', 'leftovers'], usageItem: 'Leftovers' }))).toBeNull();
  });

  test('a set with an allowed item is still preferred and returned as published (the same object)', () => {
    const allowedItem = { ...physical(), item: { value: 'Leftovers', sourceDetail: 's' } };
    expect(selectCuratedSet([special(), allowedItem], evidence({ usageItem: 'Choice Band' }))).toBe(allowedItem);
  });
});

const usage = (): PokemonUsageStats => ({
  species: 'Iron Valiant', rawCount: 1000, abilities: [],
  spreads: [{ value: { nature: 'Timid', evs: { hp: 0, atk: 0, def: 0, spa: 252, spd: 4, spe: 252 } }, probability: 0.6, sourceDetail: 'u' }] as PokemonUsageStats['spreads'],
  items: [{ value: 'Booster Energy', probability: 0.6, sourceDetail: 'u' }, { value: 'Leftovers', probability: 0.2, sourceDetail: 'u' }],
  moves: Object.entries({ Moonblast: 0.9, 'Close Combat': 0.7, 'Spirit Break': 0.5, 'Swords Dance': 0.4, 'Shadow Sneak': 0.2, 'Calm Mind': 0.3 })
    .map(([value, probability]) => ({ value, probability, sourceDetail: 'u' })),
});
const stats = (): SmogonUsageStats => ({ format: 'test', month: 'm', source: 's', pokemon: { [toId('Iron Valiant')]: usage() } });
const setAssumptions = (): SmogonSetAssumptions => ({ format: 'test', source: 's', pokemon: { ironvaliant: { ...special(), alternatives: [physical()] } } });

const singles = [
  '|player|p1|Alice|', '|player|p2|Bob|', '|gen|9', '|tier|test', '|poke|p1|Skarmory|item', '|poke|p2|Iron Valiant|item', '|start',
  '|switch|p1a: Skarmory|Skarmory|100/100', '|switch|p2a: Mon|Iron Valiant|100/100',
  ...['Swords Dance', 'Spirit Break', 'Shadow Sneak'].flatMap((move, index) => [`|turn|${index + 1}`, `|move|p2a: Mon|${move}|p1a: Skarmory`]),
].join('\n');
const doubles = [
  '|player|p1|Alice|', '|player|p2|Bob|', '|gametype|doubles', '|gen|9', '|tier|test',
  '|poke|p1|Skarmory|item', '|poke|p1|Blissey|item', '|poke|p2|Iron Valiant|item', '|poke|p2|Incineroar|item', '|start',
  '|switch|p1a: Skarmory|Skarmory|100/100', '|switch|p1b: Blissey|Blissey|100/100',
  '|switch|p2a: Mon|Iron Valiant|100/100', '|switch|p2b: Cat|Incineroar|100/100',
  ...['Swords Dance', 'Spirit Break', 'Shadow Sneak'].flatMap((move, index) => [`|turn|${index + 1}`, `|move|p2a: Mon|${move}|p1a: Skarmory`]),
].join('\n');

/** The app's chain without a spread solve, with Booster Energy ruled out on the inferred info. */
function build(log: string) {
  const raw = inferOpponentTeam(log, 'p2');
  raw.pokemon.find(mon => mon.species === 'Iron Valiant')!.ruledOut = { items: ['boosterenergy'], abilities: [] };
  const p2Info = enrichTeamInfo(raw, stats(), setAssumptions());
  const team = buildTeamsFromReplay(log, { p2Info, usageStats: stats(), setAssumptions: setAssumptions() }).p2Team;
  return { built: team.find(set => set.species === 'Iron Valiant')!, panel: p2Info.pokemon.find(mon => mon.species === 'Iron Valiant')! };
}

describe('752839: the build and the panel keep the physical set', () => {
  for (const [kind, log] of [['singles', singles], ['doubles', doubles]] as const) {
    test(`${kind}: a physical nature, the shown moves and a replacement item`, () => {
      const { built, panel } = build(log);
      expect(built.nature).toBe('Jolly');
      expect(built.evs).toMatchObject({ atk: 252, spe: 252 });
      expect(built.moves).toEqual(expect.arrayContaining(['Swords Dance', 'Spirit Break', 'Shadow Sneak']));
      expect(built.item).toBe('Leftovers');
      expect(panel.item).toMatchObject({ value: 'Leftovers', source: 'guessed', sourceDetail: 'Booster Energy ruled out, most used other item' });
    });
  }
});
