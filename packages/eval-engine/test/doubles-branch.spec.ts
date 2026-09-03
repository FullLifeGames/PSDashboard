import { test, expect } from '@playwright/test';
import { createBranchState, reconstructBranchRuntime } from '../src/branch-engine';
import type { PokemonSet } from '@pkmn/sim';
import type { TurnSnapshot } from '@fulllifegames/replay-core';

const p1Team: PokemonSet[] = [
  {
    name: 'Pikachu',
    species: 'Pikachu',
    item: 'Light Ball',
    ability: 'Static',
    moves: ['Thunderbolt', 'Protect'],
    nature: 'Timid',
    evs: { hp: 0, atk: 0, def: 0, spa: 252, spd: 4, spe: 252 },
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
    level: 50,
  },
  {
    name: 'Eevee',
    species: 'Eevee',
    item: 'Eviolite',
    ability: 'Adaptability',
    moves: ['Tackle', 'Protect'],
    nature: 'Jolly',
    evs: { hp: 0, atk: 252, def: 0, spa: 0, spd: 4, spe: 252 },
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
    level: 50,
  },
  {
    name: 'Raichu',
    species: 'Raichu',
    item: '',
    ability: 'Static',
    moves: ['Thunderbolt', 'Protect'],
    nature: 'Timid',
    evs: { hp: 0, atk: 0, def: 0, spa: 252, spd: 4, spe: 252 },
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
    level: 50,
  },
];

const p1RetargetTeam: PokemonSet[] = [
  {
    name: 'Charizard',
    species: 'Charizard',
    item: 'Charcoal',
    ability: 'Blaze',
    moves: ['Flamethrower', 'Protect'],
    nature: 'Modest',
    evs: { hp: 0, atk: 0, def: 0, spa: 252, spd: 4, spe: 252 },
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
    level: 50,
  },
  p1Team[1],
  p1Team[2],
];

const p2Team: PokemonSet[] = [
  {
    name: 'Bulbasaur',
    species: 'Bulbasaur',
    item: 'Eviolite',
    ability: 'Overgrow',
    moves: ['Vine Whip', 'Protect'],
    nature: 'Modest',
    evs: { hp: 0, atk: 0, def: 0, spa: 252, spd: 4, spe: 252 },
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
    level: 50,
  },
  {
    name: 'Charmander',
    species: 'Charmander',
    item: 'Eviolite',
    ability: 'Blaze',
    moves: ['Ember', 'Protect'],
    nature: 'Timid',
    evs: { hp: 0, atk: 0, def: 0, spa: 252, spd: 4, spe: 252 },
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
    level: 50,
  },
  {
    name: 'Squirtle',
    species: 'Squirtle',
    item: '',
    ability: 'Torrent',
    moves: ['Water Gun', 'Protect'],
    nature: 'Bold',
    evs: { hp: 252, atk: 0, def: 252, spa: 4, spd: 0, spe: 0 },
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
    level: 50,
  },
];

const duplicateSpeciesP1Team: PokemonSet[] = [
  {
    name: 'Alpha',
    species: 'Eevee',
    item: 'Eviolite',
    ability: 'Adaptability',
    moves: ['Tackle', 'Protect'],
    nature: 'Jolly',
    evs: { hp: 0, atk: 252, def: 0, spa: 0, spd: 4, spe: 252 },
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
    level: 50,
  },
  {
    name: 'Beta',
    species: 'Eevee',
    item: 'Silk Scarf',
    ability: 'Run Away',
    moves: ['Swift', 'Protect'],
    nature: 'Timid',
    evs: { hp: 0, atk: 0, def: 0, spa: 252, spd: 4, spe: 252 },
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
    level: 50,
  },
  {
    name: 'Gamma',
    species: 'Raichu',
    item: '',
    ability: 'Static',
    moves: ['Thunderbolt', 'Protect'],
    nature: 'Timid',
    evs: { hp: 0, atk: 0, def: 0, spa: 252, spd: 4, spe: 252 },
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
    level: 50,
  },
];

const p2RedirectionTeam: PokemonSet[] = [
  {
    name: 'Amoonguss',
    species: 'Amoonguss',
    item: 'Sitrus Berry',
    ability: 'Regenerator',
    moves: ['Rage Powder', 'Protect'],
    nature: 'Calm',
    evs: { hp: 252, atk: 0, def: 0, spa: 0, spd: 252, spe: 0 },
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
    level: 50,
  },
  p2Team[1],
  p2Team[2],
];

