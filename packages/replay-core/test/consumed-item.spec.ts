import { test, expect, describe } from 'vitest';
import { inferOpponentTeam } from '../src/opponent-inferrer';
import { enrichTeamInfo } from '../src/team-info';
import { buildTeamsFromReplay } from '../src/team-builder';
import type { PokemonUsageStats, SmogonUsageStats } from '../src/smogon/stats-types';
import { toId } from '../src/ids';

/**
 * A berry eaten later in the game is the set's item, even when the team
 * preview only flagged that the Pokémon holds something (T108 point 1,
 * fixed in b919be8, pinned in round 67). 649664: p1's Tyranitar eats its
 * Chople Berry in turn 12; while the preview's "(has item)" blocked the
 * record, the build guessed Tyranitarite and the app offered "Mega + Crunch"
 * at turn 8.
 */

const usage = (species: string, items: [string, number][]): PokemonUsageStats => ({
  species, rawCount: 1000, abilities: [], spreads: [], moves: [],
  items: items.map(([value, probability]) => ({ value, probability, sourceDetail: 'u' })),
});
const stats = (...entries: PokemonUsageStats[]): SmogonUsageStats => ({
  format: 'test', month: 'm', source: 's', pokemon: Object.fromEntries(entries.map(entry => [toId(entry.species), entry])),
});

/** 649664's shape: preview item markers, a Fighting move into Tyranitar, the berry eaten. */
const singles = [
  '|player|p1|Alpha|', '|player|p2|Beta|', '|teamsize|p1|2', '|teamsize|p2|2', '|gen|6', '|tier|[Gen 6] OU',
  '|poke|p1|Tyranitar, F|item', '|poke|p1|Ferrothorn, F|item', '|poke|p2|Medicham, M|item', '|poke|p2|Latias, F|item', '|start',
  '|switch|p1a: Tyranitar|Tyranitar, F|404/404', '|switch|p2a: Medicham|Medicham, M|261/261',
  '|turn|1',
  '|move|p2a: Medicham|Drain Punch|p1a: Tyranitar', '|-enditem|p1a: Tyranitar|Chople Berry|[eat]',
  '|-enditem|p1a: Tyranitar|Chople Berry|[weaken]', '|-supereffective|p1a: Tyranitar', '|-damage|p1a: Tyranitar|250/404',
  '|move|p1a: Tyranitar|Crunch|p2a: Medicham', '|-damage|p2a: Medicham|150/261',
  '|turn|2',
].join('\n');

const doubles = [
  '|player|p1|Alpha|', '|player|p2|Beta|', '|gametype|doubles', '|teamsize|p1|2', '|teamsize|p2|2', '|gen|7', '|tier|[Gen 7] Doubles OU',
  '|poke|p1|Tyranitar, F|item', '|poke|p1|Ferrothorn, F|item', '|poke|p2|Medicham, M|item', '|poke|p2|Latias, F|item', '|start',
  '|switch|p1a: Tyranitar|Tyranitar, F|100/100', '|switch|p1b: Ferrothorn|Ferrothorn, F|100/100',
  '|switch|p2a: Medicham|Medicham, M|100/100', '|switch|p2b: Latias|Latias, F|100/100',
  '|turn|1',
  '|move|p2a: Medicham|Drain Punch|p1a: Tyranitar', '|-enditem|p1a: Tyranitar|Chople Berry|[eat]',
  '|-enditem|p1a: Tyranitar|Chople Berry|[weaken]', '|-supereffective|p1a: Tyranitar', '|-damage|p1a: Tyranitar|62/100',
  '|turn|2',
].join('\n');

const tyranitarUsage = stats(usage('Tyranitar', [['Tyranitarite', 0.5], ['Chople Berry', 0.2], ['Leftovers', 0.1]]));

describe('a consumed item behind the preview marker (T108 point 1)', () => {
  test.each([['singles', singles], ['doubles', doubles]])('%s: the inference records the eaten Chople Berry, and panel and build play it, not Tyranitarite', (_, log) => {
    const raw = inferOpponentTeam(log, 'p1');
    expect(raw.pokemon.find(mon => mon.species === 'Tyranitar')!.item).toEqual({ value: 'Chople Berry (consumed)', source: 'revealed' });
    const p1Info = enrichTeamInfo(raw, tyranitarUsage, null);
    expect(p1Info.pokemon.find(mon => mon.species === 'Tyranitar')!.item.value).toBe('Chople Berry (consumed)');
    const team = buildTeamsFromReplay(log, { p1Info, usageStats: tyranitarUsage }).p1Team;
    expect(team.find(set => set.species === 'Tyranitar')!.item).toBe('Chople Berry');
  });
});
