import { describe, expect, test } from 'vitest';
import { Battle, Teams } from '@pkmn/sim';
import { extractLeads, findPokemonOnSide } from '../src/branch/protocol-choices';
import { reorderForLeads, sameBodyName, trimTeamToBring } from '../src/branch/team-order';
import { set } from './named-games-support';

/**
 * Round 72, T238: the lookups that find a body by the replay's name. The simulator now carries the replay's own names, and
 * `toId` turns a Chinese or Japanese name into "", so an id compared between two such names matched every body of the side.
 * A lookup compares the exact name first and treats an empty id as no key. Each case is the same for singles and doubles:
 * the lookups read one side's team and know no game type.
 */

const japanese = [set('チョコクロワ', 'Indeedee-F'), set('うみのうた', 'Primarina'), set('ワスレイヌ', 'Houndstone'), set('グレンタウン', 'Armarouge')];
const lead = (name: string, species: string) => ({ name, species });

describe('sameBodyName', () => {
  test('equal names match, equal ids match, an empty id is no key', () => {
    expect(sameBodyName('Rias', 'Rias')).toBe(true);
    expect(sameBodyName('Rias!', 'Rias?')).toBe(true);
    expect(sameBodyName('うみのうた', 'うみのうた')).toBe(true);
    expect(sameBodyName('うみのうた', 'ワスレイヌ')).toBe(false);
    expect(sameBodyName('', '')).toBe(false);
    expect(sameBodyName('うみのうた', undefined)).toBe(false);
  });
});

describe('reorderForLeads', () => {
  test('names without an id: each lead finds its own body (doubles leads in slots three and four, singles one lead)', () => {
    const doubles = reorderForLeads(japanese, [lead('うみのうた', 'Primarina'), lead('グレンタウン', 'Armarouge')]);
    expect(doubles.map(pokemon => pokemon.name)).toEqual(['うみのうた', 'グレンタウン', 'チョコクロワ', 'ワスレイヌ']);
    const singles = reorderForLeads(japanese, [lead('ワスレイヌ', 'Houndstone')]);
    expect(singles.map(pokemon => pokemon.name)).toEqual(['ワスレイヌ', 'チョコクロワ', 'うみのうた', 'グレンタウン']);
  });

  test('two names of one id: the exact name decides', () => {
    const team = [set('Rias!', 'Dragapult'), set('Rias?', 'Snorlax')];
    expect(reorderForLeads(team, [lead('Rias?', 'Snorlax')]).map(pokemon => pokemon.name)).toEqual(['Rias?', 'Rias!']);
  });

  test('one name on two bodies: the species of the lead decides', () => {
    const team = [set('Twin', 'Dragapult'), set('Twin', 'Snorlax')];
    expect(reorderForLeads(team, [lead('Twin', 'Snorlax')]).map(pokemon => pokemon.species)).toEqual(['Snorlax', 'Dragapult']);
  });

  test('a lead named by its species finds the body that carries no nickname', () => {
    const team = [set('うみのうた', 'Primarina'), set('Snorlax', 'Snorlax')];
    expect(reorderForLeads(team, [lead('Snorlax', 'Snorlax')]).map(pokemon => pokemon.species)).toEqual(['Snorlax', 'Primarina']);
  });
});

describe('trimTeamToBring', () => {
  test('names without an id: the brought names keep their own bodies', () => {
    const kept = trimTeamToBring(japanese, ['グレンタウン', 'うみのうた', 'ワスレイヌ'], { gen: 9, mod: undefined });
    expect(kept.map(pokemon => pokemon.name)).toEqual(['うみのうた', 'ワスレイヌ', 'グレンタウン']);
  });

  test('two names of one id: each brought name keeps its exact body', () => {
    const team = [set('Rias!', 'Dragapult'), set('Rias?', 'Snorlax'), set('Plain', 'Clefable')];
    expect(trimTeamToBring(team, ['Rias?', 'Plain'], { gen: 9, mod: undefined }).map(pokemon => pokemon.name)).toEqual(['Rias?', 'Plain']);
  });
});

describe('extractLeads', () => {
  test('two leads of one species under different names without an id stay two leads', () => {
    const log = ['|switch|p1a: ピカ|Pikachu, L50, F|100/100', '|switch|p1b: チュウ|Pikachu, L50, F|100/100', '|turn|1'].join('\n');
    expect(extractLeads(log).p1Leads).toEqual([lead('ピカ', 'Pikachu'), lead('チュウ', 'Pikachu')]);
  });
});

describe('findPokemonOnSide', () => {
  const battle = new Battle({
    formatid: 'gen9doublescustomgame' as never, seed: [1, 2, 3, 4],
    p1: { name: 'A', team: Teams.pack(japanese) }, p2: { name: 'B', team: Teams.pack([set('Plain', 'Snorlax'), set('Mouse', 'Pikachu')]) },
  });
  const side = battle.sides[0];

  test('a name without an id finds its own body, and a name no body has finds none', () => {
    expect(findPokemonOnSide(side, 'うみのうた')?.species.name).toBe('Primarina');
    expect(findPokemonOnSide(side, 'グレンタウン')?.species.name).toBe('Armarouge');
    expect(findPokemonOnSide(side, 'ぜんぜん')).toBeNull();
  });

  test('a species still finds its body', () => {
    expect(findPokemonOnSide(side, 'Houndstone')?.name).toBe('ワスレイヌ');
    expect(findPokemonOnSide(battle.sides[1], 'Snorlax')?.name).toBe('Plain');
  });
});