const p2RetargetTeam: PokemonSet[] = [
  {
    name: 'Bulbasaur',
    species: 'Bulbasaur',
    item: '',
    ability: 'Overgrow',
    moves: ['Tackle', 'Protect'],
    nature: 'Hardy',
    evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
    level: 1,
  },
  p2Team[1],
  p2Team[2],
];

const doublesLog = [
  '|player|p1|Alice|',
  '|player|p2|Bob|',
  '|gametype|doubles',
  '|gen|9',
  '|tier|[Gen 9] Doubles OU',
  '|clearpoke',
  '|poke|p1|Pikachu, L50|item',
  '|poke|p1|Eevee, L50|item',
  '|poke|p1|Raichu, L50|',
  '|poke|p2|Bulbasaur, L50|item',
  '|poke|p2|Charmander, L50|item',
  '|poke|p2|Squirtle, L50|',
  '|teampreview',
  '|',
  '|start',
  '|switch|p1a: Pikachu|Pikachu, L50|100/100',
  '|switch|p1b: Eevee|Eevee, L50|100/100',
  '|switch|p2a: Bulbasaur|Bulbasaur, L50|100/100',
  '|switch|p2b: Charmander|Charmander, L50|100/100',
  '|turn|1',
].join('\n');

const duplicateSpeciesDoublesLeadLog = [
  '|player|p1|Alice|',
  '|player|p2|Bob|',
  '|gametype|doubles',
  '|gen|9',
  '|tier|[Gen 9] Doubles OU',
  '|clearpoke',
  '|poke|p1|Eevee, L50|item',
  '|poke|p1|Eevee, L50|item',
  '|poke|p1|Raichu, L50|',
  '|poke|p2|Bulbasaur, L50|item',
  '|poke|p2|Charmander, L50|item',
  '|poke|p2|Squirtle, L50|',
  '|teampreview',
  '|',
  '|start',
  '|switch|p1a: Beta|Eevee, L50|100/100',
  '|switch|p1b: Gamma|Raichu, L50|100/100',
  '|switch|p2a: Bulbasaur|Bulbasaur, L50|100/100',
  '|switch|p2b: Charmander|Charmander, L50|100/100',
  '|turn|1',
].join('\n');

const targetedDoublesLog = [
  '|player|p1|Alice|',
  '|player|p2|Bob|',
  '|gametype|doubles',
  '|gen|9',
  '|tier|[Gen 9] Doubles OU',
  '|clearpoke',
  '|poke|p1|Pikachu, L50|item',
  '|poke|p1|Eevee, L50|item',
  '|poke|p1|Raichu, L50|',
  '|poke|p2|Bulbasaur, L50|item',
  '|poke|p2|Charmander, L50|item',
  '|poke|p2|Squirtle, L50|',
  '|teampreview',
  '|',
  '|start',
  '|switch|p1a: Pikachu|Pikachu, L50|100/100',
  '|switch|p1b: Eevee|Eevee, L50|100/100',
  '|switch|p2a: Bulbasaur|Bulbasaur, L50|100/100',
  '|switch|p2b: Charmander|Charmander, L50|100/100',
  '|turn|1',
  '|move|p2a: Bulbasaur|Protect|p2a: Bulbasaur',
  '|-singleturn|p2a: Bulbasaur|Protect',
  '|move|p2b: Charmander|Protect|p2b: Charmander',
  '|-singleturn|p2b: Charmander|Protect',
  '|move|p1a: Pikachu|Thunderbolt|p2b: Charmander',
  '|-activate|p2b: Charmander|move: Protect',
  '|move|p1b: Eevee|Tackle|p2a: Bulbasaur',
  '|-activate|p2a: Bulbasaur|move: Protect',
  '|upkeep',
  '|turn|2',
].join('\n');

