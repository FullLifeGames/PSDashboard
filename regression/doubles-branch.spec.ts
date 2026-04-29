import { test, expect } from '@playwright/test';
import { createBranchState, reconstructBranchRuntime } from '../src/lib/branch-engine';
import type { PokemonSet } from '@pkmn/sim';

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

test.describe('Doubles branch reconstruction', () => {
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
});
