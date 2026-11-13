import { describe, expect, test } from 'vitest';
import { Move, calculate } from '@smogon/calc';
import { applyInferredSpreads, KNOCKOUT_BOOST_ITEM_DETAIL } from '../src/team-info';
import { buildTeamsFromReplay, solveReplaySpreads } from '../src/team-builder';
import { itemClauseLimit, speedKnowledgeFor } from '../src/team/inferred-items';
import { inferOpponentTeam } from '../src/opponent-inferrer';
import { buildCalcPokemon } from '../src/calc-build';
import { calcGenerationFor } from '../src/calc-gen';
import type { SmogonUsageStats } from '../src/smogon/stats-types';
import type { DamageObservation, PokemonEvs } from '../src/types';

/**
 * Round 89 (#75 step 2): the build hands the solver what the log lets it offer. The usage list of the species, in usage order, less the items the
 * log refutes (a Choice lock two different moves break), and the format's Item Clause read from the log's own `|rule|` line (else the simulator's
 * rule table of the `|tier|`; a Custom Game has none). The solved item rides out on the candidate, into the built set and the panel.
 */
const evs = (spread: Partial<PokemonEvs>): PokemonEvs => ({ hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0, ...spread });
const usage = (species: string, items: string[], nature: string, spread: PokemonEvs): SmogonUsageStats['pokemon'][string] => ({
  species, rawCount: 100, abilities: [], moves: [],
  items: items.map((value, index) => ({ value, probability: 0.5 - index * 0.1, sourceDetail: 'test' })),
  spreads: [{ value: 'test', probability: 1, sourceDetail: 'test', nature, evs: spread }],
});
const gen = calcGenerationFor(9);
const body = (species: string, nature: string, spread: PokemonEvs, item?: string) => buildCalcPokemon(gen, species, { level: 100, nature, evs: spread, item });
const wall = body('Alakazam', 'Hardy', evs({}));
const best = (item?: string, nature = 'Timid') => Math.max(...(calculate(gen, body('Gengar', nature, evs({ spa: 252 }), item), wall, new Move(gen, 'Sludge Bomb')).damage as number[]).flat().map(Number)) / wall.maxHP();
const knockout = (): DamageObservation => ({
  attackerSpecies: 'Gengar', defenderSpecies: 'Alakazam', attackerSide: 'p2', moveId: 'sludgebomb', observedFraction: 1, lethal: true,
  attackerBoosts: {}, defenderBoosts: {}, attackerStatus: '', screens: [], weather: '', doubles: true,
  defenderShown: { before: { hp: 100, maxhp: 100 } },
});
const stats = (gengar: string[]): SmogonUsageStats => ({
  format: 'gen9doublesou', month: '2026-08', source: 'test',
  pokemon: {
    gengar: usage('Gengar', gengar, 'Timid', evs({ spa: 252, spe: 252, hp: 4 })),
    garchomp: usage('Garchomp', ['Leftovers'], 'Jolly', evs({ atk: 252, spe: 252, hp: 4 })),
  },
});
const HEAD = [
  '|player|p1|Alice|', '|player|p2|Bob|', '|gametype|doubles', '|gen|9', '|tier|[Gen 9] Doubles OU',
  '|poke|p1|Alakazam, M|', '|poke|p2|Gengar, M|', '|poke|p2|Garchomp, M|',
];
const START = ['|start', '|switch|p1a: Alakazam|Alakazam, M|100/100', '|switch|p2a: Gengar|Gengar, M|100/100', '|switch|p2b: Garchomp|Garchomp, M|100/100', '|turn|1'];
const logOf = (rules: string[] = [], events: string[] = []) => [...HEAD, ...rules, ...START, ...events].join('\n');
const RULE = ['|rule|Item Clause: Limit 1 of each item'];
/** Gengar used two different moves in a row: a Choice lock would have held it to the first. */
const lockedLog = () => [...HEAD, ...START.slice(0, 4), '|turn|1', '|move|p2a: Gengar|Shadow Ball|p1a: Alakazam', '|turn|2',
  '|move|p2a: Gengar|Sludge Bomb|p1a: Alakazam', '|turn|3'].join('\n');