const redirectedDoublesLog = [
  '|player|p1|Alice|',
  '|player|p2|Bob|',
  '|gametype|doubles',
  '|gen|9',
  '|tier|[Gen 9] Doubles OU',
  '|clearpoke',
  '|poke|p1|Pikachu, L50|item',
  '|poke|p1|Eevee, L50|item',
  '|poke|p1|Raichu, L50|',
  '|poke|p2|Amoonguss, L50|item',
  '|poke|p2|Charmander, L50|item',
  '|poke|p2|Squirtle, L50|',
  '|teampreview',
  '|',
  '|start',
  '|switch|p1a: Pikachu|Pikachu, L50|100/100',
  '|switch|p1b: Eevee|Eevee, L50|100/100',
  '|switch|p2a: Amoonguss|Amoonguss, L50|100/100',
  '|switch|p2b: Charmander|Charmander, L50|100/100',
  '|turn|1',
  '|move|p2b: Charmander|Protect|p2b: Charmander',
  '|-singleturn|p2b: Charmander|Protect',
  '|move|p1b: Eevee|Protect|p1b: Eevee',
  '|-singleturn|p1b: Eevee|Protect',
  '|move|p2a: Amoonguss|Rage Powder|p2a: Amoonguss',
  '|-singleturn|p2a: Amoonguss|move: Rage Powder',
  '|move|p1a: Pikachu|Thunderbolt|p2a: Amoonguss',
  '|-resisted|p2a: Amoonguss',
  '|upkeep',
  '|turn|2',
].join('\n');

const retargetedDoublesLog = [
  '|player|p1|Alice|',
  '|player|p2|Bob|',
  '|gametype|doubles',
  '|gen|9',
  '|tier|[Gen 9] Doubles OU',
  '|clearpoke',
  '|poke|p1|Charizard, L50|item',
  '|poke|p1|Eevee, L50|item',
  '|poke|p1|Raichu, L50|',
  '|poke|p2|Bulbasaur, L1|',
  '|poke|p2|Charmander, L50|item',
  '|poke|p2|Squirtle, L50|',
  '|teampreview',
  '|',
  '|start',
  '|switch|p1a: Charizard|Charizard, L50|100/100',
  '|switch|p1b: Eevee|Eevee, L50|100/100',
  '|switch|p2a: Bulbasaur|Bulbasaur, L1|1/100',
  '|switch|p2b: Charmander|Charmander, L50|100/100',
  '|turn|1',
  '|move|p1a: Charizard|Flamethrower|p2a: Bulbasaur',
  '|-damage|p2a: Bulbasaur|0 fnt',
  '|faint|p2a: Bulbasaur',
  '|move|p1b: Eevee|Tackle|p2b: Charmander',
  '|-damage|p2b: Charmander|90/100',
  '|move|p2b: Charmander|Protect|p2b: Charmander',
  '|-fail|p2b: Charmander',
  '|upkeep',
  '|switch|p2a: Squirtle|Squirtle, L50|100/100',
  '|turn|2',
].join('\n');

const phazingTeamP1: PokemonSet[] = [
  {
    name: 'Roarer',
    species: 'Ting-Lu',
    item: 'Leftovers',
    ability: 'Vessel of Ruin',
    moves: ['Roar', 'Protect'],
    nature: 'Careful',
    evs: { hp: 252, atk: 0, def: 0, spa: 0, spd: 4, spe: 0 },
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
    level: 50,
  },
];

const phazingTeamP2: PokemonSet[] = [
  {
    name: 'Bulbasaur',
    species: 'Bulbasaur',
    item: '',
    ability: 'Overgrow',
    moves: ['Tackle'],
    nature: 'Hardy',
    evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
    level: 50,
  },
  {
    name: 'Charmander',
    species: 'Charmander',
    item: '',
    ability: 'Blaze',
    moves: ['Scratch'],
    nature: 'Hardy',
    evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
    level: 50,
  },
  {
    name: 'Squirtle',
    species: 'Squirtle',
    item: '',
    ability: 'Torrent',
    moves: ['Tackle'],
    nature: 'Hardy',
    evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
    level: 50,
  },
];

const phazingLog = [
  '|player|p1|Alice|',
  '|player|p2|Bob|',
  '|gametype|singles',
  '|gen|9',
  '|tier|[Gen 9] OU',
  '|clearpoke',
  '|poke|p1|Ting-Lu, L50|',
  '|poke|p2|Bulbasaur, L50|',
  '|poke|p2|Charmander, L50|',
  '|poke|p2|Squirtle, L50|',
  '|teampreview',
  '|',
  '|start',
  '|switch|p1a: Roarer|Ting-Lu, L50|100/100',
  '|switch|p2a: Bulbasaur|Bulbasaur, L50|100/100',
  '|turn|1',
  '|move|p2a: Bulbasaur|Tackle|p1a: Roarer',
  '|-damage|p1a: Roarer|97/100',
  '|move|p1a: Roarer|Roar|p2a: Bulbasaur',
  '|drag|p2a: Charmander|Charmander, L50|100/100',
  '|upkeep',
  '|turn|2',
].join('\n');

const chargeMoveMissingTargetLog = [
  '|player|p1|Alice|',
  '|player|p2|Bob|',
  '|gametype|doubles',
  '|gen|9',
  '|tier|[Gen 9] Doubles OU',
  '|clearpoke',
  '|poke|p1|Hatterene, F|item',
  '|poke|p1|Ursaluna, F|item',
  '|poke|p2|Necrozma|item',
  '|poke|p2|Indeedee-F, F|item',
  '|start',
  '|switch|p1a: Hatterene|Hatterene, F|100/100',
  '|switch|p1b: Ursaluna|Ursaluna, F|100/100',
  '|switch|p2a: Necrozma|Necrozma|100/100',
  '|switch|p2b: Indeedee|Indeedee-F, F|100/100',
  '|turn|1',
  '|move|p2b: Indeedee|Helping Hand|p2a: Necrozma',
  '|-singleturn|p2a: Necrozma|Helping Hand|[of] p2b: Indeedee',
  '|move|p1b: Ursaluna|Protect|p1b: Ursaluna',
  '|-singleturn|p1b: Ursaluna|Protect',
  '|move|p2a: Necrozma|Meteor Beam||[still]',
  '|-prepare|p2a: Necrozma|Meteor Beam',
  '|-boost|p2a: Necrozma|spa|1',
  '|-damage|p1a: Hatterene|10/100',
  '|move|p1a: Hatterene|Trick Room|p1a: Hatterene',
  '|-fieldstart|move: Trick Room|[of] p1a: Hatterene',
  '|upkeep',
  '|turn|2',
].join('\n');

const chargeMoveMissingTargetP1Team: PokemonSet[] = [
  {
    name: 'Hatterene',
    species: 'Hatterene',
    item: 'Aguav Berry',
    ability: 'Magic Bounce',
    moves: ['Trick Room', 'Light Screen', 'Dazzling Gleam'],
    nature: 'Quiet',
    evs: { hp: 252, atk: 0, def: 0, spa: 252, spd: 4, spe: 0 },
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 0 },
    level: 100,
    gender: 'F',
  },
  {
    name: 'Ursaluna',
    species: 'Ursaluna',
    item: 'Flame Orb',
    ability: 'Guts',
    moves: ['Protect', 'Throat Chop'],
    nature: 'Adamant',
    evs: { hp: 252, atk: 252, def: 0, spa: 0, spd: 4, spe: 0 },
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
    level: 100,
    gender: 'F',
  },
];

const chargeMoveMissingTargetP2Team: PokemonSet[] = [
  {
    name: 'Necrozma',
    species: 'Necrozma',
    item: 'Power Herb',
    ability: 'Prism Armor',
    moves: ['Meteor Beam', 'Expanding Force', 'Protect', 'Heat Wave'],
    nature: 'Modest',
    evs: { hp: 252, atk: 0, def: 0, spa: 252, spd: 4, spe: 0 },
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
    level: 100,
  },
  {
    name: 'Indeedee',
    species: 'Indeedee-F',
    item: 'Sitrus Berry',
    ability: 'Psychic Surge',
    moves: ['Helping Hand', 'Follow Me', 'Psychic'],
    nature: 'Bold',
    evs: { hp: 252, atk: 0, def: 252, spa: 0, spd: 4, spe: 0 },
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
    level: 100,
    gender: 'F',
  },
];

const staleTrickRoomLog = [
  '|player|p1|Alice|',
  '|player|p2|Bob|',
  '|gametype|doubles',
  '|gen|9',
  '|tier|[Gen 9] Doubles OU',
  '|clearpoke',
  '|poke|p1|Dusclops, M|item',
  '|poke|p1|Incineroar, F|item',
  '|poke|p2|Necrozma|item',
  '|poke|p2|Sneasler, M|item',
  '|start',
  '|switch|p1a: Dusclops|Dusclops, M|100/100',
  '|switch|p1b: Incineroar|Incineroar, F|47/100',
  '|switch|p2a: Necrozma|Necrozma|25/100',
  '|switch|p2b: Sneasler|Sneasler, M|100/100',
  '|turn|1',
  '|move|p1a: Dusclops|Trick Room|p1a: Dusclops',
  '|-fieldstart|move: Trick Room|[of] p1a: Dusclops',
  '|move|p1b: Incineroar|Knock Off|p2a: Necrozma',
  '|-damage|p2a: Necrozma|20/100',
  '|move|p2a: Necrozma|Protect|p2a: Necrozma',
  '|move|p2b: Sneasler|Dire Claw|p1b: Incineroar',
  '|-damage|p1b: Incineroar|40/100',
  '|upkeep',
  '|turn|2',
].join('\n');