describe('the item rung through the build (doubles)', () => {
  test('the scene is real: the guessed spread and no item stay below the full HP, Choice Specs and Life Orb reach it', () => {
    expect(best(undefined, 'Modest')).toBeLessThan(0.97);
    expect(best('Choice Specs')).toBeGreaterThanOrEqual(1.01);
    expect(best('Life Orb', 'Modest')).toBeGreaterThanOrEqual(1);
  });

  test('the solved candidate, the built set and the panel carry the same item and the reason', () => {
    const log = logOf();
    const usageStats = stats(['Leftovers', 'Choice Specs', 'Life Orb']);
    expect(buildTeamsFromReplay(log, { usageStats }).p2Team.find(set => set.species === 'Gengar')?.item).toBe('Leftovers');
    const solved = solveReplaySpreads(log, [knockout(), knockout()], { usageStats });
    const gengar = solved.get('p2:gengar');
    expect(gengar?.item).toBe('Choice Specs');
    expect(gengar?.itemReason).toBe('boost');
    const built = buildTeamsFromReplay(log, { usageStats, inferredSpreads: solved }).p2Team.find(set => set.species === 'Gengar');
    expect(built?.item).toBe('Choice Specs');
    const shown = applyInferredSpreads(inferOpponentTeam(log, 'p2'), 'p2', solved).pokemon.find(mon => mon.species === 'Gengar')!.item;
    expect(shown.value).toBe('Choice Specs');
    expect(shown.source).toBe('guessed');
    expect(shown.sourceDetail).toBe(KNOCKOUT_BOOST_ITEM_DETAIL);
  });

  test('an item the log refutes never enters: two different moves rule out the Choice items, Life Orb follows', () => {
    const lockBroken = lockedLog();
    expect(inferOpponentTeam(lockBroken, 'p2').pokemon.find(mon => mon.species === 'Gengar')?.ruledOut?.items).toContain('choicespecs');
    const usageStats = stats(['Leftovers', 'Choice Specs', 'Life Orb']);
    const solved = solveReplaySpreads(lockBroken, [knockout(), knockout()], { usageStats });
    expect(solved.get('p2:gengar')?.item).toBe('Life Orb');
    expect(solved.get('p2:gengar')?.itemReason).toBe('boost');
  });

  test('the Item Clause of the log holds: a teammate that showed the item keeps it from the offer', () => {
    const shows = ['|-damage|p2b: Garchomp|88/100|[from] item: Life Orb'];
    const usageStats = stats(['Leftovers', 'Life Orb', 'Choice Specs']);
    const withClause = solveReplaySpreads(logOf(RULE, shows), [knockout(), knockout()], { usageStats }).get('p2:gengar');
    expect(withClause?.item, 'Life Orb is the partner\'s').toBe('Choice Specs');
    const noClause = solveReplaySpreads(logOf([], shows), [knockout(), knockout()], { usageStats }).get('p2:gengar');
    expect(noClause?.item, 'no clause in a format without one').toBe('Life Orb');
  });
});

describe('what the build offers', () => {
  const infos = (log: string) => ({ p1: inferOpponentTeam(log, 'p1'), p2: inferOpponentTeam(log, 'p2') });
  const nobody = { p1: null, p2: null };

  test('the usage list in usage order, without what the log rules out, with the clause limit', () => {
    const usageStats = stats(['Leftovers', 'Choice Specs', 'Life Orb', 'Focus Sash']);
    const log = lockedLog();
    const knowledge = speedKnowledgeFor(infos(log), nobody, usageStats, 1).get('p2:gengar');
    expect(knowledge?.itemOffers).toEqual(['Leftovers', 'Life Orb', 'Focus Sash']);
    expect(knowledge?.itemLimit).toBe(1);
    expect(speedKnowledgeFor(infos(log), nobody, usageStats).get('p2:gengar')?.itemLimit).toBeUndefined();
    expect(speedKnowledgeFor(infos(log), nobody, null).get('p2:gengar')?.itemOffers ?? []).toEqual([]);
  });

  test('the clause limit: the log\'s rule line first (both spellings), else the simulator\'s rule table of the tier, a Custom Game none', () => {
    const rule = (line: string, tier = '[Gen 9] Doubles OU') => ['|gen|9', `|tier|${tier}`, ...(line ? [line] : [])].join('\n');
    expect(itemClauseLimit(rule('|rule|Item Clause: Limit 1 of each item'))).toBe(1);
    expect(itemClauseLimit(rule('|rule|Item Clause: Limit one of each item'))).toBe(1);
    expect(itemClauseLimit(rule('|rule|Item Clause: Limit 2 of each item'))).toBe(2);
    // No rule line: the simulator's own rule table names the clause (Doubles OU carries none, a VGC format does).
    expect(itemClauseLimit(rule('', '[Gen 9] Custom Game'))).toBeUndefined();
    expect(itemClauseLimit(rule('', '[Gen 9] Doubles OU'))).toBeUndefined();
    expect(itemClauseLimit(rule('', '[Gen 9] VGC 2024 Reg G'))).toBe(1);
    expect(itemClauseLimit(rule('', '[Gen 9] A League Format The Simulator Does Not Know'))).toBeUndefined();
  });
});