const staleTrickRoomSnapshot: TurnSnapshot = {
  turn: 6,
  p1: {
    name: 'Alice',
    id: 'p1',
    sideConditions: {},
    pokemon: [
      {
        name: 'Dusclops',
        speciesForme: 'Dusclops',
        hp: 100,
        maxhp: 100,
        hpPercent: 100,
        status: '',
        fainted: false,
        isActive: true,
        boosts: {},
        moves: [],
        ability: '',
        item: '',
        terastallized: '',
        level: 100,
        gender: 'M',
      },
      {
        name: 'Incineroar',
        speciesForme: 'Incineroar',
        hp: 47,
        maxhp: 100,
        hpPercent: 47,
        status: '',
        fainted: false,
        isActive: true,
        boosts: {},
        moves: [],
        ability: '',
        item: '',
        terastallized: '',
        level: 100,
        gender: 'F',
      },
    ],
  },
  p2: {
    name: 'Bob',
    id: 'p2',
    sideConditions: {},
    pokemon: [
      {
        name: 'Necrozma',
        speciesForme: 'Necrozma',
        hp: 25,
        maxhp: 100,
        hpPercent: 25,
        status: '',
        fainted: false,
        isActive: true,
        boosts: { spa: 1, atk: -1 },
        moves: [],
        ability: '',
        item: '',
        terastallized: '',
        level: 100,
        gender: '',
      },
      {
        name: 'Sneasler',
        speciesForme: 'Sneasler',
        hp: 100,
        maxhp: 100,
        hpPercent: 100,
        status: '',
        fainted: false,
        isActive: true,
        boosts: {},
        moves: [],
        ability: '',
        item: '',
        terastallized: '',
        level: 100,
        gender: 'M',
      },
    ],
  },
  field: {
    weather: '',
    terrain: '',
    pseudoWeather: {},
  },
  log: [],
};

test.describe('Doubles branch reconstruction', () => {
  test('uses replay nicknames to reconstruct duplicate-species doubles leads', async () => {
    const logLines: string[] = [];
    const runtime = await reconstructBranchRuntime({
      format: 'gen9doublesou',
      p1Team: duplicateSpeciesP1Team,
      p2Team,
      replayLog: duplicateSpeciesDoublesLeadLog,
      targetTurn: 1,
      onLogLines: lines => logLines.push(...lines),
    });

    const state = createBranchState(runtime.battleStream, logLines, {
      p1Choices: [null, null],
      p2Choices: [null, null],
    });

    expect(state.p1ActiveSlots.map(active => active?.name)).toEqual(['Beta', 'Gamma']);
    expect(state.p1MovesBySlot[0].map(move => move.name)).toContain('Swift');
  });

  test('exposes controls for every active slot at the branch turn', async () => {
    const logLines: string[] = [];
    const runtime = await reconstructBranchRuntime({
      format: 'gen9doublesou',
      p1Team,
      p2Team,
      replayLog: doublesLog,
      targetTurn: 1,
      onLogLines: lines => logLines.push(...lines),
    });

    const state = createBranchState(runtime.battleStream, logLines, {
      p1Choices: [null, null],
      p2Choices: [null, null],
    });

    expect(state.turnNumber).toBe(1);
    expect(state.p1ActiveSlots.map(active => active?.species)).toEqual(['Pikachu', 'Eevee']);
    expect(state.p2ActiveSlots.map(active => active?.species)).toEqual(['Bulbasaur', 'Charmander']);
    expect(state.p1MovesBySlot).toHaveLength(2);
    expect(state.p2MovesBySlot).toHaveLength(2);
    expect(state.p1MovesBySlot[0].map(move => move.name)).toContain('Thunderbolt');
    expect(state.p1MovesBySlot[1].map(move => move.name)).toContain('Tackle');
  });

  test('reconstructs targeted doubles moves with explicit target locations', async () => {
    const logLines: string[] = [];
    const runtime = await reconstructBranchRuntime({
      format: 'gen9doublesou',
      p1Team,
      p2Team,
      replayLog: targetedDoublesLog,
      targetTurn: 2,
      onLogLines: lines => logLines.push(...lines),
    });

    const state = createBranchState(runtime.battleStream, logLines, {
      p1Choices: [null, null],
      p2Choices: [null, null],
    });

    expect(state.turnNumber).toBe(2);
    expect(state.log.join('\n')).toContain('|move|p1a: Pikachu|Thunderbolt|p2b: Charmander');
    expect(state.log.join('\n')).toContain('|move|p1b: Eevee|Tackle|p2a: Bulbasaur');
  });

  test('keeps redirection and retargeting fixtures reconstructable', async () => {
    for (const [log, p2] of [
      [redirectedDoublesLog, p2RedirectionTeam],
      [retargetedDoublesLog, p2RetargetTeam],
    ] as const) {
      const logLines: string[] = [];
      const runtime = await reconstructBranchRuntime({
        format: 'gen9doublesou',
        p1Team: log.includes('Charizard') ? p1RetargetTeam : p1Team,
        p2Team: p2,
        replayLog: log,
        targetTurn: 2,
        onLogLines: lines => logLines.push(...lines),
      });

      const state = createBranchState(runtime.battleStream, logLines, {
        p1Choices: [null, null],
        p2Choices: [null, null],
      });

      expect(state.turnNumber, log.includes('Rage Powder') ? 'redirection fixture' : 'retargeting fixture').toBe(2);
    }
  });

  test('corrects phazing drag targets from replay protocol evidence', async () => {
    const logLines: string[] = [];
    const runtime = await reconstructBranchRuntime({
      format: 'gen9ou',
      p1Team: phazingTeamP1,
      p2Team: phazingTeamP2,
      replayLog: phazingLog,
      targetTurn: 2,
      onLogLines: lines => logLines.push(...lines),
    });

    const state = createBranchState(runtime.battleStream, logLines, {
      p1Choice: null,
      p2Choice: null,
    });

    expect(state.turnNumber).toBe(2);
    expect(state.p2Active?.species).toBe('Charmander');
  });

  test('reconstructs doubles charge moves whose replay protocol omits the target', async () => {
    const runtime = await reconstructBranchRuntime({
      format: 'gen9doublesou',
      p1Team: chargeMoveMissingTargetP1Team,
      p2Team: chargeMoveMissingTargetP2Team,
      replayLog: chargeMoveMissingTargetLog,
      targetTurn: 2,
    });

    const state = createBranchState(runtime.battleStream, runtime.log, {
      p1Choices: [null, null],
      p2Choices: [null, null],
    });

    expect(state.turnNumber).toBe(2);
    expect(runtime.log.join('\n')).toContain('|move|p2a: Necrozma|Meteor Beam|');
  });

  test('treats the requested replay snapshot as authoritative for turn and field state', async () => {
    const runtime = await reconstructBranchRuntime({
      format: 'gen9doublesou',
      p1Team: [
        { ...chargeMoveMissingTargetP1Team[0], name: 'Dusclops', species: 'Dusclops', moves: ['Trick Room', 'Pain Split'], gender: 'M' },
        { ...chargeMoveMissingTargetP1Team[1], name: 'Incineroar', species: 'Incineroar', moves: ['Knock Off', 'Flare Blitz'], gender: 'F' },
      ],
      p2Team: [
        chargeMoveMissingTargetP2Team[0],
        { ...chargeMoveMissingTargetP2Team[1], name: 'Sneasler', species: 'Sneasler', moves: ['Fling', 'Dire Claw'], gender: 'M' },
      ],
      replayLog: staleTrickRoomLog,
      targetTurn: 6,
      snapshot: staleTrickRoomSnapshot,
    });

    const state = createBranchState(runtime.battleStream, runtime.log, {
      p1Choices: [null, null],
      p2Choices: [null, null],
    });

    expect(state.turnNumber).toBe(6);
    expect(Object.keys(runtime.battleStream.battle?.field.pseudoWeather ?? {})).not.toContain('trickroom');
    expect(runtime.log.filter(line => line === '|turn|6')).toHaveLength(1);
  });
});
